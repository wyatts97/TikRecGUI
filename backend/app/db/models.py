from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, BigInteger
from sqlalchemy.orm import relationship

from app.db.database import Base


class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(255), unique=True, index=True, nullable=False)
    room_id = Column(String(255), nullable=True)
    is_monitoring = Column(Boolean, default=False)
    is_live = Column(Boolean, default=False)
    last_checked = Column(DateTime, nullable=True)
    profile_pic_url = Column(String(512), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    recordings = relationship("Recording", back_populates="user", cascade="all, delete-orphan")


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
    created_at = Column(DateTime, default=datetime.utcnow)
    
    user = relationship("User", back_populates="recordings")


class Setting(Base):
    __tablename__ = "settings"
    
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(255), unique=True, index=True, nullable=False)
    value = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
