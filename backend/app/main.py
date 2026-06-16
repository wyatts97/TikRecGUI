import datetime
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db.database import init_db, get_session
from app.db.models import Recording
from app.api.routes import users, recordings, clips, settings as settings_routes
from app.core.task_manager import task_manager, monitor_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # Alembic's env.py calls fileConfig() which resets root logger to
    # WARNING (from alembic.ini).  Restore to INFO so app logs are visible.
    logging.getLogger().setLevel(logging.INFO)
    monitor_service.start()

    # Reconcile orphaned recordings from previous container restarts
    with get_session() as db:
        orphaned = db.query(Recording).filter(Recording.status == "recording").all()
        for rec in orphaned:
            if not task_manager.is_recording(rec.id):
                rec.status = "failed"
                rec.ended_at = datetime.utcnow()
                rec.error_message = "Recording orphaned after app restart"
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
