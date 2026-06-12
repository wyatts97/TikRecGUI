import os
import time
import logging
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse, Response
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.db.database import get_db, run_background
from app.db.models import Recording, Clip
from app.schemas.recording import (
    ClipCreate,
    ClipResponse,
    ClipListResponse,
)
from app.core.media_utils import (
    clip_directory,
    create_clip,
    generate_thumbnail,
    thumbnail_path,
    generate_sprite,
)

logger = logging.getLogger("tikrec.clips")

router = APIRouter(prefix="/clips", tags=["clips"])


# ----------------------------------------------------------------
# Internal helpers
# ----------------------------------------------------------------

def _build_clip_response(clip: Clip, username: str | None = None) -> ClipResponse:
    if username:
        resolved_username = username
    elif clip.recording is not None and clip.recording.user is not None:
        resolved_username = clip.recording.user.username
    else:
        resolved_username = "unknown"
    return ClipResponse(
        id=clip.id,
        recording_id=clip.recording_id,
        username=resolved_username,
        title=clip.title,
        filename=clip.filename,
        start_time=clip.start_time,
        end_time=clip.end_time,
        duration_seconds=clip.duration_seconds,
        file_size=clip.file_size,
        thumbnail_ready=clip.thumbnail_ready,
        sprite_ready=clip.sprite_ready,
        created_at=clip.created_at,
    )


def _delete_clip_files(clip: Clip) -> list[str]:
    """Delete all on-disk assets for a clip. Returns list of error messages."""
    errors: list[str] = []
    clip_dir = clip_directory()
    video_path = clip_dir / clip.filename

    assets = [
        ("video", video_path),
        ("thumbnail", thumbnail_path(video_path)),
        ("sprite", video_path.with_name(video_path.stem + "_sprite.jpg")),
        ("sprite VTT", video_path.with_name(video_path.stem + "_sprite.vtt")),
    ]

    for label, path in assets:
        if path.exists():
            try:
                os.remove(path)
                logger.info("Deleted %s file: %s", label, path)
            except OSError as e:
                msg = f"Failed to delete {label} for clip {clip.id}: {e}"
                errors.append(msg)
                logger.warning(msg)

    return errors


def _is_thumbnail_ready(clip: Clip) -> bool:
    clip_dir = clip_directory()
    video_path = clip_dir / clip.filename
    thumb = thumbnail_path(video_path)
    if thumb.exists() and thumb.stat().st_size > 0:
        return True
    if video_path.exists():
        run_background(generate_thumbnail, video_path, thumb)
    return False


def _is_sprite_ready(clip: Clip) -> bool:
    clip_dir = clip_directory()
    video_path = clip_dir / clip.filename
    sprite_path = video_path.with_name(video_path.stem + "_sprite.jpg")
    vtt_path = video_path.with_name(video_path.stem + "_sprite.vtt")
    if (
        sprite_path.exists()
        and sprite_path.stat().st_size > 0
        and vtt_path.exists()
        and vtt_path.stat().st_size > 0
    ):
        return True
    if video_path.exists():
        run_background(generate_sprite, video_path)
    return False


def _generate_clip_filename(recording: Recording, start: int, end: int) -> str:
    """Generate a unique filename for a clip."""
    base = recording.filename.replace(".mp4", "")
    return f"{base}_clip_{start:05d}_{end:05d}.mp4"


# ----------------------------------------------------------------
# Routes
# ----------------------------------------------------------------

@router.post("", response_model=ClipResponse, status_code=status.HTTP_201_CREATED)
def create_clip_endpoint(request: ClipCreate, db: Session = Depends(get_db)):
    recording = db.query(Recording).filter(Recording.id == request.recording_id).first()
    if not recording:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recording not found"
        )

    if recording.status not in ("completed", "stopped"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only clip completed or stopped recordings"
        )

    video_path = Path(settings.RECORDINGS_DIR) / recording.filename
    if not video_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Recording file not found"
        )

    if request.start_time >= request.end_time:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Start time must be less than end time"
        )

    rec_duration = recording.duration_seconds or 0
    if request.end_time > rec_duration and rec_duration > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"End time exceeds recording duration ({rec_duration}s)"
        )

    filename = _generate_clip_filename(recording, request.start_time, request.end_time)
    output_path = clip_directory() / filename

    # Prevent overwriting an existing clip file
    if output_path.exists():
        # Append a counter to make it unique
        stem = output_path.stem
        suffix = output_path.suffix
        counter = 1
        while output_path.exists():
            filename = f"{stem}_{counter}{suffix}"
            output_path = clip_directory() / filename
            counter += 1

    success = create_clip(video_path, request.start_time, request.end_time, output_path)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create clip"
        )

    # Get file size
    file_size = output_path.stat().st_size if output_path.exists() else None
    duration = request.end_time - request.start_time

    clip = Clip(
        recording_id=recording.id,
        title=request.title,
        filename=filename,
        start_time=request.start_time,
        end_time=request.end_time,
        duration_seconds=duration,
        file_size=file_size,
    )
    db.add(clip)
    db.commit()
    db.refresh(clip)

    # Trigger thumbnail and sprite generation asynchronously
    run_background(generate_thumbnail, output_path, thumbnail_path(output_path))
    run_background(generate_sprite, output_path)

    return _build_clip_response(clip, username=recording.username)


@router.get("", response_model=ClipListResponse)
def list_clips(
    page: int = 1,
    page_size: int = 20,
    sort_by: str = "date",
    sort_order: str = "desc",
    db: Session = Depends(get_db)
):
    # Eagerly load the recording relationship so _build_clip_response
    # can access clip.recording.username without detached errors.
    query = db.query(Clip).options(joinedload(Clip.recording).joinedload(Recording.user))
    count_query = db.query(func.count()).select_from(Clip)

    total = count_query.scalar() or 0

    sort_col_map = {
        "date": Clip.created_at,
        "duration": Clip.duration_seconds,
        "size": Clip.file_size,
    }
    sort_col = sort_col_map.get(sort_by, Clip.created_at)
    order = sort_col.asc() if sort_order == "asc" else sort_col.desc()

    clips = query.order_by(order).offset((page - 1) * page_size).limit(page_size).all()

    # Refresh thumbnail/sprite flags in-memory (do NOT modify detached objects)
    for clip in clips:
        clip.thumbnail_ready = _is_thumbnail_ready(clip)
        clip.sprite_ready = _is_sprite_ready(clip)

    return ClipListResponse(
        clips=[_build_clip_response(c) for c in clips],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{clip_id}", response_model=ClipResponse)
def get_clip(clip_id: int, db: Session = Depends(get_db)):
    clip = db.query(Clip).options(joinedload(Clip.recording).joinedload(Recording.user)).filter(Clip.id == clip_id).first()
    if not clip:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clip not found"
        )

    clip.thumbnail_ready = _is_thumbnail_ready(clip)
    clip.sprite_ready = _is_sprite_ready(clip)

    return _build_clip_response(clip)


@router.patch("/{clip_id}", response_model=ClipResponse)
def update_clip(clip_id: int, title: str | None = None, db: Session = Depends(get_db)):
    clip = db.query(Clip).options(joinedload(Clip.recording).joinedload(Recording.user)).filter(Clip.id == clip_id).first()
    if not clip:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clip not found"
        )

    if title is not None:
        clip.title = title[:255] if title else None

    db.commit()
    db.refresh(clip)
    return _build_clip_response(clip)


@router.delete("/{clip_id}")
def delete_clip(clip_id: int, db: Session = Depends(get_db)):
    clip = db.query(Clip).filter(Clip.id == clip_id).first()
    if not clip:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clip not found"
        )

    errors = _delete_clip_files(clip)
    db.delete(clip)
    db.commit()

    if errors:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"deleted": True, "errors": errors},
        )

    return {"deleted": True, "errors": []}


@router.get("/{clip_id}/download")
def download_clip(clip_id: int, db: Session = Depends(get_db)):
    clip = db.query(Clip).filter(Clip.id == clip_id).first()
    if not clip:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clip not found"
        )

    file_path = clip_directory() / clip.filename
    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clip file not found"
        )

    return FileResponse(
        path=str(file_path),
        filename=clip.filename,
        media_type="video/mp4"
    )


@router.api_route("/{clip_id}/stream", methods=["GET", "HEAD"])
def stream_clip(clip_id: int, db: Session = Depends(get_db)):
    clip = db.query(Clip).filter(Clip.id == clip_id).first()
    if not clip:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clip not found"
        )

    file_path = clip_directory() / clip.filename
    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clip file not found"
        )

    return FileResponse(
        path=str(file_path),
        media_type="video/mp4",
        content_disposition_type="inline",
    )


@router.get("/{clip_id}/thumbnail")
def thumbnail_clip(clip_id: int, db: Session = Depends(get_db)):
    clip = db.query(Clip).filter(Clip.id == clip_id).first()
    if not clip:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clip not found"
        )

    video_path = clip_directory() / clip.filename
    thumb_path = thumbnail_path(video_path)

    if not thumb_path.exists():
        if not generate_thumbnail(video_path, thumb_path):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Could not generate thumbnail for this clip"
            )

    return FileResponse(
        path=str(thumb_path),
        media_type="image/jpeg",
        content_disposition_type="inline",
    )


@router.get("/{clip_id}/sprite")
def get_clip_sprite(clip_id: int, db: Session = Depends(get_db)):
    clip = db.query(Clip).filter(Clip.id == clip_id).first()
    if not clip:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip not found")

    video_path = clip_directory() / clip.filename
    sprite_path = video_path.with_name(video_path.stem + "_sprite.jpg")
    if not sprite_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sprite not yet generated")
    return FileResponse(path=str(sprite_path), media_type="image/jpeg")


@router.get("/{clip_id}/thumbnails.vtt")
def get_clip_sprite_vtt(clip_id: int, db: Session = Depends(get_db)):
    """Return the WebVTT file for Vidstack hover-scrub thumbnails."""
    clip = db.query(Clip).filter(Clip.id == clip_id).first()
    if not clip:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clip not found")

    video_path = clip_directory() / clip.filename
    vtt_path = video_path.with_name(video_path.stem + "_sprite.vtt")
    if not vtt_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="VTT not yet generated")

    content = vtt_path.read_text(encoding="utf-8")
    absolute_sprite_url = f"/api/clips/{clip_id}/sprite"
    content = content.replace("sprite#xywh=", f"{absolute_sprite_url}#xywh=")
    return Response(content=content, media_type="text/vtt")
