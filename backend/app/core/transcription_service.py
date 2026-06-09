import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


from app.config import settings

logger = logging.getLogger(__name__)

_MODEL_LOCK = threading.Lock()
_model = None


def _get_model():
    """Lazy-load the Whisper model (large-v3 by default, falls back to tiny)."""
    global _model
    if _model is not None:
        return _model
    with _MODEL_LOCK:
        if _model is not None:
            return _model
        try:
            from faster_whisper import WhisperModel
            model_size = "base"
            logger.info(f"Loading Whisper model: {model_size}")
            _model = WhisperModel(model_size, device="cpu", compute_type="int8")
            logger.info("Whisper model loaded")
        except Exception as exc:
            logger.error(f"Failed to load Whisper model: {exc}")
        return _model


class TranscriptionService:
    """Transcribe completed recordings using faster-whisper.

    Up to ``MAX_WORKERS`` transcriptions run concurrently. Additional
    requests are queued and dispatched in FIFO order as workers become
    available.
    """

    MAX_WORKERS = 2

    def __init__(self):
        self._queue: list[int] = []
        self._queue_cond = threading.Condition()
        self._executor = ThreadPoolExecutor(
            max_workers=self.MAX_WORKERS,
            thread_name_prefix="transcribe",
        )
        self._dispatcher = threading.Thread(target=self._dispatcher_loop, daemon=True)
        self._dispatcher.start()

    def enqueue(self, recording_id: int) -> None:
        """Add a recording to the transcription queue."""
        with self._queue_cond:
            if recording_id not in self._queue:
                self._queue.append(recording_id)
                logger.info(f"Enqueued recording {recording_id} for transcription (queue len={len(self._queue)})")
                self._queue_cond.notify()

    def get_queue(self) -> list[int]:
        """Return a copy of the current queue (for status/debug)."""
        with self._queue_cond:
            return list(self._queue)

    def _dispatcher_loop(self) -> None:
        """Background dispatcher: pulls from queue, submits to thread pool."""
        while True:
            recording_id: int | None = None
            with self._queue_cond:
                while not self._queue:
                    self._queue_cond.wait()
                recording_id = self._queue.pop(0)

            logger.info("Dispatching transcription for recording %s (queue len=%s)",
                        recording_id, len(self._queue))
            self._executor.submit(self._run, recording_id)

    def _run(self, recording_id: int) -> None:
        from app.db.database import get_session
        from app.db.models import Recording

        try:
            with get_session() as db:
                recording = db.query(Recording).filter(Recording.id == recording_id).first()
                if not recording:
                    return
                if recording.status not in ("completed", "stopped"):
                    return

                recording.transcript_status = "processing"
                db.commit()

                video_path = Path(settings.RECORDINGS_DIR) / recording.filename
                if not video_path.exists():
                    recording.transcript_status = "failed"
                    db.commit()
                    return

                model = _get_model()
                if model is None:
                    recording.transcript_status = "failed"
                    db.commit()
                    return

                segments, _info = model.transcribe(str(video_path), beam_size=5)
                parts = []
                for seg in segments:
                    start = _fmt_timestamp(seg.start)
                    end = _fmt_timestamp(seg.end)
                    parts.append(f"[{start} --> {end}] {seg.text.strip()}")

                recording.transcript_text = "\n".join(parts)
                recording.transcript_status = "done"
                db.commit()
                logger.info(f"Transcription done for recording {recording_id}")

        except Exception as exc:
            logger.error(f"Transcription failed for recording {recording_id}: {exc}", exc_info=True)
            try:
                with get_session() as db:
                    recording = db.query(Recording).filter(Recording.id == recording_id).first()
                    if recording:
                        recording.transcript_status = "failed"
                        db.commit()
            except Exception:
                pass

    def search(self, query: str, db) -> list[dict]:
        """Return recording IDs and snippet matches for a transcript text search."""
        from app.db.models import Recording
        from sqlalchemy import func

        results = (
            db.query(Recording)
            .filter(
                Recording.transcript_status == "done",
                func.lower(Recording.transcript_text).contains(query.lower()),
            )
            .all()
        )
        out = []
        for rec in results:
            snippet = _extract_snippet(rec.transcript_text or "", query)
            out.append({"recording_id": rec.id, "username": rec.username, "snippet": snippet})
        return out


def _fmt_timestamp(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


def _extract_snippet(text: str, query: str, context: int = 80) -> str:
    idx = text.lower().find(query.lower())
    if idx == -1:
        return text[:160]
    start = max(0, idx - context)
    end = min(len(text), idx + len(query) + context)
    return ("…" if start > 0 else "") + text[start:end] + ("…" if end < len(text) else "")


transcription_service = TranscriptionService()
