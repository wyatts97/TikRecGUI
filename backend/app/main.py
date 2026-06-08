from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db.database import init_db
from app.api.routes import users, recordings, settings as settings_routes
from app.core.task_manager import task_manager, monitor_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    monitor_service.start()
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
