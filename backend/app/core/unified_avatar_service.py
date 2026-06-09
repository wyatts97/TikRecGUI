"""Unified avatar fetching service.

Primary: scrapes TikTok profile page HTML for avatar URLs.
Fallback: tiktok-scraper CLI (same tool used for profile info).
"""
import json
import logging
import subprocess
from pathlib import Path
from typing import Optional

from curl_cffi import requests

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
            with requests.Session() as client:
                response = client.get(
                    url,
                    headers=headers,
                    timeout=15,
                    impersonate="chrome120",
                )
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
        """Use the bundled TikTokAPI to get avatar URL from room info.

        NOTE: The bundled TikTokAPI does not expose a get_avatar_url method,
        so this path is currently disabled. The HTML scraper and tiktok-scraper
        CLI handle avatar fetching instead.
        """
        # The bundled recorder API has no avatar method; skip this path.
        return None

    def _fetch_via_html_scraper(self, username: str) -> Optional[str]:
        """Use avatar_service HTML scraper."""
        try:
            url = avatar_service.fetch_avatar_url(username)
            if url:
                logger.info(f"Got avatar URL via HTML scraper for @{username}")
                return url
        except Exception as exc:
            logger.warning(f"HTML scraper avatar fetch failed for @{username}: {exc}")
        return None

    def _fetch_via_tiktok_scraper(self, username: str) -> Optional[str]:
        """Run tiktok-scraper CLI to get avatar URL."""
        try:
            proc = subprocess.run(
                ["tiktok-scraper", "user", username, "-t", "json"],
                capture_output=True, text=True, timeout=20,
            )
            if proc.returncode != 0:
                logger.debug(f"tiktok-scraper stderr for @{username}: {proc.stderr[:200]}")
                return None
            data = json.loads(proc.stdout)
            avatar_url = data.get("avatar_url") or data.get("avatar")
            if avatar_url:
                logger.info(f"Got avatar URL via tiktok-scraper for @{username}")
                return avatar_url
        except (json.JSONDecodeError, subprocess.TimeoutExpired, Exception) as exc:
            logger.debug(f"tiktok-scraper avatar fetch failed for @{username}: {exc}")
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

        # Try HTML profile page scraper first (fast, no external deps)
        avatar_url: Optional[str] = self._fetch_via_html_scraper(username)

        # Fallback to tiktok-scraper CLI (reliable, already used for profiles)
        if not avatar_url:
            avatar_url = self._fetch_via_tiktok_scraper(username)

        # Attempt recorder API (disabled — see note in _fetch_via_recorder)
        if not avatar_url and room_id:
            avatar_url = self._fetch_via_recorder(room_id)

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
