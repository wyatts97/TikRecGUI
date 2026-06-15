"""Unified avatar fetching service.

Primary: scrapes TikTok profile page HTML for avatar URLs.
Fallback: tiktok-scraper CLI (same tool used for profile info).
"""
import json
import logging
import os
import re
import subprocess
import threading
import time
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

    # Exponential backoff for failed fetches (seconds)
    _BACKOFF_BASE = 60      # 1 min
    _BACKOFF_MAX = 3600     # 1 hour
    _MAX_RETRIES = 5

    def __init__(self):
        self.AVATARS_DIR.mkdir(parents=True, exist_ok=True)
        # In-memory cache: username -> path. Avoids filesystem stat on every
        # GET /users call. Populated lazily by get_avatar_path / has_cached_avatar.
        self._cache: dict[str, str] = {}
        # Prevent concurrent fetches for the same username
        self._in_flight: set[str] = set()
        self._lock = threading.Lock()
        # Track failures for retry: username -> {last_attempt: ts, attempts: int}
        self._failure_tracker: dict[str, dict] = {}

    def _avatar_path(self, username: str) -> Path:
        return self.AVATARS_DIR / f"{username}.jpg"

    def _save_debug(self, username: str, content: str, suffix: str = "html") -> None:
        """Save raw response content for debugging blocked pages."""
        try:
            debug_dir = Path(settings.DATA_DIR) / "avatar-debug"
            debug_dir.mkdir(parents=True, exist_ok=True)
            path = debug_dir / f"{username}_{int(time.time())}.{suffix}"
            path.write_text(content, encoding="utf-8")
            logger.info(f"Saved debug snapshot for @{username} -> {path}")
        except Exception:
            pass

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

            # Add cookies for authenticated access
            cookie_str = self._load_cookies_string()
            if cookie_str:
                headers["Cookie"] = cookie_str

            # Load proxy if configured
            proxy = self._load_proxy()
            proxies = {"https": proxy, "http": proxy} if proxy else None

            with requests.Session() as client:
                response = client.get(
                    url,
                    headers=headers,
                    timeout=15,
                    impersonate="chrome120",
                    proxies=proxies,
                )
                response.raise_for_status()
                content_type = response.headers.get("content-type", "")
                if content_type.startswith("image/") or len(response.content) > 1000:
                    path = self._avatar_path(username)
                    path.write_bytes(response.content)
                    self._cache[username] = str(path)
                    logger.info(f"Cached avatar for @{username} -> {path} ({len(response.content)} bytes)")
                    return str(path)
                else:
                    logger.warning(f"Avatar response for @{username} not an image: content-type={content_type}, size={len(response.content)}")
        except Exception as exc:
            logger.warning(f"Failed to download avatar for @{username}: {exc}")
        return None

    def download_and_cache(self, username: str, url: str) -> str | None:
        """Public wrapper to download and cache an avatar from a known URL."""
        return self._download_and_cache(username, url)

    def _should_retry(self, username: str) -> bool:
        """Check if enough time has passed since the last failed attempt."""
        entry = self._failure_tracker.get(username)
        if not entry:
            return True
        attempts = entry.get("attempts", 0)
        if attempts >= self._MAX_RETRIES:
            return False
        last_attempt = entry.get("last_attempt", 0)
        backoff = min(self._BACKOFF_BASE * (2 ** attempts), self._BACKOFF_MAX)
        return (time.time() - last_attempt) >= backoff

    def _record_failure(self, username: str) -> None:
        entry = self._failure_tracker.get(username, {"attempts": 0})
        entry["attempts"] = entry.get("attempts", 0) + 1
        entry["last_attempt"] = time.time()
        self._failure_tracker[username] = entry
        logger.warning(f"Avatar fetch failed for @{username} (attempt {entry['attempts']})")

    def _record_success(self, username: str) -> None:
        self._failure_tracker.pop(username, None)

    def reset_failure(self, username: str) -> None:
        """Clear failure tracker for a user (e.g., manual refresh)."""
        self._failure_tracker.pop(username, None)

    def get_retryable_usernames(self) -> list[str]:
        """Return usernames whose backoff has expired and are eligible for retry."""
        return [
            u for u, entry in self._failure_tracker.items()
            if entry.get("attempts", 0) < self._MAX_RETRIES
            and self._should_retry(u)
        ]

    def _fetch_via_recorder(self, room_id: str) -> str | None:
        """Use the bundled TikTokAPI to get avatar URL from room info.

        NOTE: The bundled TikTokAPI does not expose a get_avatar_url method,
        so this path is currently disabled. The HTML scraper and tiktok-scraper
        CLI handle avatar fetching instead.
        """
        # The bundled recorder API has no avatar method; skip this path.
        return None

    def _load_cookies_string(self) -> str:
        """Load TikTok cookies from settings and return as Cookie header string."""
        try:
            from app.config import settings as app_settings
            if app_settings.COOKIES_FILE.exists():
                import json as _json
                with open(app_settings.COOKIES_FILE, "r") as f:
                    cookies = _json.load(f)
                if cookies.get("sessionid_ss"):
                    return "; ".join(f"{k}={v}" for k, v in cookies.items() if v)
        except Exception:
            pass
        return ""

    def _load_proxy(self) -> str | None:
        """Load proxy from settings store."""
        try:
            from app.core.settings_store import settings_store
            from app.config import settings as app_settings
            return settings_store.get("proxy", app_settings.DEFAULT_PROXY)
        except Exception:
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

        # Add cookies for authenticated access (required in many regions)
        cookie_str = self._load_cookies_string()
        if cookie_str:
            headers["Cookie"] = cookie_str

        # Load proxy if configured
        proxy = self._load_proxy()
        proxies = {"https": proxy, "http": proxy} if proxy else None

        try:
            with requests.Session() as client:
                response = client.get(
                    url,
                    headers=headers,
                    timeout=15,
                    impersonate="chrome120",
                    proxies=proxies,
                )
                status = response.status_code
                content_type = response.headers.get("content-type", "")
                logger.info(f"Avatar HTML fetch for @{username}: status={status}, content-type={content_type}")

                if status != 200:
                    logger.warning(f"Avatar HTML fetch non-200 for @{username}: status={status}")
                    return None

                # Detect captcha / challenge / rate-limit / privacy-protection pages
                html_lower = response.text.lower()
                blocked_indicators = [
                    "captcha", "verify", "challenge", "privacy_protection_framework",
                    "serverless.tiktok.desktop", "tiktok_web_login_static",
                ]
                if any(ind in html_lower for ind in blocked_indicators):
                    logger.warning(f"Avatar HTML fetch hit blocked page for @{username}")
                    self._save_debug(username, response.text, "html")
                    return None

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
                        logger.warning(f"Avatar parse __UNIVERSAL_DATA__ failed for @{username}: {exc}")

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

                # Strategy 5: SIGI_STATE script tag (TikTok's newer hydration data)
                sigi_pattern = r'<script id="SIGI_STATE"[^>]*>(.*?)</script>'
                sigi_match = re.search(sigi_pattern, html, re.DOTALL)
                if sigi_match:
                    try:
                        sigi_data = json.loads(sigi_match.group(1).strip())
                        user_module = sigi_data.get("UserModule", {})
                        users = user_module.get("users", {})
                        for user_data in users.values():
                            avatar_url = (
                                user_data.get("avatarLarger")
                                or user_data.get("avatarMedium")
                                or user_data.get("avatarThumb")
                            )
                            if avatar_url:
                                logger.info(f"Got avatar URL via SIGI_STATE for @{username}")
                                return avatar_url
                    except (json.JSONDecodeError, Exception) as exc:
                        logger.warning(f"Avatar parse SIGI_STATE failed for @{username}: {exc}")

                # Strategy 6: __INITIAL_STATE__ script tag
                initial_state_pattern = r'<script[^>]*>window\.__INITIAL_STATE__\s*=\s*(.*?)</script>'
                initial_match = re.search(initial_state_pattern, html, re.DOTALL)
                if initial_match:
                    try:
                        raw = initial_match.group(1).strip().rstrip(';')
                        state = json.loads(raw)
                        user_info = state.get("user", {})
                        avatar_url = (
                            user_info.get("avatarLarger")
                            or user_info.get("avatarMedium")
                            or user_info.get("avatarThumb")
                        )
                        if avatar_url:
                            logger.info(f"Got avatar URL via __INITIAL_STATE__ for @{username}")
                            return avatar_url
                    except (json.JSONDecodeError, Exception) as exc:
                        logger.warning(f"Avatar parse __INITIAL_STATE__ failed for @{username}: {exc}")

                # Strategy 7: Broad image URL search for any tiktokcdn avatar
                broad_img = re.search(
                    r'(https?://[^"\'\s]+tiktokcdn\.com[^"\'\s]*avatar[^"\'\s]*)',
                    html, re.IGNORECASE,
                )
                if broad_img:
                    logger.info(f"Got avatar URL via broad search for @{username}")
                    return broad_img.group(1)

                # Strategy 8: Any tiktokcdn image URL that looks like a profile pic
                profile_img = re.search(
                    r'(https?://[^"\'\s]+tiktokcdn\.com[^"\'\s]*user[^"\'\s]*\.(?:jpg|jpeg|png|webp))',
                    html, re.IGNORECASE,
                )
                if profile_img:
                    logger.info(f"Got avatar URL via profile image search for @{username}")
                    return profile_img.group(1)

                # Strategy 9: Last-ditch catch-all — any avatarLarger/avatarMedium in raw source
                catch_all = re.search(
                    r'"avatarLarger"\s*:\s*"(https?://[^"]+)"',
                    html,
                )
                if catch_all:
                    logger.info(f"Got avatar URL via catch-all regex for @{username}")
                    return catch_all.group(1)

                # Nothing matched — log a snippet and save full HTML for debugging
                snippet = re.sub(r'\s+', ' ', html[:2000])
                logger.warning(f"Avatar HTML scraper found no avatar for @{username}. Snippet: {snippet}")
                self._save_debug(username, html, "html")

        except Exception as exc:
            logger.warning(f"Avatar HTML fetch failed for @{username}: {exc}")

        return None

    def _fetch_via_tiktok_scraper(self, username: str) -> str | None:
        """Run tiktok-scraper CLI to get avatar URL.

        tiktok-scraper outputs JSON that may be:
        - A dict with "userInfo" -> "user" -> avatarLarger/avatarMedium/avatarThumb
        - A list of user dicts with avatarLarger/avatarMedium/avatarThumb
        - A flat dict with "avatar_url" or "avatar" (legacy fallback)
        """
        try:
            proc = subprocess.run(
                ["tiktok-scraper", "user", username, "-t", "json"],
                capture_output=True, text=True, timeout=20,
            )
            if proc.returncode != 0:
                logger.warning(f"tiktok-scraper failed for @{username} (rc={proc.returncode}): {proc.stderr[:500]}")
                self._save_debug(username, f"STDOUT:\n{proc.stdout}\n\nSTDERR:\n{proc.stderr}", "txt")
                return None

            raw = json.loads(proc.stdout)

            # Normalize to a single user dict
            user_data: dict = {}
            if isinstance(raw, list) and raw:
                user_data = raw[0]
            elif isinstance(raw, dict):
                user_data = raw.get("userInfo", {}).get("user", raw)

            # Extract avatar URL (preferred order: largest first)
            avatar_url = (
                user_data.get("avatarLarger")
                or user_data.get("avatarMedium")
                or user_data.get("avatarThumb")
                or user_data.get("avatar_url")   # legacy fallback
                or user_data.get("avatar")        # legacy fallback
            )

            if avatar_url:
                logger.info(f"Got avatar URL via tiktok-scraper for @{username}")
                return avatar_url

            logger.debug(f"tiktok-scraper returned no avatar for @{username}; keys: {list(user_data.keys())[:10]}")
        except json.JSONDecodeError as exc:
            logger.warning(f"tiktok-scraper returned invalid JSON for @{username}: {exc}")
            self._save_debug(username, f"STDOUT:\n{proc.stdout}\n\nSTDERR:\n{proc.stderr}", "txt")
        except subprocess.TimeoutExpired:
            logger.warning(f"tiktok-scraper timed out for @{username}")
        except Exception as exc:
            logger.warning(f"tiktok-scraper avatar fetch failed for @{username}: {exc}")
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

        # Clear failure tracker on manual force-refresh
        if force:
            self.reset_failure(username)

        # Retry backoff gate
        if not self._should_retry(username):
            logger.info(f"Avatar fetch for @{username} skipped: backoff active")
            return None

        # Deduplication: prevent concurrent fetches for the same username
        with self._lock:
            if username in self._in_flight:
                logger.info(f"Avatar fetch for @{username} already in flight")
                return None
            self._in_flight.add(username)

        try:
            # Primary: HTML profile page scraper (fastest when it works)
            avatar_url: str | None = self._fetch_via_html_scraper(username)

            # Fallback: tiktok-scraper CLI (often broken/deprecated)
            if not avatar_url:
                avatar_url = self._fetch_via_tiktok_scraper(username)

            # Attempt recorder API (disabled — see note in _fetch_via_recorder)
            if not avatar_url and room_id:
                avatar_url = self._fetch_via_recorder(room_id)

            if avatar_url:
                result = self._download_and_cache(username, avatar_url)
                if result:
                    self._record_success(username)
                    return result
                else:
                    self._record_failure(username)
                    return None

            self._record_failure(username)
            logger.warning(f"All avatar fetch methods failed for @{username}")
            return None
        finally:
            with self._lock:
                self._in_flight.discard(username)

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
