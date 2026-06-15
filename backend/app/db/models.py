from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, BigInteger, Float
from sqlalchemy.orm import relationship

from app.db.database import Base


class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(255), unique=True, index=True, nullable=False)
    display_name = Column(String(255), nullable=True)
    bio = Column(Text, nullable=True)
    follower_count = Column(Integer, nullable=True)
    room_id = Column(String(255), nullable=True)
    is_monitoring = Column(Boolean, default=False)
    is_live = Column(Boolean, default=False)
    is_on_watchlist = Column(Boolean, default=True)
    last_checked = Column(DateTime, nullable=True)
    profile_pic_url = Column(String(512), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    recordings = relationship("Recording", back_populates="user")


class Recording(Base):
    __tablename__ = "recordings"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    filename = Column(String(512), nullable=False)
    status = Column(String(50), default="pending")  # pending, recording, completed, failed, stopped
    mode = Column(String(50), default="manual")  # manual, automatic
    started_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)
    duration_seconds = Column(Integer, nullable=True)
    file_size = Column(BigInteger, nullable=True)
    error_message = Column(Text, nullable=True)
    transcript_status = Column(String(50), nullable=True)  # pending, processing, done, failed
    transcript_text = Column(Text, nullable=True)
    sprite_ready = Column(Boolean, default=False)
    is_favorite = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship("User", back_populates="recordings")
    live_events = relationship("LiveEvent", back_populates="recording", cascade="all, delete-orphan")


class Clip(Base):
    __tablename__ = "clips"

    id = Column(Integer, primary_key=True, index=True)
    recording_id = Column(Integer, ForeignKey("recordings.id"), nullable=False)
    title = Column(String(255), nullable=True)
    filename = Column(String(512), nullable=False)
    start_time = Column(Integer, nullable=False)
    end_time = Column(Integer, nullable=False)
    duration_seconds = Column(Integer, nullable=True)
    file_size = Column(BigInteger, nullable=True)
    thumbnail_ready = Column(Boolean, default=False)
    sprite_ready = Column(Boolean, default=False)
    is_favorite = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    recording = relationship("Recording")


class LiveEvent(Base):
    __tablename__ = "live_events"

    id = Column(Integer, primary_key=True, index=True)
    recording_id = Column(Integer, ForeignKey("recordings.id"), nullable=False, index=True)
    offset_seconds = Column(Float, nullable=False)
    event_type = Column(String(20), nullable=False)  # "chat" or "gift"
    user_nickname = Column(String(255), nullable=False)
    user_unique_id = Column(String(255), nullable=True)
    content = Column(Text, nullable=True)
    gift_name = Column(String(255), nullable=True)
    gift_diamond_count = Column(Integer, nullable=True)
    gift_repeat_count = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    recording = relationship("Recording", back_populates="live_events")


class Setting(Base):
    __tablename__ = "settings"
    
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(255), unique=True, index=True, nullable=False)
    value = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
