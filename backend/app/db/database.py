from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from app.config import settings

engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    from app.db import models
    Base.metadata.create_all(bind=engine)

    # Auto-migrate: add profile_pic_url to users if missing (no alembic)
    from sqlalchemy import inspect, text
    inspector = inspect(engine)
    if "users" in inspector.get_table_names():
        columns = [c["name"] for c in inspector.get_columns("users")]
        if "profile_pic_url" not in columns:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE users ADD COLUMN profile_pic_url VARCHAR(512)")
                )
        if "display_name" not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN display_name VARCHAR(255)"))
        if "bio" not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN bio TEXT"))
        if "follower_count" not in columns:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN follower_count INTEGER"))

    if "recordings" in inspector.get_table_names():
        rec_cols = [c["name"] for c in inspector.get_columns("recordings")]
        if "transcript_status" not in rec_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE recordings ADD COLUMN transcript_status VARCHAR(50)"))
        if "transcript_text" not in rec_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE recordings ADD COLUMN transcript_text TEXT"))
