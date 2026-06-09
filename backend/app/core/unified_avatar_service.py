"""Unified avatar fetching service.

Primary: scrapes TikTok profile page HTML for avatar URLs.
Fallback: tiktok-scraper CLI (same tool used for profile info).
"""
import json
import logging
import os
import re
import subprocess
from pathlib import Path


from curl_cffi import requests

from app.config import settings

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
        # In-memory cache: username -> path. Avoids filesystem stat on every
        # GET /users call. Populated lazily by get_avatar_path / has_cached_avatar.
        self._cache: dict[str, str] = {}

    def _avatar_path(self, username: str) -> Path:
        return self.AVATARS_DIR / f"{username}.jpg"

    def has_cached_avatar(self, username: str) -> bool:
        """Check if we have a cached avatar for this user."""
        if username in self._cache:
            return True
        path = self._avatar_path(username)
        if path.exists() and path.stat().st_size > 0:
            self._cache[username] = str(path)
            return True
        return False

    def _download_and_cache(self, username: str, url: str) -> str | None:
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
                    self._cache[username] = str(path)
                    logger.info(f"Cached avatar for @{username} -> {path}")
                    return str(path)
        except Exception as exc:
            logger.warning(f"Failed to download avatar for @{username}: {exc}")
        return None

    def download_and_cache(self, username: str, url: str) -> str | None:
        """Public wrapper to download and cache an avatar from a known URL."""
        return self._download_and_cache(username, url)

    def _fetch_via_recorder(self, room_id: str) -> str | None:
        """Use the bundled TikTokAPI to get avatar URL from room info.

        NOTE: The bundled TikTokAPI does not expose a get_avatar_url method,
        so this path is currently disabled. The HTML scraper and tiktok-scraper
        CLI handle avatar fetching instead.
        """
        # The bundled recorder API has no avatar method; skip this path.
        return None

    def _fetch_via_html_scraper(self, username: str) -> str | None:
        """Scrape TikTok profile page HTML for an avatar URL.

        Tries multiple parsing strategies and logs failures for debugging.
        (Moved from the now-removed avatar_service module.)
        """
        url = f"https://www.tiktok.com/@{username}"
        headers = {
            "User-Agent": self.USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "gzip, deflate, br",
            "Connection": "keep-alive",
        }

        try:
            with requests.Session() as client:
                response = client.get(
                    url,
                    headers=headers,
                    timeout=15,
                    impersonate="chrome120",
                )
                response.raise_for_status()
                html = response.text

                # Strategy 1: __UNIVERSAL_DATA_FOR_REHYDRATION__ script tag
                pattern = r'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)</script>'
                match = re.search(pattern, html, re.DOTALL)
                if match:
                    try:
                        raw = match.group(1).strip()
                        data = json.loads(raw)
                        user_info = (
                            data.get("__DEFAULT_SCOPE__", {})
                            .get("webapp.user-detail", {})
                            .get("userInfo", {})
                            .get("user", {})
                        )
                        avatar_url = (
                            user_info.get("avatarLarger")
                            or user_info.get("avatarMedium")
                            or user_info.get("avatarThumb")
                        )
                        if avatar_url:
                            logger.info(f"Got avatar URL via HTML scraper for @{username}")
                            return avatar_url
                    except (json.JSONDecodeError, Exception) as exc:
                        logger.debug(f"Avatar parse __UNIVERSAL_DATA__ failed for @{username}: {exc}")

                # Strategy 2: og:image meta tag
                og_image_pattern = r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"'
                og_match = re.search(og_image_pattern, html)
                if og_match:
                    logger.info(f"Got avatar URL via og:image for @{username}")
                    return og_match.group(1)

                # Strategy 3: any meta tag with image content (broader fallback)
                broad_meta = re.search(
                    r'<meta[^>]+content="(https?://[^"]+\.tiktok\.cdn\.[^"]+/[^"]*avatar[^"]*)"',
                    html, re.IGNORECASE,
                )
                if broad_meta:
                    logger.info(f"Got avatar URL via broad meta for @{username}")
                    return broad_meta.group(1)

                # Strategy 4: JSON-LD structured data
                jsonld_pattern = r'<script type="application/ld\+json"[^>]*>(.*?)</script>'
                for jsonld_match in re.finditer(jsonld_pattern, html, re.DOTALL):
                    try:
                        ld = json.loads(jsonld_match.group(1).strip())
                        if isinstance(ld, dict) and "image" in ld:
                            img = ld["image"]
                            if isinstance(img, str):
                                logger.info(f"Got avatar URL via JSON-LD for @{username}")
                                return img
                            elif isinstance(img, list) and img:
                                logger.info(f"Got avatar URL via JSON-LD for @{username}")
                                return img[0]
                    except (json.JSONDecodeError, Exception):
                        continue

                # Nothing matched — log a snippet for debugging
                snippet = re.sub(r'\s+', ' ', html[:500])
                logger.warning(f"Avatar HTML scraper found no avatar for @{username}. Snippet: {snippet}")

        except Exception as exc:
            logger.warning(f"Avatar HTML fetch failed for @{username}: {exc}")

        return None

    def _fetch_via_tiktok_scraper(self, username: str) -> str | None:
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

    def fetch_and_cache(self, username: str, room_id: str | None = None, force: bool = False) -> str | None:
        """
        Fetch avatar for a user and cache it locally.

        Args:
            username: TikTok username.
            room_id: Optional room_id to use the recorder API (preferred).
            force: If True, re-fetch even if cached.

        Returns:
            Local filesystem path to the cached avatar, or None.
        """
        if not force and self.has_cached_avatar(username):
            return str(self._avatar_path(username))

        # Try HTML profile page scraper first (fast, no external deps)
        avatar_url: str | None = self._fetch_via_html_scraper(username)

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

    def get_avatar_path(self, username: str) -> str | None:
        """Return cached avatar path if it exists, else None."""
        cached = self._cache.get(username)
        if cached:
            return cached
        path = self._avatar_path(username)
        if path.exists() and path.stat().st_size > 0:
            self._cache[username] = str(path)
            return str(path)
        return None

    def delete_avatar(self, username: str) -> bool:
        """Delete a cached avatar. Returns True if deleted, False otherwise."""
        self._cache.pop(username, None)
        path = self._avatar_path(username)
        if path.exists():
            try:
                os.remove(path)
                return True
            except OSError:
                pass
        return False


unified_avatar_service = UnifiedAvatarService()
