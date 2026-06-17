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
    max_workers=2,
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
    from pathlib import Path
    from alembic.config import Config as AlembicConfig
    from alembic import command
    from alembic.script import ScriptDirectory
    from sqlalchemy import inspect, text

    alembic_cfg = AlembicConfig(
        str(Path(__file__).resolve().parent.parent.parent / "alembic.ini")
    )

    inspector = inspect(engine)

    if "alembic_version" not in inspector.get_table_names():
        # Completely fresh database — create all tables from models,
        # then stamp at head so Alembic knows the schema is current.
        # Running command.upgrade() afterwards would attempt to
        # CREATE TABLE for new models (e.g. live_events) that already
        # exist from create_all() → crash on SQLite.
        from app.db import models
        Base.metadata.create_all(bind=engine)
        command.stamp(alembic_cfg, "head")
        return

    # If alembic_version references a revision whose migration file no longer
    # exists (e.g. after replacing an initial "create all tables" migration
    # with an empty baseline), clear the stale entry so Alembic can start fresh.
    if "alembic_version" in inspector.get_table_names():
        with engine.begin() as conn:
            stored = conn.execute(
                text("SELECT version_num FROM alembic_version")
            ).scalar()
        if stored is not None:
            try:
                ScriptDirectory.from_config(alembic_cfg).get_revision(stored)
            except KeyError:
                with engine.begin() as conn:
                    conn.execute(text("DELETE FROM alembic_version"))

    command.upgrade(alembic_cfg, "head")
