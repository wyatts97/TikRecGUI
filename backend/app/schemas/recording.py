from datetime import datetime
from pydantic import BaseModel, Field


class RecordingBase(BaseModel):
    pass


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
    profile_pic_url: str | None = None
    filename: str
    status: str
    mode: str
    started_at: datetime | None = None
    ended_at: datetime | None = None
    duration_seconds: int | None = None
    file_size: int | None = None
    error_message: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class RecordingListResponse(BaseModel):
    recordings: list[RecordingResponse]
    total: int
    page: int
    page_size: int


class ActiveRecordingResponse(BaseModel):
    id: int
    username: str
    profile_pic_url: str | None = None
    status: str
    started_at: datetime | None = None
    duration_seconds: int | None = None
