from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.db.models import User
from app.schemas.user import UserCreate, UserUpdate, UserResponse, UserStatusResponse
from app.core.recorder_service import recorder_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserResponse])
def list_users(
    skip: int = 0,
    limit: int = 100,
    monitoring_only: bool = False,
    db: Session = Depends(get_db)
):
    query = db.query(User)
    if monitoring_only:
        query = query.filter(User.is_monitoring == True)
    users = query.offset(skip).limit(limit).all()
    return users


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    username = user.username.lstrip("@").strip()
    
    existing = db.query(User).filter(User.username == username).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"User '{username}' already exists"
        )
    
    status_info = recorder_service.check_user_live(username)
    
    db_user = User(
        username=username,
        room_id=status_info.get("room_id"),
        is_monitoring=user.is_monitoring,
        is_live=status_info.get("is_live", False),
        profile_pic_url=status_info.get("avatar_url"),
        last_checked=datetime.utcnow()
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


@router.get("/{user_id}", response_model=UserResponse)
def get_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    return user


@router.patch("/{user_id}", response_model=UserResponse)
def update_user(user_id: int, user_update: UserUpdate, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    update_data = user_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(user, field, value)
    
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    db.delete(user)
    db.commit()
    return None


@router.get("/{user_id}/status", response_model=UserStatusResponse)
def check_user_status(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    status_info = recorder_service.check_user_live(user.username)

    user.is_live = status_info.get("is_live", False)
    user.room_id = status_info.get("room_id")
    user.profile_pic_url = status_info.get("avatar_url")
    user.last_checked = datetime.utcnow()
    db.commit()

    if status_info.get("error"):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=status_info["error"]
        )

    return UserStatusResponse(
        username=user.username,
        is_live=user.is_live,
        room_id=user.room_id,
        last_checked=user.last_checked
    )


@router.post("/{user_id}/refresh", response_model=UserResponse)
def refresh_user_status(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    status_info = recorder_service.check_user_live(user.username)

    user.is_live = status_info.get("is_live", False)
    user.room_id = status_info.get("room_id")
    user.profile_pic_url = status_info.get("avatar_url")
    user.last_checked = datetime.utcnow()
    db.commit()
    db.refresh(user)

    return user
