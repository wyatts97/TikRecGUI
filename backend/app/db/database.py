from contextlib import contextmanager, asynccontextmanager
from concurrent.futures import ThreadPoolExecutor
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import NullPool

from app.config import settings

# ---------------------------------------------------------------------------
# Sync engine (legacy, used by background threads & sync routes)
# ---------------------------------------------------------------------------

engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=NullPool,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# ---------------------------------------------------------------------------
# Async engine (hot-path routes)
# ---------------------------------------------------------------------------

ASYNC_DATABASE_URL = settings.DATABASE_URL.replace("sqlite:///", "sqlite+aiosqlite:///", 1)

async_engine = create_async_engine(
    ASYNC_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=NullPool,
)

AsyncSessionLocal = async_sessionmaker(
    async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

# ---------------------------------------------------------------------------

Base = declarative_base()

# -- Shared thread pool for fire-and-forget background tasks ----------
background_executor = ThreadPoolExecutor(
    max_workers=4,
    thread_name_prefix="bg",
)


def run_background(fn, *args, **kwargs):
    """Submit a fire-and-forget callable to the shared background pool."""
    return background_executor.submit(fn, *args, **kwargs)


# -- DB session management --------------------------------------------

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@asynccontextmanager
async def async_get_db():
    """Async context / FastAPI dependency for hot-path endpoints.

    Usage in route files::

        async def list_users(db: AsyncSession = Depends(async_get_db)):
            ...
    """
    async with AsyncSessionLocal() as db:
        yield db


@contextmanager
def get_session():
    """Context manager for short-lived background DB sessions.

    Usage::

        with get_session() as db:
            db.query(...)
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from app.db import models
    Base.metadata.create_all(bind=engine)

    # Run Alembic migrations to bring existing databases up to date
    from pathlib import Path
    from alembic.config import Config as AlembicConfig
    from alembic import command

    alembic_cfg = AlembicConfig(
        str(Path(__file__).resolve().parent.parent.parent / "alembic.ini")
    )
    command.upgrade(alembic_cfg, "head")
