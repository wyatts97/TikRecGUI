import json
import logging
import re
import threading
import time
from datetime import datetime, timedelta
from typing import Any

from app.config import settings

logger = logging.getLogger("tikrec.recorder_service")
from app.core.recorder_loader import get_tiktok_api_class, recorder_available
from app.core.settings_store import settings_store

# A cached TikTokAPI is rebuilt after this long, so cookies TikTok sets on
# the session (ttwid, msToken, any WAF challenge state) cannot go stale forever.
_API_MAX_AGE_SECONDS = 30 * 60
# Live-check failures older than this no longer count as "currently failing"
# (e.g. a user removed from the watchlist after a bad lookup).
_CHECK_ERROR_TTL = timedelta(minutes=30)

_SIGI_STATE_RE = re.compile(r'<script id="SIGI_STATE"[^>]*>(.*?)</script>', re.S)


def _room_id_from_unsigned_api(api, username: str) -> str | None:
    """Room-ID lookup via TikTok's api-live endpoint, without tikrec's signature."""
    response = api.http_client.get(
        f"{api.BASE_URL}/api-live/user/room/",
        params={"uniqueId": username, "sourceType": 54, "aid": 1988},
    )
    if not response.text or "Please wait" in response.text:
        raise RuntimeError("blocked by TikTok WAF")
    data = response.json()
    return ((data.get("data") or {}).get("user") or {}).get("roomId") or None


def _room_id_from_live_page(api, username: str) -> str | None:
    """Room-ID lookup by reading the SIGI_STATE blob on the user's /live page."""
    response = api.http_client.get(f"{api.BASE_URL}/@{username}/live")
    match = _SIGI_STATE_RE.search(response.text or "")
    if not match:
        if not response.text or "Please wait" in response.text:
            raise RuntimeError("blocked by TikTok WAF")
        raise RuntimeError(f"live page had no SIGI_STATE (HTTP {response.status_code})")
    user = (
        json.loads(match.group(1)).get("LiveRoom", {})
        .get("liveRoomUserInfo", {})
        .get("user", {})
    )
    # The page also lists recommended rooms; only trust the owner's own entry.
    if str(user.get("uniqueId", "")).lower() != username.lower():
        return None
    return user.get("roomId") or None


class RecorderService:
    def __init__(self):
        self._cookies = self.load_cookies()
        self._proxy = settings_store.get("proxy", settings.DEFAULT_PROXY)
        # One TikTokAPI per thread: curl_cffi sessions are not thread-safe,
        # and building one per call opened two fresh sessions (plus, with a
        # proxy configured, two blocking ifconfig.me probes) on every check.
        self._local = threading.local()
        # username -> (error, first seen, last seen) for lookups that are
        # failing right now, so a blocked server shows up in the UI instead
        # of reading as "nobody is live".
        self._check_lock = threading.Lock()
        self._check_errors: dict[str, tuple[str, datetime, datetime]] = {}
        self._last_check_ok_at: datetime | None = None

    def load_cookies(self) -> dict | None:
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
        self._cookies = self.load_cookies()

    def set_proxy(self, proxy: str | None):
        self._proxy = proxy

    def is_available(self) -> bool:
        return recorder_available()

    def get_api(self):
        key = (self._proxy, json.dumps(self._cookies, sort_keys=True))
        cached = getattr(self._local, "api", None)
        if cached is not None and cached[0] == key and time.monotonic() - cached[1] < _API_MAX_AGE_SECONDS:
            return cached[2]
        api_cls = get_tiktok_api_class()
        api = api_cls(proxy=self._proxy, cookies=self._cookies)
        self._local.api = (key, time.monotonic(), api)
        return api

    def resolve_room_id(self, api, username: str) -> str | None:
        """Return *username*'s current or most recent room ID.

        The recorder's own lookup depends on tikrec.com signing the request;
        when tikrec is down its fallback is Euler Stream's room_info, which
        now requires a paid plan (HTTP 401), so any tikrec hiccup made every
        watched user read as offline. Two direct TikTok lookups follow it.
        Returns None when no path finds a room (user missing or never live);
        raises only if every path failed outright.
        """
        errors: list[str] = []
        lookups = (
            ("tikrec", lambda: api.get_room_id_from_user(username)),
            ("api-live", lambda: _room_id_from_unsigned_api(api, username)),
            ("live page", lambda: _room_id_from_live_page(api, username)),
        )
        for name, lookup in lookups:
            try:
                room_id = lookup()
            except Exception as exc:
                errors.append(f"{name}: {exc}")
                continue
            if room_id:
                if errors:
                    logger.debug("Room ID for @%s found via %s after: %s", username, name, "; ".join(errors))
                return str(room_id)
        if len(errors) == len(lookups):
            raise RuntimeError("Room ID lookup failed (" + "; ".join(errors) + ")")
        return None

    def _record_check(self, username: str, error: str | None) -> None:
        now = datetime.utcnow()
        with self._check_lock:
            previous = self._check_errors.get(username)
            if error is None:
                self._last_check_ok_at = now
                if previous is not None:
                    del self._check_errors[username]
                    logger.info("Live check for @%s is working again", username)
                return
            if previous is None or previous[0] != error:
                logger.warning("Live check for @%s failed: %s", username, error)
            since = previous[1] if previous is not None and previous[0] == error else now
            self._check_errors[username] = (error, since, now)

    def live_check_health(self) -> dict[str, Any]:
        """Summarise current live-check failures for the health endpoint."""
        cutoff = datetime.utcnow() - _CHECK_ERROR_TTL
        with self._check_lock:
            current = {u: e for u, e in self._check_errors.items() if e[2] >= cutoff}
            last_ok = self._last_check_ok_at
        latest = max(current.items(), key=lambda item: item[1][2], default=None)
        return {
            "failing_users": len(current),
            "last_error": latest[1][0] if latest else None,
            "last_error_user": latest[0] if latest else None,
            "last_error_at": latest[1][2].isoformat() if latest else None,
            "last_ok_at": last_ok.isoformat() if last_ok else None,
        }

    def check_user_live(self, username: str) -> dict[str, Any]:
        try:
            api = self.get_api()
            room_id = self.resolve_room_id(api, username)
            is_live = bool(room_id) and api.is_room_alive(room_id)
        except Exception as e:
            self._record_check(username, str(e))
            return {
                "username": username,
                "is_live": False,
                "room_id": None,
                "error": str(e)
            }
        self._record_check(username, None)
        return {
            "username": username,
            "is_live": is_live,
            "room_id": room_id,
            "error": None
        }

    def get_room_id(self, username: str) -> str | None:
        try:
            return self.resolve_room_id(self.get_api(), username)
        except Exception:
            return None

    def get_live_url(self, room_id: str, username: str | None = None) -> str:
        """Resolve a fresh live-stream URL for *room_id*.

        Raises an exception with a useful message if the room is not live,
        restricted, or the API call fails. Callers can therefore surface the
        real reason instead of a generic "could not get URL" failure.

        Passing *username* lets the recorder fall back to scraping the live
        page directly when TikTok's webcast API returns a restricted-access
        response (status 4003110), instead of failing outright.
        """
        try:
            api = self.get_api()
            url = api.get_live_url(room_id, user=username)
        except Exception as e:
            logger.warning("Failed to resolve live URL for room %s: %s", room_id, e)
            raise RuntimeError(f"Failed to resolve live URL: {e}") from e
        if not url:
            raise RuntimeError("TikTok returned no live stream URL")
        return url

    def is_country_blacklisted(self) -> bool:
        try:
            return self.get_api().is_country_blacklisted()
        except Exception:
            return False


recorder_service = RecorderService()
