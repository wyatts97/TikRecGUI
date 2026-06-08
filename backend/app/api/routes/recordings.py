import os
import json
import time
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.db.database import get_db
from app.db.models import Recording, User
from app.schemas.recording import (
    RecordingStart,
    RecordingResponse,
    RecordingListResponse,
    ActiveRecordingResponse
)
from app.core.recorder_service import recorder_service
from app.core.task_manager import task_manager
from app.core.settings_store import settings_store

router = APIRouter(prefix="/recordings", tags=["recordings"])


def _load_cookies() -> dict | None:
    if settings.COOKIES_FILE.exists():
        try:
            with open(settings.COOKIES_FILE, "r") as f:
                cookies = json.load(f)
                if cookies.get("sessionid_ss"):
                    return cookies
        except (json.JSONDecodeError, IOError):
            pass
    return None


@router.get("", response_model=RecordingListResponse)
def list_recordings(
    page: int = 1,
    page_size: int = 20,
    status_filter: str | None = None,
    user_id: int | None = None,
    db: Session = Depends(get_db)
):
    query = db.query(Recording).join(User)
    
    if status_filter:
        query = query.filter(Recording.status == status_filter)
    if user_id:
        query = query.filter(Recording.user_id == user_id)
    
    total = query.count()
    
    recordings = (
        query
        .order_by(Recording.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    
    response_recordings = []
    for rec in recordings:
        response_recordings.append(RecordingResponse(
            id=rec.id,
            user_id=rec.user_id,
            username=rec.user.username,
            filename=rec.filename,
            status=rec.status,
            mode=rec.mode,
            started_at=rec.started_at,
            ended_at=rec.ended_at,
            duration_seconds=rec.duration_seconds,
            file_size=rec.file_size,
            error_message=rec.error_message,
            created_at=rec.created_at
        ))
    
    return RecordingListResponse(
        recordings=response_recordings,
        total=total,
        page=page,
        page_size=page_size
    )


@router.post("/start", response_model=RecordingResponse, status_code=status.HTTP_201_CREATED)
def start_recording(request: RecordingStart, db: Session = Depends(get_db)):
    if not request.username and not request.url and not request.room_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Must provide username, url, or room_id"
        )
    
    username = request.username
    room_id = request.room_id
    
    if request.url:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="URL parsing not yet implemented. Please use username instead."
        )
    
    if username:
        username = username.lstrip("@").strip()
        status_info = recorder_service.check_user_live(username)
        
        if status_info.get("error"):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=status_info["error"]
            )
        
        if not status_info.get("is_live"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"User @{username} is not currently live"
            )
        
        room_id = status_info.get("room_id")
    
    if not room_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not determine room_id"
        )
    
    user = db.query(User).filter(User.username == username).first()
    if not user:
        user = User(
            username=username,
            room_id=room_id,
            is_live=True,
            last_checked=datetime.utcnow()
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    
    filename = f"TK_{username}_{time.strftime('%Y.%m.%d_%H-%M-%S', time.localtime())}_flv.mp4"
    
    recording = Recording(
        user_id=user.id,
        filename=filename,
        status="pending",
        mode=request.mode
    )
    db.add(recording)
    db.commit()
    db.refresh(recording)
    
    cookies = _load_cookies()
    
    success = task_manager.start_recording(
        recording_id=recording.id,
        username=username,
        room_id=room_id,
        duration=request.duration,
        bitrate=request.bitrate or settings_store.get("default_bitrate", settings.DEFAULT_BITRATE),
        cookies=cookies,
        proxy=settings_store.get("proxy", settings.DEFAULT_PROXY)
    )
    
    if not success:
        recording.status = "failed"
        recording.error_message = "Failed to start recording task"
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to start recording"
        )
    
    db.refresh(recording)
    
    return RecordingResponse(
        id=recording.id,
        user_id=recording.user_id,
        username=user.username,
        filename=recording.filename,
        status=recording.status,
        mode=recording.mode,
        started_at=recording.started_at,
        ended_at=recording.ended_at,
        duration_seconds=recording.duration_seconds,
        file_size=recording.file_size,
        error_message=recording.error_message,
        created_at=recording.created_at
    )


@router.get("/active", response_model=list[ActiveRecordingResponse])
def get_active_recordings(db: Session = Depends(get_db)):
    task_manager.cleanup_finished()
    active_ids = task_manager.get_active_recordings()
    
    recordings = db.query(Recording).filter(Recording.id.in_(active_ids)).all()
    
    result = []
    for rec in recordings:
        duration = None
        if rec.started_at:
            duration = int((datetime.utcnow() - rec.started_at).total_seconds())
        
        result.append(ActiveRecordingResponse(
            id=rec.id,
            username=rec.user.username,
            status=rec.status,
            started_at=rec.started_at,
            duration_seconds=duration
        ))
    
    return result


@router.get("/{recording_id}", response_model=RecordingResponse)
def get_recording(recording_id: int, db: Session = Depends(get_db)):
    recording = db.query(Recording).filter(Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recording not found"
        )
    
    return RecordingResponse(
        id=recording.id,
        user_id=recording.user_id,
        username=recording.user.username,
        filename=recording.filename,
        status=recording.status,
        mode=recording.mode,
        started_at=recording.started_at,
        ended_at=recording.ended_at,
        duration_seconds=recording.duration_seconds,
        file_size=recording.file_size,
        error_message=recording.error_message,
        created_at=recording.created_at
    )


@router.post("/{recording_id}/stop", response_model=RecordingResponse)
def stop_recording(recording_id: int, db: Session = Depends(get_db)):
    recording = db.query(Recording).filter(Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recording not found"
        )
    
    if recording.status not in ["pending", "recording"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Recording is not active (status: {recording.status})"
        )
    
    task_manager.stop_recording(recording_id)
    
    db.refresh(recording)
    
    return RecordingResponse(
        id=recording.id,
        user_id=recording.user_id,
        username=recording.user.username,
        filename=recording.filename,
        status=recording.status,
        mode=recording.mode,
        started_at=recording.started_at,
        ended_at=recording.ended_at,
        duration_seconds=recording.duration_seconds,
        file_size=recording.file_size,
        error_message=recording.error_message,
        created_at=recording.created_at
    )


@router.delete("/{recording_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recording(recording_id: int, db: Session = Depends(get_db)):
    recording = db.query(Recording).filter(Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recording not found"
        )
    
    if task_manager.is_recording(recording_id):
        task_manager.stop_recording(recording_id)
    
    file_path = Path(settings.RECORDINGS_DIR) / recording.filename
    if file_path.exists():
        try:
            os.remove(file_path)
        except OSError:
            pass
    
    db.delete(recording)
    db.commit()
    return None


@router.get("/{recording_id}/download")
def download_recording(recording_id: int, db: Session = Depends(get_db)):
    recording = db.query(Recording).filter(Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recording not found"
        )
    
    file_path = Path(settings.RECORDINGS_DIR) / recording.filename
    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recording file not found"
        )
    
    return FileResponse(
        path=str(file_path),
        filename=recording.filename,
        media_type="video/mp4"
    )
