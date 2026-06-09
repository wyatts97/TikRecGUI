import os
import re
import json
import logging
from pathlib import Path
from typing import Optional

from curl_cffi import requests

from app.config import settings

logger = logging.getLogger(__name__)


class AvatarService:
    """Service for fetching and caching TikTok user avatars."""
    
    AVATARS_DIR = Path(settings.DATA_DIR) / "avatars"
    
    USER_AGENT = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
    
    def __init__(self):
        self.AVATARS_DIR.mkdir(parents=True, exist_ok=True)
    
    def get_avatar_path(self, username: str) -> Path:
        """Get the local path for a user's avatar."""
        return self.AVATARS_DIR / f"{username}.jpg"
    
    def has_cached_avatar(self, username: str) -> bool:
        """Check if we have a cached avatar for this user."""
        path = self.get_avatar_path(username)
        return path.exists() and path.stat().st_size > 0
    
    def fetch_avatar_url(self, username: str) -> Optional[str]:
        """
        Fetch the avatar URL from TikTok's profile page.
        Tries multiple parsing strategies and logs failures for debugging.
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
                # Use DOTALL so newlines inside the script body are captured
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
                            user_info.get("avatarLarger") or
                            user_info.get("avatarMedium") or
                            user_info.get("avatarThumb")
                        )
                        if avatar_url:
                            return avatar_url
                    except (json.JSONDecodeError, Exception) as exc:
                        logger.debug(f"Avatar parse __UNIVERSAL_DATA__ failed for @{username}: {exc}")

                # Strategy 2: og:image meta tag
                og_image_pattern = r'<meta[^>]+property="og:image"[^>]+content="([^"]+)"'
                og_match = re.search(og_image_pattern, html)
                if og_match:
                    return og_match.group(1)

                # Strategy 3: any meta tag with image content (broader fallback)
                broad_meta = re.search(r'<meta[^>]+content="(https?://[^"]+\.tiktok\.cdn\.[^"]+/[^"]*avatar[^"]*)"', html, re.IGNORECASE)
                if broad_meta:
                    return broad_meta.group(1)

                # Strategy 4: JSON-LD structured data
                jsonld_pattern = r'<script type="application/ld\+json"[^>]*>(.*?)</script>'
                for jsonld_match in re.finditer(jsonld_pattern, html, re.DOTALL):
                    try:
                        ld = json.loads(jsonld_match.group(1).strip())
                        if isinstance(ld, dict) and "image" in ld:
                            img = ld["image"]
                            if isinstance(img, str):
                                return img
                            elif isinstance(img, list) and img:
                                return img[0]
                    except (json.JSONDecodeError, Exception):
                        continue

                # If we get here, nothing matched — log a snippet for debugging
                snippet = re.sub(r'\s+', ' ', html[:500])
                logger.warning(f"Avatar HTML scraper found no avatar for @{username}. Snippet: {snippet}")

        except Exception as exc:
            logger.warning(f"Avatar HTTP fetch failed for @{username}: {exc}")

        return None
    
    def download_avatar(self, username: str, avatar_url: str) -> bool:
        """Download and cache the avatar image."""
        try:
            headers = {"User-Agent": self.USER_AGENT}

            with requests.Session() as client:
                response = client.get(
                    avatar_url,
                    headers=headers,
                    timeout=15,
                    impersonate="chrome120",
                )
                response.raise_for_status()

                content_type = response.headers.get("content-type", "")
                if content_type.startswith("image/"):
                    avatar_path = self.get_avatar_path(username)
                    with open(avatar_path, "wb") as f:
                        f.write(response.content)
                    return True
        except Exception:
            pass

        return False
    
    def fetch_and_cache_avatar(self, username: str, force: bool = False) -> Optional[str]:
        """
        Fetch avatar from TikTok and cache it locally.
        Returns the local path if successful, None otherwise.
        """
        if not force and self.has_cached_avatar(username):
            return str(self.get_avatar_path(username))
        
        avatar_url = self.fetch_avatar_url(username)
        if avatar_url and self.download_avatar(username, avatar_url):
            return str(self.get_avatar_path(username))
        
        return None
    
    def delete_avatar(self, username: str) -> bool:
        """Delete a cached avatar."""
        path = self.get_avatar_path(username)
        if path.exists():
            try:
                os.remove(path)
                return True
            except OSError:
                pass
        return False


avatar_service = AvatarService()
