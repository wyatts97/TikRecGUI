import subprocess
import time
import logging
import threading
from datetime import datetime, timedelta
from pathlib import Path

from app.config import settings
from app.db.database import get_session, run_background
from app.db.models import Recording, User
from app.core.media_utils import (
    generate_recording_filename,
    generate_sprite,
    generate_thumbnail,
    remux_to_mp4,
    repair_video,
    analyze_video_health,
    concat_ts_segments,
)
from app.core.recorder_loader import get_tiktok_api_class
from app.core.transcription_service import transcription_service
from app.core.live_chat_service import live_chat_service
from app.core.notification_service import notification_service


def _update_recording_status(recording_id: int, status: str, error_message: str | None = None) -> None:
    with get_session() as db:
        recording = db.query(Recording).filter(Recording.id == recording_id).first()
        if recording:
            recording.status = status
            if error_message is not None:
                recording.error_message = error_message
            if status in ("failed", "completed", "stopped"):
                recording.ended_at = datetime.utcnow()
            db.commit()


logger = logging.getLogger("tikrec.task_manager")

# Capture is treated as stalled if the .ts output file does not grow for this
# many seconds while ffmpeg is still running (dead socket with no reconnect).
_STALL_TIMEOUT_SECONDS = 90

# Resumable live capture settings — when a TikTok live URL expires, ffmpeg exits
# and we re-resolve a fresh URL instead of finalizing the recording.
_MAX_RESUME_ATTEMPTS = 30
_RESUME_BACKOFF_SECONDS = (3, 5, 10, 15, 30)
_OFFLINE_CONFIRMATION_SECONDS = 90
_SEGMENT_CHECK_INTERVAL = 0.5


def _read_log_tail(log_path: Path | None, max_chars: int = 600) -> str | None:
    """Return the last *max_chars* of an ffmpeg log file, if it exists."""
    if log_path is None or not log_path.exists():
        return None
    try:
        data = log_path.read_text(encoding="utf-8", errors="replace").strip()
    except Exception:
        return None
    if not data:
        return None
    return data[-max_chars:]


def _check_live_with_backoff(
    username: str,
    api: object,
    recorder_service: object,
    max_retries: int = 3,
    backoff_seconds: tuple[int, ...] = (5, 10, 15),
) -> tuple[bool, str | None]:
    """Confirm whether *username* is currently live.

    Performs up to *max_retries* room-alive checks with backoff to tolerate
    transient TikTok API blips. Returns ``(is_live, room_id)``; room_id may be
    updated even if the user is not live.
    """
    for attempt in range(max_retries):
        try:
            status = recorder_service.check_user_live(username)
            is_live = status.get("is_live", False)
            room_id = status.get("room_id")
            if is_live and room_id:
                return True, room_id
            if not is_live and room_id:
                # User not live but we got a room_id — try the room directly
                try:
                    if api.is_room_alive(room_id):
                        return True, room_id
                except Exception:
                    pass
        except Exception as exc:
            logger.debug("Live check attempt %d failed for @%s: %s", attempt + 1, username, exc)
        if attempt < max_retries - 1:
            delay = backoff_seconds[min(attempt, len(backoff_seconds) - 1)]
            time.sleep(delay)
    return False, None


def _resolve_fresh_live_url(room_id: str, api: object) -> str | None:
    """Resolve a fresh live URL for an active room_id.

    TikTok live URLs expire quickly; this re-fetches a brand new URL that can be
    used to start the next segment.
    """
    try:
        if not api.is_room_alive(room_id):
            return None
        url = api.get_live_url(room_id)
        return url
    except Exception as exc:
        logger.debug("Failed to resolve fresh URL for room %s: %s", room_id, exc)
        return None


def _build_capture_cmd(
    live_url: str,
    ts_path: Path,
    duration: int | None,
    proxy: str | None,
    cookies: dict | None,
) -> list[str]:
    """Build the ffmpeg capture command, wiring proxy/cookies when present.

    ffmpeg consumes the live URL directly (HLS m3u8 or FLV) and writes a single
    continuous MPEG-TS. Proxy and cookies are passed so a geo-restricted stream
    reachable only through the same proxy/session as URL discovery still works.
    """
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "warning",
        "-reconnect", "1",
        "-reconnect_streamed", "1",
        "-reconnect_at_eof", "1",
        "-reconnect_delay_max", "5",
    ]
    if proxy:
        cmd += ["-http_proxy", proxy]
    if cookies:
        cookie_header = "; ".join(f"{k}={v}" for k, v in cookies.items() if k)
        if cookie_header:
            cmd += ["-headers", f"Cookie: {cookie_header}\r\n"]
    cmd += [
        "-fflags", "+igndts+genpts",
        "-i", live_url,
        "-c", "copy",
        "-f", "mpegts",
    ]
    if duration:
        cmd += ["-t", str(duration)]
    cmd.append(str(ts_path))
    return cmd


def _notify_recording_finished(recording_id: int, username: str, status: str, duration_seconds: int) -> None:
    """Publish a notification when a recording reaches a terminal state."""
    if status == "completed":
        title = f"Recording completed: @{username}"
        message = f"Recorded {duration_seconds // 60} min"
    elif status == "stopped":
        title = f"Recording stopped: @{username}"
        message = f"Recorded {duration_seconds // 60} min"
    else:  # failed
        title = f"Recording failed: @{username}"
        message = "The recording ended unexpectedly."
    notification_service.publish(
        type=f"recording_{status}",
        title=title,
        message=message,
        data={"recording_id": recording_id, "username": username, "status": status},
    )


class RecordingTask:
    def __init__(
        self,
        recording_id: int,
        username: str,
        room_id: str,
        duration: int | None = None,
        bitrate: str | None = None,
        cookies: dict | None = None,
        proxy: str | None = None
    ):
        self.recording_id = recording_id
        self.username = username
        self.room_id = room_id
        self.duration = duration
        self.bitrate = bitrate
        self.cookies = cookies
        self.proxy = proxy
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._output_path: Path | None = None
        self._ts_path: Path | None = None
        self._log_path: Path | None = None
        self._proc: subprocess.Popen | None = None
        self._start_time: float | None = None
        self._capture_error: str | None = None
        self._segments: list[Path] = []
        self._finalized = False
        self._segment_index = 0
        self._total_elapsed_seconds: float | None = None
    
    def start(self):
        self._thread = threading.Thread(target=self._run_with_error_handling, daemon=True)
        self._thread.start()
    
    def stop(self):
        self._stop_event.set()
        # Ask the capture ffmpeg to finish gracefully so the final GOP and
        # the MPEG-TS trailer are flushed before we remux.
        proc = self._proc
        if proc and proc.poll() is None:
            try:
                if proc.stdin:
                    proc.stdin.write(b"q")
                    proc.stdin.flush()
                proc.wait(timeout=10)
            except Exception:
                try:
                    proc.terminate()
                    proc.wait(timeout=5)
                except Exception:
                    proc.kill()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=15)
    
    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()
    
    def _run(self):
        # --- Phase 1: mark as recording (short-lived session) ---
        with get_session() as db:
            recording = db.query(Recording).filter(Recording.id == self.recording_id).first()
            if not recording:
                return
            filename = recording.filename
            recording.status = "recording"
            recording.started_at = datetime.utcnow()
            db.commit()

        # --- Phase 2: validate room and get initial stream URL (no DB) ---
        api_cls = get_tiktok_api_class()
        api = api_cls(proxy=self.proxy, cookies=self.cookies)
        from app.core.recorder_service import recorder_service

        if not api.is_room_alive(self.room_id):
            _update_recording_status(self.recording_id, "failed", "User is not live")
            return

        live_url = api.get_live_url(self.room_id)
        if not live_url:
            _update_recording_status(self.recording_id, "failed", "Could not get live stream URL")
            return

        # Start live chat/gift capture after stream URL is confirmed so that
        # offset_seconds values align with the video start time rather than the
        # earlier status-change time (Phase 1 can precede Phase 3 by 5-30 s).
        _chat_started_at = datetime.utcnow()
        try:
            live_chat_service.start_listening(
                recording_id=self.recording_id,
                username=self.username,
                room_id=self.room_id,
                started_at=_chat_started_at,
                proxy=self.proxy,
                cookies=self.cookies,
            )
        except Exception as e:
            logger.warning("Failed to start chat capture for recording %d: %s", self.recording_id, e)

        # --- Phase 3: resumable capture into sequential segments ---
        # TikTok live URLs expire every few minutes. Instead of finalizing the
        # recording when ffmpeg exits, we re-resolve a fresh URL and start a new
        # segment, then concatenate all segments into one continuous file at
        # finalize time. This keeps one live session as one recording.
        output_path = Path(settings.RECORDINGS_DIR) / filename
        output_path.parent.mkdir(parents=True, exist_ok=True)
        self._output_path = output_path
        self._ts_path = output_path.with_suffix(".ts")
        self._log_path = output_path.with_suffix(".ffmpeg.log")
        self._start_time = time.time()

        room_id = self.room_id
        resumed = False
        resume_attempts = 0
        session_done = False
        self._capture_error = None

        while not session_done:
            # Manual stop or duration cap ends the session immediately.
            if self._stop_event.is_set():
                break

            elapsed = time.time() - self._start_time
            if self.duration is not None and elapsed >= self.duration:
                logger.info("Recording %d: duration cap reached (%d s)", self.recording_id, self.duration)
                break

            segment_remaining = None
            if self.duration is not None:
                segment_remaining = max(1, int(self.duration - elapsed))

            segment_index = len(self._segments) + 1
            segment_path = output_path.with_suffix(f".part{segment_index:03d}.ts")

            cmd = _build_capture_cmd(live_url, segment_path, segment_remaining, self.proxy, self.cookies)
            log_fh = None
            proc = None
            try:
                log_fh = open(self._log_path, "ab")
            except Exception:
                log_fh = None
            try:
                proc = subprocess.Popen(
                    cmd,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.DEVNULL,
                    stderr=(log_fh or subprocess.DEVNULL),
                )
            except Exception as e:
                logger.error("Failed to start ffmpeg capture for recording %d: %s", self.recording_id, e)
                if log_fh:
                    log_fh.close()
                self._capture_error = f"Capture failed to start: {e}"
                break

            self._proc = proc
            logger.info(
                "Recording %d: started segment %d%s",
                self.recording_id, segment_index, " (resumed)" if resumed else "",
            )

            # Monitor this segment until it ends, stalls, or is manually stopped.
            last_size = -1
            last_growth = time.time()
            segment_failed = False
            while not self._stop_event.is_set():
                if proc.poll() is not None:
                    break
                try:
                    cur_size = segment_path.stat().st_size if segment_path.exists() else 0
                except OSError:
                    cur_size = 0
                now = time.time()
                if cur_size > last_size:
                    last_size = cur_size
                    last_growth = now
                elif now - last_growth > _STALL_TIMEOUT_SECONDS:
                    logger.warning(
                        "Recording %d: segment %d stalled (no growth for %ds)",
                        self.recording_id, segment_index, _STALL_TIMEOUT_SECONDS,
                    )
                    self._capture_error = (
                        f"Segment {segment_index} stalled — no data for {_STALL_TIMEOUT_SECONDS}s"
                    )
                    segment_failed = True
                    break
                time.sleep(_SEGMENT_CHECK_INTERVAL)

            # Ensure the segment ffmpeg exits cleanly.
            if proc and proc.poll() is None:
                try:
                    if proc.stdin:
                        proc.stdin.write(b"q")
                        proc.stdin.flush()
                    proc.wait(timeout=10)
                except Exception:
                    try:
                        proc.terminate()
                        proc.wait(timeout=5)
                    except Exception:
                        proc.kill()
            if log_fh:
                try:
                    log_fh.close()
                except Exception:
                    pass
            self._proc = None

            # Record the segment if it produced any data.
            if segment_path.exists() and segment_path.stat().st_size > 0:
                self._segments.append(segment_path)
                self._capture_error = None  # a good segment clears prior transient errors
            elif not self._stop_event.is_set():
                logger.warning(
                    "Recording %d: segment %d produced no data; treating as end-of-stream",
                    self.recording_id, segment_index,
                )
                segment_failed = True

            # Manual stop or duration cap ends the session.
            if self._stop_event.is_set():
                break
            elapsed = time.time() - self._start_time
            if self.duration is not None and elapsed >= self.duration:
                break

            # Otherwise, decide whether the session really ended or just needs a fresh URL.
            if segment_failed or proc.poll() is not None:
                resume_attempts += 1
                if resume_attempts > _MAX_RESUME_ATTEMPTS:
                    logger.warning(
                        "Recording %d: exceeded max resume attempts (%d), finalizing",
                        self.recording_id, _MAX_RESUME_ATTEMPTS,
                    )
                    break

                backoff = _RESUME_BACKOFF_SECONDS[
                    min(resume_attempts - 1, len(_RESUME_BACKOFF_SECONDS) - 1)
                ]
                logger.info(
                    "Recording %d: ffmpeg exited/segment failed; waiting %ds before re-checking live status",
                    self.recording_id, backoff,
                )
                time.sleep(backoff)

                is_live, fresh_room_id = _check_live_with_backoff(
                    self.username,
                    api,
                    recorder_service,
                    max_retries=3,
                    backoff_seconds=(10, 20, _OFFLINE_CONFIRMATION_SECONDS // 3),
                )
                if not is_live or not fresh_room_id:
                    logger.info(
                        "Recording %d: user @%s confirmed offline, finalizing session",
                        self.recording_id, self.username,
                    )
                    break

                # User is still live — refresh the URL and resume.
                fresh_url = _resolve_fresh_live_url(fresh_room_id, api)
                if not fresh_url:
                    logger.warning(
                        "Recording %d: user still live but could not resolve fresh URL; retrying",
                        self.recording_id,
                    )
                    continue
                room_id = fresh_room_id
                live_url = fresh_url
                resumed = True
                logger.info(
                    "Recording %d: resuming session with fresh URL (room %s)",
                    self.recording_id, room_id,
                )
            else:
                # This path should be unreachable; treat as session end to be safe.
                break

        self._total_elapsed_seconds = time.time() - self._start_time
        self._finalize_recording()

    def _finalize_recording(self) -> None:
        """Finalize a recording: flush file, update DB, stop chat, remux, thumbnails.
        Called from _run() on normal exit and from _run_with_error_handling()
        in finally to guarantee it always runs even on unexpected thread death.
        """
        if self._finalized:
            return
        self._finalized = True

        output_path = self._output_path
        start_time = self._start_time

        if output_path is None or start_time is None:
            # Recording never reached Phase 3 (no file created)
            try:
                live_chat_service.stop_listening(self.recording_id)
            except Exception:
                pass
            return

        ts_path = self._ts_path
        ended_at = datetime.utcnow()
        duration_seconds = int(self._total_elapsed_seconds or (time.time() - start_time))

        # Concatenate the resumable segments into the single .ts used for remux.
        # If there are no segments (capture failed before writing), the old
        # single-segment path is still supported because a lone .ts could exist.
        if self._segments:
            logger.info(
                "Recording %d: concatenating %d segment(s) into %s",
                self.recording_id, len(self._segments), ts_path.name,
            )
            concat_ok = concat_ts_segments(self._segments, ts_path)
            if not concat_ok:
                logger.error(
                    "Recording %d: segment concatenation failed; keeping %d segment(s)",
                    self.recording_id, len(self._segments),
                )
            # Clean up the individual part files regardless of concat success.
            for part in self._segments:
                try:
                    part.unlink(missing_ok=True)
                except Exception:
                    pass
            self._segments = []

        # The capture writes an intermediate MPEG-TS file; the final .mp4 is
        # produced by the remux below. Treat the .ts (or a previously-remuxed
        # .mp4) as evidence that capture actually produced data.
        captured = (ts_path is not None and ts_path.exists()) or output_path.exists()
        final_status: str | None = None

        with get_session() as db:
            recording = db.query(Recording).filter(Recording.id == self.recording_id).first()
            if not recording:
                return

            # Only update if still active (don't overwrite already-finalized rows)
            if recording.status in ("recording", "pending"):
                recording.ended_at = ended_at
                recording.duration_seconds = duration_seconds

                if captured:
                    src = ts_path if (ts_path and ts_path.exists()) else output_path
                    recording.file_size = src.stat().st_size
                    recording.status = "completed" if not self._stop_event.is_set() else "stopped"
                else:
                    recording.status = "failed"
                    # Prefer a specific capture error (with the ffmpeg log tail)
                    # over the generic message so failures are diagnosable.
                    log_tail = _read_log_tail(self._log_path)
                    detail = self._capture_error or "Output file not created"
                    if log_tail:
                        detail = f"{detail} | ffmpeg: {log_tail}"
                    recording.error_message = recording.error_message or detail

                db.commit()
                final_status = recording.status

        # Notify the UI that the recording finished (completed/stopped/failed)
        if final_status:
            try:
                _notify_recording_finished(self.recording_id, self.username, final_status, duration_seconds)
            except Exception:
                logger.debug("Failed to publish recording-finished notification", exc_info=True)

        # Stop live chat/gift capture
        try:
            live_chat_service.stop_listening(self.recording_id)
        except Exception:
            pass

        # Diagnostic log cleanup: if the final MP4 is in place, the capture was
        # successful and the log is no longer needed. Otherwise keep it for
        # debugging (failed capture, remux failure, etc.).
        log_path = self._log_path
        if log_path is not None and output_path is not None and output_path.exists():
            log_path.unlink(missing_ok=True)

        # Post-processing — only when a fresh .ts capture is awaiting remux.
        if ts_path is not None and ts_path.exists():
            health = analyze_video_health(ts_path)
            if health.get("is_corrupt"):
                logger.warning(
                    "Recording %d (%s) may be corrupt: %s",
                    self.recording_id, ts_path.name, health.get("error"),
                )
            else:
                logger.info(
                    "Recording %d (%s) healthy — %.1fs, video=%s audio=%s",
                    self.recording_id, ts_path.name,
                    health.get("duration"), health.get("has_video"), health.get("has_audio"),
                )

            # Remux .ts → faststart .mp4 (stream-copy, re-encode fallback).
            remux_ok, actual_duration = remux_to_mp4(
                ts_path, expected_duration=duration_seconds, output_path=output_path
            )
            if not remux_ok:
                logger.info("Remux failed for recording %d, attempting full repair", self.recording_id)
                remux_ok, actual_duration = repair_video(ts_path, output_path=output_path)

            if remux_ok and output_path.exists():
                # Capture succeeded and the playable .mp4 is in place — drop the .ts.
                ts_path.unlink(missing_ok=True)
                with get_session() as db:
                    recording = db.query(Recording).filter(Recording.id == self.recording_id).first()
                    if recording:
                        recording.file_size = output_path.stat().st_size
                        if recording.status == "failed":
                            recording.status = "completed" if not self._stop_event.is_set() else "stopped"
                        if actual_duration is not None:
                            actual_int = int(round(actual_duration))
                            if actual_int != recording.duration_seconds:
                                logger.info(
                                    "Updating recording %d duration %d -> %d (remux fix)",
                                    self.recording_id,
                                    recording.duration_seconds,
                                    actual_int,
                                )
                                recording.duration_seconds = actual_int
                        db.commit()

                run_background(generate_thumbnail, output_path, None, self.recording_id)
                run_background(generate_sprite, output_path)

                with get_session() as db:
                    recording = db.query(Recording).filter(Recording.id == self.recording_id).first()
                    if recording and recording.transcript_status is None:
                        recording.transcript_status = "pending"
                        db.commit()
                    transcription_service.enqueue(self.recording_id)
            else:
                # Remux + repair both failed — keep the .ts so the user can
                # retry, and surface the failure.
                logger.error(
                    "Recording %d: remux and repair both failed; keeping %s",
                    self.recording_id, ts_path.name,
                )
                with get_session() as db:
                    recording = db.query(Recording).filter(Recording.id == self.recording_id).first()
                    if recording:
                        recording.status = "failed"
                        recording.error_message = "Remux failed — captured stream could not be converted"
                        db.commit()

    def _run_with_error_handling(self):
        try:
            self._run()
        except Exception as e:
            logger.error(f"Recording error: {e}", exc_info=True)
            _update_recording_status(self.recording_id, "failed", str(e))
        finally:
            self._finalize_recording()


class TaskManager:
    def __init__(self):
        self._tasks: dict[int, RecordingTask] = {}
        self._lock = threading.Lock()
    
    def start_recording(
        self,
        recording_id: int,
        username: str,
        room_id: str,
        duration: int | None = None,
        bitrate: str | None = None,
        cookies: dict | None = None,
        proxy: str | None = None
    ) -> bool:
        with self._lock:
            if recording_id in self._tasks:
                return False
            
            task = RecordingTask(
                recording_id=recording_id,
                username=username,
                room_id=room_id,
                duration=duration,
                bitrate=bitrate,
                cookies=cookies,
                proxy=proxy
            )
            task.start()
            self._tasks[recording_id] = task
            return True
    
    def stop_recording(self, recording_id: int) -> bool:
        with self._lock:
            task = self._tasks.get(recording_id)
            if task:
                task.stop()
                del self._tasks[recording_id]
                return True
            return False
    
    def is_recording(self, recording_id: int) -> bool:
        with self._lock:
            task = self._tasks.get(recording_id)
            return task is not None and task.is_running()
    
    def get_active_recordings(self) -> list[int]:
        with self._lock:
            return [rid for rid, task in self._tasks.items() if task.is_running()]
    
    def cleanup_finished(self):
        with self._lock:
            finished = [rid for rid, task in self._tasks.items() if not task.is_running()]
            for rid in finished:
                del self._tasks[rid]
    
    def shutdown(self):
        with self._lock:
            for task in self._tasks.values():
                task.stop()
            self._tasks.clear()


task_manager = TaskManager()


class MonitorService:
    """Background loop that auto-records watched users when they go live.

    Every ``automatic_interval`` minutes it checks each user flagged with
    ``is_monitoring`` and, if live and not already recording, starts a recording.

    Rate-limiting: a 1.5 s delay is inserted between each user check to
    avoid triggering TikTok's rate limiter.  Consecutive failures for a user
    trigger exponential backoff (2×, 4×, … up to 60 s).
    """

    # Delay between individual user checks (seconds)
    _INTER_USER_DELAY = 1.5
    # Exponential-backoff limits
    _BACKOFF_BASE = 2          # first retry waits 2 s
    _BACKOFF_MAX = 60          # never wait more than 60 s per user

    def __init__(self):
        self._stop_event = threading.Event()
        self._force_check = threading.Event()
        self._thread: threading.Thread | None = None
        self._last_check_at: datetime | None = None
        self._next_check_at: datetime | None = None
        # Per-user consecutive failure count for backoff
        self._check_failures: dict[int, int] = {}

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        logger.info("Monitor service started")

    def stop(self):
        self._stop_event.set()
        self._force_check.set()  # Wake the wait immediately
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=10)

    def trigger_check(self):
        """Request an immediate status check, bypassing the normal interval."""
        self._force_check.set()

    def get_status(self) -> dict:
        now = datetime.utcnow()
        next_check_in: int | None = None
        if self._next_check_at is not None:
            delta = (self._next_check_at - now).total_seconds()
            next_check_in = max(0, int(delta))
        return {
            "is_running": self._thread is not None and self._thread.is_alive(),
            "last_check_at": self._last_check_at.isoformat() if self._last_check_at else None,
            "next_check_in_seconds": next_check_in,
            "interval_minutes": self._interval_seconds() // 60,
            "check_interval": self._interval_seconds(),
        }

    def _interval_seconds(self) -> int:
        from app.core.settings_store import settings_store
        minutes = settings_store.get("automatic_interval", settings.DEFAULT_AUTOMATIC_INTERVAL)
        try:
            return max(60, int(minutes) * 60)
        except (TypeError, ValueError):
            return settings.DEFAULT_AUTOMATIC_INTERVAL * 60

    def _run(self):
        # Initial short delay so the app finishes starting up.
        if self._stop_event.wait(15):
            return
        while not self._stop_event.is_set():
            self._last_check_at = datetime.utcnow()
            try:
                self._check_once()
            except Exception as exc:  # pragma: no cover - defensive
                logger.error(f"Monitor loop error: {exc}", exc_info=True)
            interval = self._interval_seconds()
            self._next_check_at = datetime.utcnow() + timedelta(seconds=interval)
            self._force_check.clear()
            # Wait for the interval or a forced check; _stop_event wakes via trigger_check in stop()
            self._force_check.wait(timeout=interval)
            self._force_check.clear()
            if self._stop_event.is_set():
                break

    def _check_once(self):
        from app.core.recorder_service import recorder_service
        from app.core.settings_store import settings_store
        from app.core.unified_avatar_service import unified_avatar_service

        if not recorder_service.is_available():
            return

        # --- Phase 0: retry failed avatar fetches ---
        retryable = unified_avatar_service.get_retryable_usernames()
        if retryable:
            logger.info(f"Retrying avatar fetch for {len(retryable)} users")
            for username in retryable:
                if self._stop_event.is_set():
                    return
                unified_avatar_service.fetch_and_cache(username)
                if self._stop_event.wait(timeout=1.5):
                    return

        # --- Phase 1: fetch monitored users and active recordings (short session) ---
        with get_session() as db:
            monitored = db.query(User).filter(
                User.is_monitoring == True,  # noqa: E712
                User.is_on_watchlist == True,  # noqa: E712
            ).all()
            if not monitored:
                return

            recording_user_ids = {
                rec.user_id
                for rec in db.query(Recording).filter(
                    Recording.status.in_(["pending", "recording"])
                ).all()
            }

        cookies = recorder_service.load_cookies()
        proxy = settings_store.get("proxy", settings.DEFAULT_PROXY)
        bitrate = settings_store.get("default_bitrate", settings.DEFAULT_BITRATE)

        for user in monitored:
            if self._stop_event.is_set():
                break
            if user.id in recording_user_ids:
                continue

            # --- Exponential backoff for users with recent failures ---
            failures = self._check_failures.get(user.id, 0)
            if failures > 0:
                backoff = min(self._BACKOFF_BASE ** failures, self._BACKOFF_MAX)
                logger.debug("Backoff %d s for @%s (%d consecutive failures)",
                             backoff, user.username, failures)
                if self._stop_event.wait(timeout=backoff):
                    return

            # --- Network calls happen with NO DB session held ---
            status_info = recorder_service.check_user_live(user.username)
            is_live = status_info.get("is_live", False)
            room_id = status_info.get("room_id")
            last_checked = datetime.utcnow()

            # --- Update failure counter / log success ---
            if status_info.get("error"):
                self._check_failures[user.id] = failures + 1
            else:
                self._check_failures.pop(user.id, None)

            if not is_live or not room_id:
                # --- Update user status (short session) ---
                with get_session() as db:
                    u = db.query(User).filter(User.id == user.id).first()
                    if u:
                        u.is_live = is_live
                        u.room_id = room_id
                        u.last_checked = last_checked
                        db.commit()
                # Rate-limiting delay between users
                if self._stop_event.wait(timeout=self._INTER_USER_DELAY):
                    return
                continue

            # --- User is live: notify on transition, then record ---
            if not user.is_live:
                try:
                    notification_service.publish(
                        type="user_live",
                        title=f"@{user.username} is live",
                        message="A monitored user just went live — recording is starting.",
                        data={"user_id": user.id, "username": user.username},
                    )
                except Exception:
                    logger.debug("Failed to publish user-live notification", exc_info=True)

            # --- update user and create recording (short session) ---
            filename = generate_recording_filename(user.username)
            with get_session() as db:
                u = db.query(User).filter(User.id == user.id).first()
                if u:
                    u.is_live = True
                    u.room_id = room_id
                    u.last_checked = last_checked
                recording = Recording(
                    user_id=user.id,
                    filename=filename,
                    status="pending",
                    mode="automatic",
                )
                db.add(recording)
                db.commit()
                db.refresh(recording)
                recording_id = recording.id

            started = task_manager.start_recording(
                recording_id=recording_id,
                username=user.username,
                room_id=room_id,
                cookies=cookies,
                proxy=proxy,
                bitrate=bitrate,
            )
            if started:
                logger.info(f"Auto-started recording for @{user.username}")
            else:
                # --- Mark recording as failed (short session) ---
                with get_session() as db:
                    rec = db.query(Recording).filter(Recording.id == recording_id).first()
                    if rec:
                        rec.status = "failed"
                        rec.error_message = "Failed to start automatic recording"
                        db.commit()

            # Rate-limiting delay between users
            if self._stop_event.wait(timeout=self._INTER_USER_DELAY):
                return


monitor_service = MonitorService()
