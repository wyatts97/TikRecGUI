import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db.database import init_db
from app.api.routes import users, recordings, settings as settings_routes
from app.core.task_manager import task_manager

sys.path.insert(0, str(settings.TIKTOK_RECORDER_PATH))


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield
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
app.include_router(settings_routes.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok", "app": settings.APP_NAME}


@app.get("/")
def root():
    return {
        "message": "TikRec WebUI API",
        "docs": "/docs",
        "health": "/api/health"
    }
