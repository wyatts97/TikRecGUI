from datetime import datetime
from pydantic import BaseModel, Field


class RecordingStart(BaseModel):
    username: str | None = None
    url: str | None = None
    room_id: str | None = None
    mode: str = Field(default="manual", pattern="^(manual|automatic)$")
    duration: int | None = Field(default=None, ge=1)
    bitrate: str | None = None


class RecordingResponse(BaseModel):
    id: int
    user_id: int
    username: str
    filename: str
    status: str
    mode: str
    started_at: datetime | None = None
    ended_at: datetime | None = None
    duration_seconds: int | None = None
    file_size: int | None = None
    error_message: str | None = None
    created_at: datetime
    thumbnail_ready: bool = False
    sprite_ready: bool = False
    transcript_status: str | None = None
    transcript_text: str | None = None
    is_favorite: bool = False
    is_corrupt: bool | None = None

    class Config:
        from_attributes = True


class RecordingListResponse(BaseModel):
    recordings: list[RecordingResponse]
    total: int
    page: int
    page_size: int


class ActiveRecordingResponse(BaseModel):
    id: int
    user_id: int
    username: str
    status: str
    started_at: datetime | None = None
    duration_seconds: int | None = None
