import json
import logging
import subprocess
import threading
from pathlib import Path
from typing import Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class UserInfoService:
    """Fetch TikTok user profile info using the tiktok-scraper npm CLI."""

    AVATARS_DIR = Path(settings.DATA_DIR) / "avatars"

    def __init__(self):
        self.AVATARS_DIR.mkdir(parents=True, exist_ok=True)

    def fetch_user_info(self, username: str) -> dict:
        """
        Run ``tiktok-scraper user <username>`` and parse the JSON output.
        Returns a dict with: display_name, bio, follower_count, avatar_url.
        Returns an empty dict on any error so callers can degrade gracefully.
        """
        result: dict = {}
        try:
            proc = subprocess.run(
                ["tiktok-scraper", "user", username, "--json", "-t", "user", "-d"],
                capture_output=True,
                text=True,
                timeout=30,
            )
            if proc.returncode == 0 and proc.stdout.strip():
                raw = json.loads(proc.stdout)
                user_data: dict = {}
                if isinstance(raw, list) and raw:
                    user_data = raw[0]
                elif isinstance(raw, dict):
                    user_data = raw.get("userInfo", {}).get("user", raw)

                result["display_name"] = (
                    user_data.get("nickName")
                    or user_data.get("nickname")
                    or user_data.get("name")
                )
                result["bio"] = user_data.get("signature") or user_data.get("bio")
                result["follower_count"] = (
                    user_data.get("followerCount")
                    or user_data.get("fans")
                )
                result["avatar_url"] = (
                    user_data.get("avatarLarger")
                    or user_data.get("avatarMedium")
                    or user_data.get("avatarThumb")
                )
        except FileNotFoundError:
            logger.warning("tiktok-scraper not found; profile info unavailable")
        except subprocess.TimeoutExpired:
            logger.warning(f"tiktok-scraper timed out for @{username}")
        except (json.JSONDecodeError, Exception) as exc:
            logger.warning(f"tiktok-scraper error for @{username}: {exc}")

        return result

    def fetch_and_cache_avatar(self, username: str, force: bool = False) -> Optional[str]:
        """Download and cache a user's avatar. Returns local path or None."""
        avatar_path = self.AVATARS_DIR / f"{username}.jpg"

        if avatar_path.exists() and not force:
            return str(avatar_path)

        info = self.fetch_user_info(username)
        avatar_url = info.get("avatar_url")
        if not avatar_url:
            return None

        try:
            with httpx.Client(timeout=15.0, follow_redirects=True) as client:
                response = client.get(avatar_url)
                response.raise_for_status()
                avatar_path.write_bytes(response.content)
                return str(avatar_path)
        except Exception as exc:
            logger.warning(f"Failed to download avatar for @{username}: {exc}")
            return None

    def update_user_profile(self, db_user, db) -> None:
        """
        Fetch profile info from TikTok and persist it on ``db_user``.
        Commits the session when done.
        """
        info = self.fetch_user_info(db_user.username)
        if info.get("display_name"):
            db_user.display_name = info["display_name"]
        if info.get("bio") is not None:
            db_user.bio = info["bio"]
        if info.get("follower_count") is not None:
            db_user.follower_count = info["follower_count"]
        if info.get("avatar_url"):
            db_user.profile_pic_url = info["avatar_url"]
            self.fetch_and_cache_avatar(db_user.username, force=True)
        db.commit()

    def update_user_profile_async(self, user_id: int) -> None:
        """Fire-and-forget: update profile in a daemon thread."""
        def _run():
            from app.db.database import SessionLocal
            db = SessionLocal()
            try:
                from app.db.models import User
                user = db.query(User).filter(User.id == user_id).first()
                if user:
                    self.update_user_profile(user, db)
            except Exception as exc:
                logger.warning(f"Async profile update failed for id={user_id}: {exc}")
            finally:
                db.close()

        threading.Thread(target=_run, daemon=True).start()


user_info_service = UserInfoService()
