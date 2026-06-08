import os
import re
import json
import httpx
from pathlib import Path
from typing import Optional

from app.config import settings


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
        Parses the __UNIVERSAL_DATA_FOR_REHYDRATION__ script tag.
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
            with httpx.Client(follow_redirects=True, timeout=15.0) as client:
                response = client.get(url, headers=headers)
                response.raise_for_status()
                html = response.text
                
                # Try to find the universal data script
                pattern = r'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([^<]+)</script>'
                match = re.search(pattern, html)
                
                if match:
                    try:
                        data = json.loads(match.group(1))
                        # Navigate to user info
                        user_info = (
                            data.get("__DEFAULT_SCOPE__", {})
                            .get("webapp.user-detail", {})
                            .get("userInfo", {})
                            .get("user", {})
                        )
                        
                        # Try different avatar fields
                        avatar_url = (
                            user_info.get("avatarLarger") or
                            user_info.get("avatarMedium") or
                            user_info.get("avatarThumb")
                        )
                        
                        if avatar_url:
                            return avatar_url
                    except json.JSONDecodeError:
                        pass
                
                # Fallback: try to find avatar in meta tags
                og_image_pattern = r'<meta property="og:image" content="([^"]+)"'
                og_match = re.search(og_image_pattern, html)
                if og_match:
                    return og_match.group(1)
                
        except Exception:
            pass
        
        return None
    
    def download_avatar(self, username: str, avatar_url: str) -> bool:
        """Download and cache the avatar image."""
        try:
            headers = {"User-Agent": self.USER_AGENT}
            
            with httpx.Client(follow_redirects=True, timeout=15.0) as client:
                response = client.get(avatar_url, headers=headers)
                response.raise_for_status()
                
                if response.headers.get("content-type", "").startswith("image/"):
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
