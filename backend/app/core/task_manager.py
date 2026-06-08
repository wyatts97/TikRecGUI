import time
import logging
import threading
import subprocess
from datetime import datetime
from pathlib import Path

from app.config import settings
from app.db.database import SessionLocal
from app.db.models import Recording, User
from app.core.recorder_loader import get_tiktok_api_class


def _generate_thumbnail(video_path: Path) -> Path | None:
    thumb_path = video_path.with_suffix("").with_name(video_path.stem + "_thumb.jpg")
    thumb_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            [
                "ffmpeg", "-y", "-ss", "00:00:01", "-vframes", "1",
                "-i", str(video_path), "-vf", "scale=480:-1",
                str(thumb_path),
            ],
            capture_output=True,
            check=True,
            timeout=30,
        )
        if thumb_path.exists():
            return thumb_path
    except Exception:
        logger.warning(f"Thumbnail generation failed for {video_path}")
    return None

logger = logging.getLogger("tikrec.task_manager")


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
    
    def start(self):
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
    
    def stop(self):
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=10)
    
    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()
    
    def _run(self):
        db = SessionLocal()
        try:
            recording = db.query(Recording).filter(Recording.id == self.recording_id).first()
            if not recording:
                return
            
            recording.status = "recording"
            recording.started_at = datetime.utcnow()
            db.commit()
            
            api_cls = get_tiktok_api_class()
            api = api_cls(proxy=self.proxy, cookies=self.cookies)
            
            if not api.is_room_alive(self.room_id):
                recording.status = "failed"
                recording.error_message = "User is not live"
                recording.ended_at = datetime.utcnow()
                db.commit()
                return
            
            live_url = api.get_live_url(self.room_id)
            if not live_url:
                recording.status = "failed"
                recording.error_message = "Could not get live stream URL"
                recording.ended_at = datetime.utcnow()
                db.commit()
                return
            
            output_path = Path(settings.RECORDINGS_DIR) / recording.filename
            output_path.parent.mkdir(parents=True, exist_ok=True)
            
            buffer_size = 512 * 1024
            buffer = bytearray()
            start_time = time.time()
            
            with open(output_path, "wb") as out_file:
                while not self._stop_event.is_set():
                    try:
                        if not api.is_room_alive(self.room_id):
                            break
                        
                        for chunk in api.download_live_stream(live_url):
                            if self._stop_event.is_set():
                                break
                            
                            buffer.extend(chunk)
                            if len(buffer) >= buffer_size:
                                out_file.write(buffer)
                                buffer.clear()
                            
                            elapsed = time.time() - start_time
                            if self.duration and elapsed >= self.duration:
                                self._stop_event.set()
                                break
                    
                    except Exception as e:
                        logger.warning(f"Stream error, retrying: {e}")
                        time.sleep(2)
                        if self._stop_event.is_set():
                            break
                
                if buffer:
                    out_file.write(buffer)
                    buffer.clear()
            
            recording.ended_at = datetime.utcnow()
            recording.duration_seconds = int(time.time() - start_time)
            
            if output_path.exists():
                recording.file_size = output_path.stat().st_size
                recording.status = "completed" if not self._stop_event.is_set() else "stopped"
            else:
                recording.status = "failed"
                recording.error_message = "Output file not created"

            db.commit()

            if output_path.exists() and recording.status in ("completed", "stopped"):
                threading.Thread(target=_generate_thumbnail, args=(output_path,), daemon=True).start()

        except Exception as e:
            logger.error(f"Recording error: {e}", exc_info=True)
            try:
                recording = db.query(Recording).filter(Recording.id == self.recording_id).first()
                if recording:
                    recording.status = "failed"
                    recording.error_message = str(e)
                    recording.ended_at = datetime.utcnow()
                    db.commit()
            except Exception:
                pass
        finally:
            db.close()


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
    """

    def __init__(self):
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        logger.info("Monitor service started")

    def stop(self):
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=10)

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
            try:
                self._check_once()
            except Exception as exc:  # pragma: no cover - defensive
                logger.error(f"Monitor loop error: {exc}", exc_info=True)
            if self._stop_event.wait(self._interval_seconds()):
                break

    def _check_once(self):
        from app.core.recorder_service import recorder_service
        from app.core.settings_store import settings_store

        if not recorder_service.is_available():
            return

        db = SessionLocal()
        try:
            monitored = db.query(User).filter(User.is_monitoring == True).all()  # noqa: E712
            if not monitored:
                return

            active_ids = set(task_manager.get_active_recordings())
            recording_user_ids = {
                rec.user_id
                for rec in db.query(Recording).filter(Recording.id.in_(active_ids)).all()
            } if active_ids else set()

            cookies = recorder_service._load_cookies()
            proxy = settings_store.get("proxy", settings.DEFAULT_PROXY)
            bitrate = settings_store.get("default_bitrate", settings.DEFAULT_BITRATE)

            for user in monitored:
                if self._stop_event.is_set():
                    break
                if user.id in recording_user_ids:
                    continue

                status_info = recorder_service.check_user_live(user.username)
                user.is_live = status_info.get("is_live", False)
                user.room_id = status_info.get("room_id")
                user.last_checked = datetime.utcnow()
                db.commit()

                if not user.is_live or not user.room_id:
                    continue

                filename = (
                    f"TK_{user.username}_"
                    f"{time.strftime('%Y.%m.%d_%H-%M-%S', time.localtime())}_flv.mp4"
                )
                recording = Recording(
                    user_id=user.id,
                    filename=filename,
                    status="pending",
                    mode="automatic",
                )
                db.add(recording)
                db.commit()
                db.refresh(recording)

                started = task_manager.start_recording(
                    recording_id=recording.id,
                    username=user.username,
                    room_id=user.room_id,
                    cookies=cookies,
                    proxy=proxy,
                    bitrate=bitrate,
                )
                if started:
                    logger.info(f"Auto-started recording for @{user.username}")
                else:
                    recording.status = "failed"
                    recording.error_message = "Failed to start automatic recording"
                    db.commit()
        finally:
            db.close()


monitor_service = MonitorService()
