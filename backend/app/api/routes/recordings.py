import os
import json
import time
import logging
import subprocess
import threading
import zipfile
import tempfile

from datetime import datetime
from pathlib import Path
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, Body
from fastapi.responses import FileResponse, Response
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
from app.core.task_manager import task_manager, _generate_sprite as _gen_sprite
from app.core.transcription_service import transcription_service
from app.core.settings_store import settings_store

logger = logging.getLogger("tikrec.recordings")


def _thumbnail_path(video_path: Path) -> Path:
    return video_path.with_suffix("").with_name(video_path.stem + "_thumb.jpg")


def _generate_thumbnail(video_path: Path, thumb_path: Path) -> bool:
    if not video_path.exists():
        return False
    thumb_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Try different seek positions in case video is short or has issues at start
    seek_positions = ["1", "0.5", "2", "0"]
    
    for seek_time in seek_positions:
        try:
            subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-ss", seek_time,
                    "-i", str(video_path),
                    "-vframes", "1",
                    "-vf", "scale=480:-2",
                    str(thumb_path),
                ],
                capture_output=True,
                timeout=30,
            )
            if thumb_path.exists() and thumb_path.stat().st_size > 0:
                return True
        except Exception as exc:
            logger.warning(f"Thumbnail seek={seek_time} failed for {video_path}: {exc}")
            continue

    return False

router = APIRouter(prefix="/recordings", tags=["recordings"])


_thumb_retry_in_progress: set[int] = set()
_sprite_retry_in_progress: set[int] = set()


def _is_thumbnail_ready(recording: Recording) -> bool:
    video_path = Path(settings.RECORDINGS_DIR) / recording.filename
    thumb_path = _thumbnail_path(video_path)
    if thumb_path.exists() and thumb_path.stat().st_size > 0:
        return True
    # Kick off a background retry for completed recordings that lost their thumbnail
    if (
        recording.status in ("completed", "stopped")
        and video_path.exists()
        and recording.id not in _thumb_retry_in_progress
    ):
        _thumb_retry_in_progress.add(recording.id)
        threading.Thread(
            target=_generate_thumbnail,
            args=(video_path, thumb_path),
            daemon=True,
        ).start()
    return False


def _is_sprite_ready(recording: Recording) -> bool:
    video_path = Path(settings.RECORDINGS_DIR) / recording.filename
    sprite_path = video_path.with_name(video_path.stem + "_sprite.jpg")
    vtt_path = video_path.with_name(video_path.stem + "_sprite.vtt")
    if sprite_path.exists() and sprite_path.stat().st_size > 0 and vtt_path.exists() and vtt_path.stat().st_size > 0:
        return True
    # Kick off a background retry for completed recordings missing sprites
    if (
        recording.status in ("completed", "stopped")
        and video_path.exists()
        and recording.id not in _sprite_retry_in_progress
    ):
        _sprite_retry_in_progress.add(recording.id)
        threading.Thread(
            target=_gen_sprite,
            args=(video_path,),
            daemon=True,
        ).start()
    return False


def _build_response(rec: Recording) -> RecordingResponse:
    return RecordingResponse(
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
        created_at=rec.created_at,
        thumbnail_ready=_is_thumbnail_ready(rec),
        sprite_ready=_is_sprite_ready(rec),
        transcript_status=rec.transcript_status,
        transcript_text=rec.transcript_text,
    )


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
    sort_by: str = "date",
    sort_order: str = "desc",
    username_filter: str | None = None,
    min_size: int | None = None,
    max_size: int | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    db: Session = Depends(get_db)
):
    query = db.query(Recording).join(User)

    if status_filter:
        if "," in status_filter:
            statuses = [s.strip() for s in status_filter.split(",") if s.strip()]
            query = query.filter(Recording.status.in_(statuses))
        else:
            query = query.filter(Recording.status == status_filter)
    if user_id:
        query = query.filter(Recording.user_id == user_id)
    if username_filter:
        query = query.filter(User.username.ilike(f"%{username_filter}%"))
    if min_size is not None:
        query = query.filter(Recording.file_size >= min_size)
    if max_size is not None:
        query = query.filter(Recording.file_size <= max_size)
    if date_from:
        try:
            query = query.filter(Recording.created_at >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            query = query.filter(Recording.created_at <= datetime.fromisoformat(date_to))
        except ValueError:
            pass

    total = query.count()

    sort_col_map = {
        "size": Recording.file_size,
        "duration": Recording.duration_seconds,
        "username": User.username,
    }
    sort_col = sort_col_map.get(sort_by, Recording.created_at)
    query = query.order_by(sort_col.asc() if sort_order == "asc" else sort_col.desc())

    recordings = (
        query
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return RecordingListResponse(
        recordings=[_build_response(rec) for rec in recordings],
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
    
    filename = f"TK_{username}_{time.strftime('%Y.%m.%d_%H-%M-%S', time.localtime())}.mp4"
    
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
    
    return _build_response(recording)


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

    return _build_response(recording)


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
    
    return _build_response(recording)


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


@router.api_route("/{recording_id}/stream", methods=["GET", "HEAD"])
def stream_recording(recording_id: int, db: Session = Depends(get_db)):
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
        media_type="video/mp4",
        content_disposition_type="inline",
    )


@router.get("/{recording_id}/thumbnail")
def thumbnail_recording(recording_id: int, db: Session = Depends(get_db)):
    recording = db.query(Recording).filter(Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recording not found"
        )

    video_path = Path(settings.RECORDINGS_DIR) / recording.filename
    thumb_path = _thumbnail_path(video_path)

    if not thumb_path.exists():
        if not _generate_thumbnail(video_path, thumb_path):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Could not generate thumbnail for this recording",
            )

    return FileResponse(
        path=str(thumb_path),
        media_type="image/jpeg",
        content_disposition_type="inline",
    )


@router.post("/batch/delete", status_code=status.HTTP_200_OK)
def batch_delete_recordings(
    recording_ids: List[int] = Body(..., embed=True),
    db: Session = Depends(get_db)
):
    """Delete multiple recordings at once."""
    if not recording_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No recording IDs provided"
        )
    
    deleted_count = 0
    errors = []
    
    for recording_id in recording_ids:
        recording = db.query(Recording).filter(Recording.id == recording_id).first()
        if not recording:
            errors.append(f"Recording {recording_id} not found")
            continue
        
        if task_manager.is_recording(recording_id):
            task_manager.stop_recording(recording_id)
        
        file_path = Path(settings.RECORDINGS_DIR) / recording.filename
        if file_path.exists():
            try:
                os.remove(file_path)
            except OSError as e:
                errors.append(f"Failed to delete file for recording {recording_id}: {str(e)}")
        
        # Also delete thumbnail if exists
        thumb_path = _thumbnail_path(file_path)
        if thumb_path.exists():
            try:
                os.remove(thumb_path)
            except OSError:
                pass
        
        db.delete(recording)
        deleted_count += 1
    
    db.commit()
    
    return {
        "deleted": deleted_count,
        "errors": errors
    }


@router.post("/batch/download")
def batch_download_recordings(
    recording_ids: List[int] = Body(..., embed=True),
    db: Session = Depends(get_db)
):
    """Download multiple recordings as a ZIP file."""
    if not recording_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No recording IDs provided"
        )
    
    recordings = db.query(Recording).filter(Recording.id.in_(recording_ids)).all()
    
    if not recordings:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No recordings found"
        )
    
    # Create a temporary ZIP file
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    temp_path = temp_file.name
    temp_file.close()
    
    try:
        with zipfile.ZipFile(temp_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            for recording in recordings:
                file_path = Path(settings.RECORDINGS_DIR) / recording.filename
                if file_path.exists():
                    zf.write(file_path, recording.filename)
        
        timestamp = time.strftime('%Y%m%d_%H%M%S')
        zip_filename = f"recordings_{timestamp}.zip"
        
        return FileResponse(
            path=temp_path,
            filename=zip_filename,
            media_type="application/zip",
            background=None  # File will be cleaned up by OS temp cleanup
        )
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create ZIP file: {str(e)}"
        )


@router.get("/{recording_id}/sprite")
def get_sprite(recording_id: int, db: Session = Depends(get_db)):
    """Return the sprite sheet JPEG for hover-scrub preview."""
    recording = db.query(Recording).filter(Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording not found")
    video_path = Path(settings.RECORDINGS_DIR) / recording.filename
    sprite_path = video_path.with_name(video_path.stem + "_sprite.jpg")
    if not sprite_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sprite not yet generated")
    return FileResponse(path=str(sprite_path), media_type="image/jpeg")


@router.get("/{recording_id}/thumbnails.vtt")
def get_sprite_vtt(recording_id: int, db: Session = Depends(get_db)):
    """Return the WebVTT file for Vidstack hover-scrub thumbnails.

    Rewrites the relative 'sprite' URL inside the VTT to an absolute
    API endpoint URL so vidstack can resolve it correctly.
    """
    recording = db.query(Recording).filter(Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording not found")
    video_path = Path(settings.RECORDINGS_DIR) / recording.filename
    vtt_path = video_path.with_name(video_path.stem + "_sprite.vtt")
    if not vtt_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VTT not yet generated")
    content = vtt_path.read_text(encoding="utf-8")
    # Rewrite relative sprite references to absolute API URLs so vidstack
    # can resolve them without depending on relative URL resolution.
    absolute_sprite_url = f"/api/recordings/{recording_id}/sprite"
    content = content.replace("sprite#xywh=", f"{absolute_sprite_url}#xywh=")
    return Response(content=content, media_type="text/vtt")


@router.post("/{recording_id}/transcribe", response_model=RecordingResponse)
def start_transcription(recording_id: int, db: Session = Depends(get_db)):
    """Queue a transcription job for a completed or stopped recording."""
    recording = db.query(Recording).filter(Recording.id == recording_id).first()
    if not recording:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording not found")
    if recording.status not in ("completed", "stopped"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only completed or stopped recordings can be transcribed"
        )
    if recording.transcript_status == "processing":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Transcription already in progress")

    recording.transcript_status = "pending"
    db.commit()
    db.refresh(recording)

    transcription_service.enqueue(recording_id)
    return _build_response(recording)


@router.get("/transcripts/search")
def search_transcripts(q: str, db: Session = Depends(get_db)):
    """Search recordings by transcript text."""
    if not q or len(q.strip()) < 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Query too short")
    return transcription_service.search(q.strip(), db)


@router.post("/sprites/regenerate")
def regenerate_missing_sprites(db: Session = Depends(get_db)):
    """Trigger sprite generation for all completed/stopped recordings missing sprites."""
    recordings = (
        db.query(Recording)
        .filter(Recording.status.in_(("completed", "stopped")))
        .filter(Recording.sprite_ready.is_(False))
        .all()
    )
    triggered = 0
    for rec in recordings:
        video_path = Path(settings.RECORDINGS_DIR) / rec.filename
        if video_path.exists() and rec.id not in _sprite_retry_in_progress:
            _sprite_retry_in_progress.add(rec.id)
            threading.Thread(target=_gen_sprite, args=(video_path,), daemon=True).start()
            triggered += 1
    return {"total_missing": len(recordings), "triggered": triggered}
