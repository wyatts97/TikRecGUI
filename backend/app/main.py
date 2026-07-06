from datetime import datetime
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db.database import init_db, get_session, run_background
from app.db.models import Recording
from app.core.media_utils import (
    analyze_video_health,
    finalize_segments_to_mp4,
    generate_thumbnail,
    generate_sprite,
    thumbnail_path,
)
from app.core.transcription_service import transcription_service
from app.api.routes import (
    users,
    recordings,
    clips,
    settings as settings_routes,
    stats as stats_routes,
    notifications as notifications_routes,
    search as search_routes,
)
from app.core.task_manager import task_manager, monitor_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)


def _find_orphan_sources(video_path: Path) -> list[Path]:
    """Return any leftover capture segments for a recording whose task died."""
    stem_path = video_path.with_suffix("")
    parts = sorted(
        p for p in video_path.parent.glob(f"{stem_path.name}.part*.ts")
        if p.exists() and p.stat().st_size > 0
    )
    if parts:
        return parts
    lone_ts = video_path.with_suffix(".ts")
    if lone_ts.exists() and lone_ts.stat().st_size > 0:
        return [lone_ts]
    return []


def _recover_orphaned_recording(recording_id: int, filename: str) -> None:
    """Background finalize for a recording left in 'recording'/'processing' after a crash."""
    video_path = Path(settings.RECORDINGS_DIR) / filename
    sources = _find_orphan_sources(video_path)
    if not sources:
        with get_session() as db:
            rec = db.query(Recording).filter(Recording.id == recording_id).first()
            if rec and rec.status in ("recording", "processing"):
                rec.status = "failed"
                rec.is_corrupt = True
                rec.ended_at = datetime.utcnow()
                rec.error_message = rec.error_message or "Recording orphaned after restart — no capture files found"
                db.commit()
                logger.warning("No capture files for orphan recording %d; marked failed", recording_id)
        return

    logger.info("Recovering orphan recording %d from %d source(s)", recording_id, len(sources))
    try:
        ok, actual_duration = finalize_segments_to_mp4(sources, video_path)
    except Exception:
        logger.exception("Orphan recovery finalize raised for recording %d", recording_id)
        ok = False

    if ok and video_path.exists() and video_path.stat().st_size > 0:
        for src in sources:
            src.unlink(missing_ok=True)
        health = analyze_video_health(video_path)
        with get_session() as db:
            rec = db.query(Recording).filter(Recording.id == recording_id).first()
            if rec:
                rec.status = "stopped" if rec.status == "stopped" else "completed"
                rec.is_corrupt = health.get("is_corrupt", False)
                rec.ended_at = datetime.utcnow()
                rec.file_size = video_path.stat().st_size
                rec.duration_seconds = int(round(actual_duration)) if actual_duration else rec.duration_seconds
                rec.error_message = None
                if rec.transcript_status is None:
                    rec.transcript_status = "pending"
                db.commit()
        run_background(generate_thumbnail, video_path, thumbnail_path(video_path), recording_id)
        run_background(generate_sprite, video_path)
        transcription_service.enqueue(recording_id)
        logger.info("Orphan recording %d recovered successfully", recording_id)
    else:
        with get_session() as db:
            rec = db.query(Recording).filter(Recording.id == recording_id).first()
            if rec and rec.status in ("recording", "processing"):
                rec.status = "failed"
                rec.is_corrupt = True
                rec.ended_at = datetime.utcnow()
                rec.error_message = rec.error_message or "Orphan recovery failed — could not finalize capture"
                db.commit()
        logger.error("Orphan recovery failed for recording %d; sources kept for manual repair", recording_id)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # Alembic's env.py calls fileConfig() which resets root logger to
    # WARNING (from alembic.ini).  Restore to INFO so app logs are visible.
    logging.getLogger().setLevel(logging.INFO)
    monitor_service.start()

    # Reconcile orphaned recordings from previous container restarts.
    # Rows stuck in 'recording'/'processing' with no running task are either
    # failed or recoverable from the leftover .ts/.part files on disk.
    with get_session() as db:
        orphaned = (
            db.query(Recording)
            .filter(Recording.status.in_(("recording", "processing")))
            .all()
        )
        for rec in orphaned:
            if task_manager.is_recording(rec.id):
                continue
            sources = _find_orphan_sources(Path(settings.RECORDINGS_DIR) / rec.filename)
            if sources:
                run_background(_recover_orphaned_recording, rec.id, rec.filename)
            else:
                rec.status = "failed"
                rec.is_corrupt = True
                rec.ended_at = datetime.utcnow()
                rec.error_message = rec.error_message or "Recording orphaned after app restart"
                db.commit()
                logger.warning(
                    "Reconciled orphaned recording %d for @%s (%s)",
                    rec.id, rec.user.username, rec.filename,
                )

    yield
    monitor_service.stop()
    task_manager.shutdown()


app = FastAPI(
    title=settings.APP_NAME,
    description="WebUI for TikTok Live Recorder",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router, prefix="/api")
app.include_router(recordings.router, prefix="/api")
app.include_router(clips.router, prefix="/api")
app.include_router(settings_routes.router, prefix="/api")
app.include_router(stats_routes.router, prefix="/api")
app.include_router(notifications_routes.router, prefix="/api")
app.include_router(search_routes.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok", "app": settings.APP_NAME}


@app.get("/")
def root():
    return {
        "message": "TikRec WebUI API",
        "docs": "/docs",
        "health": "/api/health"
    }
