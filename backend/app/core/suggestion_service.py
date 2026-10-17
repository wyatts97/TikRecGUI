"""Live creators related to the watchlist, for the dashboard's "Suggested live" rail.

TikTok's own suggestions (``webcast/feed`` with ``req_from=live_end_recommend_web``)
only answer requests carrying X-Bogus/X-Gnarly signatures, and the one
signer the app could use for arbitrary webcast URLs (Euler Stream's
``sign_url``) needs a paid Business plan. So suggestions come from what
TikRec already captures in the watchlist's lives: creators they battled,
and people who gift or chat there. The best-ranked candidates are then
checked for being live right now, in the background, and cached.
"""
import logging
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import func

from app.db.database import get_session
from app.db.models import LiveEvent, Recording, User

logger = logging.getLogger("tikrec.suggestions")

LOOKBACK_DAYS = 30
MAX_CANDIDATES = 24
# How long a finished refresh is served before the next request starts another.
REFRESH_SECONDS = 10 * 60
# A forced refresh (the UI's refresh button) is still throttled to this.
MIN_FORCED_REFRESH_SECONDS = 60
# Pause between candidates' live checks, to stay gentle with TikTok.
CHECK_DELAY_SECONDS = 1.0

# Per related watched creator: a battle is a strong tie between two creators;
# gifting is a deliberate one; chat is weak, and capped so a single chatty
# viewer cannot outrank everyone.
_WEIGHTS = {"battle": 10.0, "gift": 2.0, "chat": 0.25}
_CAPS = {"battle": 5, "gift": 20, "chat": 40}


@dataclass
class Candidate:
    username: str
    nickname: str
    score: float = 0.0
    related_to: list[str] = field(default_factory=list)
    signals: dict[str, int] = field(default_factory=dict)


def rank_candidates(db, now: datetime | None = None, limit: int = MAX_CANDIDATES) -> list[Candidate]:
    """Rank people seen in the watchlist's captured lives, best first."""
    cutoff = (now or datetime.utcnow()) - timedelta(days=LOOKBACK_DAYS)
    watched = {
        name.lower()
        for (name,) in db.query(User.username).filter(User.is_on_watchlist == True)  # noqa: E712
    }
    rows = (
        db.query(
            LiveEvent.user_unique_id,
            func.max(LiveEvent.user_nickname),
            LiveEvent.event_type,
            User.username,
            func.count(LiveEvent.id),
        )
        .join(Recording, LiveEvent.recording_id == Recording.id)
        .join(User, Recording.user_id == User.id)
        .filter(
            User.is_on_watchlist == True,  # noqa: E712
            LiveEvent.created_at >= cutoff,
            LiveEvent.user_unique_id.isnot(None),
            LiveEvent.user_unique_id != "",
            LiveEvent.event_type.in_(list(_WEIGHTS)),
        )
        .group_by(LiveEvent.user_unique_id, LiveEvent.event_type, User.username)
        .all()
    )

    by_user: dict[str, Candidate] = {}
    per_pair: dict[tuple[str, str], float] = defaultdict(float)
    for unique_id, nickname, event_type, host, count in rows:
        key = unique_id.lower()
        if key in watched:
            continue
        cand = by_user.setdefault(key, Candidate(username=unique_id, nickname=nickname or unique_id))
        cand.signals[event_type] = cand.signals.get(event_type, 0) + count
        per_pair[(key, host)] += _WEIGHTS[event_type] * min(count, _CAPS[event_type])

    related: dict[str, list[tuple[float, str]]] = defaultdict(list)
    for (key, host), score in per_pair.items():
        related[key].append((score, host))
    for key, cand in by_user.items():
        pairs = sorted(related[key], reverse=True)
        cand.related_to = [host for _, host in pairs]
        # Showing up around several watched creators beats a lot of activity
        # around one.
        cand.score = sum(s for s, _ in pairs) * (1 + 0.5 * (len(pairs) - 1))

    ranked = sorted(by_user.values(), key=lambda c: (-c.score, c.username.lower()))
    return ranked[:limit]


def check_live(api, username: str) -> dict | None:
    """Return live-room details for *username*, or None if not live."""
    from app.core.recorder_service import recorder_service

    room_id = recorder_service.resolve_room_id(api, username)
    if not room_id:
        return None
    info = api.http_client.get(
        f"{api.WEBCAST_URL}/webcast/room/info/?aid=1988&room_id={room_id}"
    ).json()
    data = info.get("data") or {}
    if info.get("status_code", 0) != 0 or str(data.get("status")) != "2":
        return None
    owner = data.get("owner") or {}

    def first_url(image) -> str | None:
        urls = (image or {}).get("url_list") or []
        return urls[0] if urls else None

    return {
        "room_id": str(room_id),
        "nickname": owner.get("nickname") or username,
        "title": data.get("title") or "",
        "viewer_count": data.get("user_count"),
        "avatar_url": first_url(owner.get("avatar_thumb")),
        "cover_url": first_url(data.get("cover")),
        "live_url": f"https://www.tiktok.com/@{username}/live",
    }


class SuggestionService:
    def __init__(self):
        self._lock = threading.Lock()
        self._items: list[dict] = []
        self._generated_at: datetime | None = None
        self._checked = 0
        self._errors = 0
        self._refreshing = False
        self._last_started = 0.0

    def get(self, force: bool = False) -> dict:
        """Return the cached suggestions, starting a refresh if they are stale."""
        with self._lock:
            age = time.monotonic() - self._last_started
            stale = self._generated_at is None or age >= REFRESH_SECONDS
            if not self._refreshing and (stale or (force and age >= MIN_FORCED_REFRESH_SECONDS)):
                self._refreshing = True
                self._last_started = time.monotonic()
                threading.Thread(target=self._refresh, daemon=True, name="suggestions").start()
            return {
                "items": list(self._items),
                "generated_at": self._generated_at.isoformat() if self._generated_at else None,
                "refreshing": self._refreshing,
                "checked": self._checked,
                "errors": self._errors,
            }

    def _refresh(self) -> None:
        from app.core.recorder_service import recorder_service

        items: list[dict] = []
        checked = errors = 0
        try:
            with get_session() as db:
                candidates = rank_candidates(db)
            api = recorder_service.get_api() if candidates else None
            for cand in candidates:
                checked += 1
                try:
                    live = check_live(api, cand.username)
                except Exception as exc:
                    errors += 1
                    logger.debug("Suggestion live check for @%s failed: %s", cand.username, exc)
                    live = None
                if live:
                    items.append({
                        "username": cand.username,
                        **live,
                        "related_to": cand.related_to[:3],
                        "signals": cand.signals,
                        "score": round(cand.score, 2),
                    })
                time.sleep(CHECK_DELAY_SECONDS)
        except Exception:
            logger.exception("Refreshing live suggestions failed")
        finally:
            with self._lock:
                self._items = items
                self._generated_at = datetime.utcnow()
                self._checked = checked
                self._errors = errors
                self._refreshing = False
        if checked:
            logger.info(
                "Live suggestions: %d of %d candidate(s) live (%d check error(s))",
                len(items), checked, errors,
            )


suggestion_service = SuggestionService()
