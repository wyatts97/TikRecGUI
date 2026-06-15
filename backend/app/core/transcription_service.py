import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


from app.config import settings

logger = logging.getLogger(__name__)

_MODEL_LOCK = threading.Lock()
_model = None

# Local cache directory — the Dockerfile pre-downloads the model here at
# build time so no HuggingFace traffic is needed at runtime.
_WHISPER_CACHE_DIR = Path(settings.DATA_DIR) / "whisper_cache"


def _get_model():
    """Lazy-load the faster-whisper model from the local cache directory.

    Uses beam_size=1 (greedy) and VAD filtering for CPU-optimised speed.
    The model is expected to be pre-downloaded at Docker build time to
    ``/app/data/whisper_cache``; if not present, faster-whisper falls back
    to its default HuggingFace download as usual.
    """
    global _model
    if _model is not None:
        return _model
    with _MODEL_LOCK:
        if _model is not None:
            return _model
        try:
            from faster_whisper import WhisperModel
            model_size = "base"
            _WHISPER_CACHE_DIR.mkdir(parents=True, exist_ok=True)
            logger.info("Loading Whisper model '%s' from cache: %s", model_size, _WHISPER_CACHE_DIR)
            _model = WhisperModel(
                model_size,
                device="cpu",
                compute_type="int8",
                download_root=str(_WHISPER_CACHE_DIR),
            )
            logger.info("Whisper model loaded")
        except Exception as exc:
            logger.error("Failed to load Whisper model: %s", exc)
        return _model


def _reset_stuck_processing(db) -> None:
    """Reset any recordings stuck in 'processing' to 'failed'.

    Called once at startup so records orphaned by a previous container
    restart are not left in a permanent 'processing' state.
    """
    from app.db.models import Recording
    try:
        stuck = db.query(Recording).filter(Recording.transcript_status == "processing").all()
        for rec in stuck:
            rec.transcript_status = "failed"
            logger.warning(
                "Reset stuck transcription for recording %d (%s) to 'failed'",
                rec.id, rec.filename,
            )
        if stuck:
            db.commit()
    except Exception as exc:
        logger.error("Failed to reset stuck transcriptions: %s", exc)


class TranscriptionService:
    """Transcribe completed recordings using faster-whisper.

    Up to ``MAX_WORKERS`` transcriptions run concurrently. Additional
    requests are queued and dispatched in FIFO order as workers become
    available.

    The DB session is intentionally kept open only for short reads/writes
    and is always closed before the long-running Whisper inference starts,
    so SQLite is never locked for the duration of a transcription job.
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
        self._reset_stuck_on_startup()

    def _reset_stuck_on_startup(self) -> None:
        """Reset any 'processing' records left over from a previous crash."""
        try:
            from app.db.database import get_session
            with get_session() as db:
                _reset_stuck_processing(db)
        except Exception as exc:
            logger.error("Startup stuck-transcription reset failed: %s", exc)

    def enqueue(self, recording_id: int) -> None:
        """Add a recording to the transcription queue."""
        with self._queue_cond:
            if recording_id not in self._queue:
                self._queue.append(recording_id)
                logger.info(
                    "Enqueued recording %d for transcription (queue len=%d)",
                    recording_id, len(self._queue),
                )
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

            logger.info(
                "Dispatching transcription for recording %d (queue len=%d)",
                recording_id, len(self._queue),
            )
            self._executor.submit(self._run, recording_id)

    def _run(self, recording_id: int) -> None:
        from app.db.database import get_session
        from app.db.models import Recording

        # --- Phase 1: short DB read — validate and mark as processing ---
        video_path: Path | None = None
        try:
            with get_session() as db:
                recording = db.query(Recording).filter(Recording.id == recording_id).first()
                if not recording:
                    return
                if recording.status not in ("completed", "stopped"):
                    return
                video_path = Path(settings.RECORDINGS_DIR) / recording.filename
                if not video_path.exists():
                    recording.transcript_status = "failed"
                    db.commit()
                    logger.warning("Transcription skipped for recording %d: file not found", recording_id)
                    return
                recording.transcript_status = "processing"
                db.commit()
        except Exception as exc:
            logger.error("Transcription pre-check failed for recording %d: %s", recording_id, exc)
            return

        # --- Phase 2: load model (outside DB session) ---
        model = _get_model()
        if model is None:
            try:
                with get_session() as db:
                    rec = db.query(Recording).filter(Recording.id == recording_id).first()
                    if rec:
                        rec.transcript_status = "failed"
                        db.commit()
            except Exception:
                pass
            return

        # --- Phase 3: run Whisper inference (no DB session held) ---
        try:
            logger.info("Starting Whisper inference for recording %d (%s)", recording_id, video_path.name)
            segments, info = model.transcribe(
                str(video_path),
                beam_size=1,
                vad_filter=True,
            )
            parts = []
            for seg in segments:
                start = _fmt_timestamp(seg.start)
                end = _fmt_timestamp(seg.end)
                parts.append(f"[{start} --> {end}] {seg.text.strip()}")
            transcript_text = "\n".join(parts)
            logger.info(
                "Whisper inference done for recording %d — %d segments, lang=%s (%.0f%%)",
                recording_id, len(parts), info.language, info.language_probability * 100,
            )
        except Exception as exc:
            logger.error("Whisper inference failed for recording %d: %s", recording_id, exc, exc_info=True)
            try:
                with get_session() as db:
                    rec = db.query(Recording).filter(Recording.id == recording_id).first()
                    if rec:
                        rec.transcript_status = "failed"
                        db.commit()
            except Exception:
                pass
            return

        # --- Phase 4: short DB write — persist results ---
        try:
            with get_session() as db:
                rec = db.query(Recording).filter(Recording.id == recording_id).first()
                if rec:
                    rec.transcript_text = transcript_text
                    rec.transcript_status = "done"
                    db.commit()
                    logger.info("Transcription saved for recording %d", recording_id)
        except Exception as exc:
            logger.error("Failed to save transcription for recording %d: %s", recording_id, exc)

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
