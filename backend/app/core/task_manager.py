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
        self._proc: subprocess.Popen | None = None
        self._start_time: float | None = None
    
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

        # --- Phase 2: validate room and get stream URL (no DB) ---
        api_cls = get_tiktok_api_class()
        api = api_cls(proxy=self.proxy, cookies=self.cookies)

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

        # --- Phase 3: capture stream with ffmpeg (no DB session held) ---
        # ffmpeg consumes the live URL directly (HLS m3u8 or FLV) and writes a
        # single continuous MPEG-TS file. TS tolerates mid-stream codec/
        # resolution switches and reconnects far better than appending raw
        # bytes to one file, which previously produced timestamp resets
        # (slow-mo / glitching / audio dropouts) and broke on HLS playlists.
        output_path = Path(settings.RECORDINGS_DIR) / filename
        output_path.parent.mkdir(parents=True, exist_ok=True)
        self._output_path = output_path
        ts_path = output_path.with_suffix(".ts")
        self._ts_path = ts_path

        start_time = time.time()
        self._start_time = start_time

        cmd = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-reconnect", "1",
            "-reconnect_streamed", "1",
            "-reconnect_at_eof", "1",
            "-reconnect_delay_max", "5",
            "-fflags", "+igndts+genpts",
            "-i", live_url,
            "-c", "copy",
            "-f", "mpegts",
        ]
        if self.duration:
            cmd += ["-t", str(self.duration)]
        cmd.append(str(ts_path))

        try:
            self._proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception as e:
            logger.error("Failed to start ffmpeg capture for recording %d: %s",
                         self.recording_id, e)
            _update_recording_status(self.recording_id, "failed", f"Capture failed to start: {e}")
            return

        # Hold until asked to stop, the duration elapses, or the stream ends.
        while not self._stop_event.is_set():
            if self._proc.poll() is not None:
                break
            time.sleep(0.5)

        # Stream ended on its own or duration -t finished: ensure ffmpeg exits.
        if self._proc.poll() is None:
            try:
                if self._proc.stdin:
                    self._proc.stdin.write(b"q")
                    self._proc.stdin.flush()
                self._proc.wait(timeout=10)
            except Exception:
                try:
                    self._proc.terminate()
                    self._proc.wait(timeout=5)
                except Exception:
                    self._proc.kill()

        self._finalize_recording()

    def _finalize_recording(self) -> None:
        """Finalize a recording: flush file, update DB, stop chat, remux, thumbnails.
        Called from _run() on normal exit and from _run_with_error_handling()
        in finally to guarantee it always runs even on unexpected thread death.
        """
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
        duration_seconds = int(time.time() - start_time)
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
                    recording.error_message = recording.error_message or "Output file not created"

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

        # Post-processing — only when a fresh .ts capture is awaiting remux.
        # (Guards against the double-invocation from _run_with_error_handling.)
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
