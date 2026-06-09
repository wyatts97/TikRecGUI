"""Unified avatar fetching service.

Primary: uses the bundled TikTok live recorder API (get_avatar_url via room_id).
Fallback: scrapes TikTok profile page HTML for avatar URLs.
"""
import logging
from pathlib import Path
from typing import Optional

import httpx

from app.config import settings
from app.core.avatar_service import avatar_service
from app.core.recorder_service import recorder_service

logger = logging.getLogger(__name__)


class UnifiedAvatarService:
    AVATARS_DIR = Path(settings.DATA_DIR) / "avatars"

    USER_AGENT = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )

    def __init__(self):
        self.AVATARS_DIR.mkdir(parents=True, exist_ok=True)

    def _avatar_path(self, username: str) -> Path:
        return self.AVATARS_DIR / f"{username}.jpg"

    def _has_cached(self, username: str) -> bool:
        path = self._avatar_path(username)
        return path.exists() and path.stat().st_size > 0

    def _download_and_cache(self, username: str, url: str) -> Optional[str]:
        """Download avatar image and save locally. Returns local path or None."""
        try:
            headers = {"User-Agent": self.USER_AGENT}
            with httpx.Client(follow_redirects=True, timeout=15.0) as client:
                response = client.get(url, headers=headers)
                response.raise_for_status()
                if response.headers.get("content-type", "").startswith("image/"):
                    path = self._avatar_path(username)
                    path.write_bytes(response.content)
                    logger.info(f"Cached avatar for @{username} -> {path}")
                    return str(path)
        except Exception as exc:
            logger.warning(f"Failed to download avatar for @{username}: {exc}")
        return None

    def _fetch_via_recorder(self, room_id: str) -> Optional[str]:
        """Use the bundled TikTokAPI to get avatar URL from room info."""
        try:
            api = recorder_service.get_api()
            avatar_url = api.get_avatar_url(room_id)
            if avatar_url:
                logger.info(f"Got avatar URL via recorder API for room_id={room_id}")
                return avatar_url
        except Exception as exc:
            logger.warning(f"Recorder avatar fetch failed for room_id={room_id}: {exc}")
        return None

    def _fetch_via_html_scraper(self, username: str) -> Optional[str]:
        """Fallback: use avatar_service HTML scraper."""
        try:
            url = avatar_service.fetch_avatar_url(username)
            if url:
                logger.info(f"Got avatar URL via HTML scraper for @{username}")
                return url
        except Exception as exc:
            logger.warning(f"HTML scraper avatar fetch failed for @{username}: {exc}")
        return None

    def fetch_and_cache(self, username: str, room_id: Optional[str] = None, force: bool = False) -> Optional[str]:
        """
        Fetch avatar for a user and cache it locally.

        Args:
            username: TikTok username.
            room_id: Optional room_id to use the recorder API (preferred).
            force: If True, re-fetch even if cached.

        Returns:
            Local filesystem path to the cached avatar, or None.
        """
        if not force and self._has_cached(username):
            return str(self._avatar_path(username))

        # Try bundled recorder API first (most reliable, uses same auth as recordings)
        avatar_url: Optional[str] = None
        if room_id:
            avatar_url = self._fetch_via_recorder(room_id)

        # Fallback to HTML profile page scraper
        if not avatar_url:
            avatar_url = self._fetch_via_html_scraper(username)

        if avatar_url:
            return self._download_and_cache(username, avatar_url)

        logger.warning(f"All avatar fetch methods failed for @{username}")
        return None

    def get_avatar_path(self, username: str) -> Optional[str]:
        """Return cached avatar path if it exists, else None."""
        path = self._avatar_path(username)
        if path.exists() and path.stat().st_size > 0:
            return str(path)
        return None


unified_avatar_service = UnifiedAvatarService()
