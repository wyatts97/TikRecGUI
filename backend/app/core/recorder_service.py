import json
import logging
from typing import Any

from app.config import settings
from app.core.recorder_loader import get_tiktok_api_class, recorder_available
from app.core.settings_store import settings_store

logger = logging.getLogger(__name__)


class RecorderService:
    def __init__(self):
        self._cookies = self._load_cookies()
        self._proxy = settings_store.get("proxy", settings.DEFAULT_PROXY)
    
    def _load_cookies(self) -> dict | None:
        if settings.COOKIES_FILE.exists():
            try:
                with open(settings.COOKIES_FILE, "r") as f:
                    cookies = json.load(f)
                    if cookies.get("sessionid_ss"):
                        return cookies
            except (json.JSONDecodeError, IOError):
                pass
        return None
    
    def reload_cookies(self):
        self._cookies = self._load_cookies()
    
    def set_proxy(self, proxy: str | None):
        self._proxy = proxy

    def is_available(self) -> bool:
        return recorder_available()

    def get_api(self):
        api_cls = get_tiktok_api_class()
        return api_cls(proxy=self._proxy, cookies=self._cookies)
    
    def check_user_live(self, username: str) -> dict[str, Any]:
        api = self.get_api()
        try:
            room_id = api.get_room_id_from_user(username)
            logger.info(f"check_user_live: room_id for {username} = {room_id}")
            if room_id:
                is_live = api.is_room_alive(room_id)
                logger.info(f"check_user_live: is_live for {username} = {is_live}")
                avatar_url = api.get_avatar_url(room_id)
                return {
                    "username": username,
                    "is_live": is_live,
                    "room_id": room_id,
                    "avatar_url": avatar_url,
                    "error": None
                }
            logger.warning(f"check_user_live: no room_id for {username}, marking not live")
            return {
                "username": username,
                "is_live": False,
                "room_id": None,
                "avatar_url": None,
                "error": None
            }
        except Exception as e:
            logger.error(f"check_user_live: exception for {username}: {e}")
            return {
                "username": username,
                "is_live": False,
                "room_id": None,
                "avatar_url": None,
                "error": str(e)
            }
    
    def get_room_id(self, username: str) -> str | None:
        api = self.get_api()
        try:
            return api.get_room_id_from_user(username)
        except Exception:
            return None
    
    def get_live_url(self, room_id: str) -> str | None:
        api = self.get_api()
        try:
            return api.get_live_url(room_id)
        except Exception:
            return None
    
    def is_country_blacklisted(self) -> bool:
        api = self.get_api()
        try:
            return api.is_country_blacklisted()
        except Exception:
            return False


recorder_service = RecorderService()
