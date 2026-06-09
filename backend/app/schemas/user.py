from datetime import datetime
from pydantic import BaseModel, Field


class UserBase(BaseModel):
    username: str = Field(..., min_length=1, max_length=255)


class UserCreate(UserBase):
    is_monitoring: bool = False


class UserUpdate(BaseModel):
    is_monitoring: bool | None = None
    is_on_watchlist: bool | None = None
    room_id: str | None = None


class UserResponse(UserBase):
    id: int
    display_name: str | None = None
    bio: str | None = None
    follower_count: int | None = None
    room_id: str | None = None
    is_monitoring: bool
    is_live: bool
    is_on_watchlist: bool
    last_checked: datetime | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class UserStatusResponse(BaseModel):
    username: str
    is_live: bool
    room_id: str | None = None
    last_checked: datetime
