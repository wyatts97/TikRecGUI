import sys
import time
import asyncio
import threading
from datetime import datetime
from pathlib import Path
from typing import Any
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy.orm import Session

from app.config import settings
from app.db.database import SessionLocal
from app.db.models import Recording, User

sys.path.insert(0, str(settings.TIKTOK_RECORDER_PATH))

from core.tiktok_api import TikTokAPI
from utils.logger_manager import logger


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
            
            api = TikTokAPI(proxy=self.proxy, cookies=self.cookies)
            
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
