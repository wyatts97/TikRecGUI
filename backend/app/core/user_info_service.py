import json
import logging
import subprocess
import threading
from pathlib import Path

from app.config import settings

logger = logging.getLogger(__name__)


class UserInfoService:
    """Fetch TikTok user profile info using the tiktok-scraper npm CLI."""

    AVATARS_DIR = Path(settings.DATA_DIR) / "avatars"

    def __init__(self):
        self.AVATARS_DIR.mkdir(parents=True, exist_ok=True)
        # Delayed import to avoid circular dependency at module load time
        from app.core.unified_avatar_service import unified_avatar_service
        self._avatar_service = unified_avatar_service

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

    def update_user_profile(self, db_user, db) -> None:
        """
        Fetch profile info from TikTok and persist it on ``db_user``.
        Also fetches and caches the avatar if available.
        Commits the session when done.
        """
        info = self.fetch_user_info(db_user.username)
        if info.get("display_name"):
            db_user.display_name = info["display_name"]
        if info.get("bio") is not None:
            db_user.bio = info["bio"]
        if info.get("follower_count") is not None:
            db_user.follower_count = info["follower_count"]

        # Cache avatar from tiktok-scraper result if available
        avatar_url = info.get("avatar_url")
        if avatar_url:
            try:
                cached = self._avatar_service._download_and_cache(db_user.username, avatar_url)
                if cached and not db_user.profile_pic_url:
                    db_user.profile_pic_url = f"/api/users/{db_user.id}/avatar"
            except Exception as exc:
                logger.warning(f"Avatar cache failed for @{db_user.username}: {exc}")

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
