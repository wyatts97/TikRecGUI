"""Suggested live creators, ranked from what the watchlist's lives captured."""
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

from app.core import suggestion_service as ss
from app.core.live_chat_service import battle_opponents


@pytest.fixture(scope="module")
def db():
    import app.db.database as database
    import app.db.models as models
    database.Base.metadata.create_all(bind=database.engine)
    return database, models


def _seed(database, models):
    now = datetime.utcnow()
    with database.get_session() as s:
        hosts = {}
        for name, on_watchlist in (("sg_alpha", True), ("sg_bravo", True), ("sg_gone", False)):
            user = models.User(username=name, is_on_watchlist=on_watchlist)
            s.add(user)
            s.flush()
            rec = models.Recording(user_id=user.id, filename=f"TK_{name}.mp4", status="completed")
            s.add(rec)
            s.flush()
            hosts[name] = rec.id

        def ev(host, kind, who, n=1, age_days=0):
            for _ in range(n):
                s.add(models.LiveEvent(
                    recording_id=hosts[host], offset_seconds=1.0, event_type=kind,
                    user_nickname=who.upper(), user_unique_id=who,
                    created_at=now - timedelta(days=age_days),
                ))

        ev("sg_alpha", "battle", "sg_rival")          # battled alpha...
        ev("sg_bravo", "chat", "sg_rival")            # ...and hangs out with bravo
        ev("sg_alpha", "chat", "sg_chatty", n=500)    # loud, but chat is capped
        ev("sg_alpha", "gift", "sg_gifter", n=3)
        ev("sg_bravo", "chat", "sg_alpha", n=50)      # a watched creator: never suggested
        ev("sg_alpha", "gift", "sg_stale", n=20, age_days=90)  # outside the lookback
        ev("sg_gone", "battle", "sg_orphan")          # host no longer watched
        s.commit()


def test_ranking_prefers_battles_and_breadth(db):
    database, models = db
    _seed(database, models)
    with database.get_session() as s:
        ranked = [c for c in ss.rank_candidates(s, limit=1000) if c.username.startswith("sg_")]
    names = [c.username for c in ranked]

    assert names[0] == "sg_rival"
    assert ranked[0].related_to == ["sg_alpha", "sg_bravo"]
    assert ranked[0].signals == {"battle": 1, "chat": 1}
    assert names.index("sg_chatty") < names.index("sg_gifter")  # 40 capped chats beat 3 gifts
    for excluded in ("sg_alpha", "sg_bravo", "sg_stale", "sg_orphan"):
        assert excluded not in names


class _Api:
    WEBCAST_URL = "https://webcast.tiktok.com"

    def __init__(self, payload):
        self.http_client = SimpleNamespace(get=lambda url: SimpleNamespace(json=lambda: payload))


def test_check_live_reads_room_info(monkeypatch):
    from app.core.recorder_service import recorder_service
    monkeypatch.setattr(recorder_service, "resolve_room_id", lambda api, user: "42")

    live = ss.check_live(_Api({"status_code": 0, "data": {
        "status": 2, "title": "Ranked grind", "user_count": 31,
        "owner": {"nickname": "Rival", "avatar_thumb": {"url_list": ["https://a/1.jpg"]}},
        "cover": {"url_list": ["https://c/1.jpg"]},
    }}), "sg_rival")
    assert live["room_id"] == "42" and live["viewer_count"] == 31
    assert live["avatar_url"] == "https://a/1.jpg" and live["title"] == "Ranked grind"

    assert ss.check_live(_Api({"status_code": 0, "data": {"status": 4}}), "sg_rival") is None
    assert ss.check_live(_Api({"status_code": 4003110, "data": {}}), "sg_rival") is None
    monkeypatch.setattr(recorder_service, "resolve_room_id", lambda api, user: None)
    assert ss.check_live(_Api({}), "sg_rival") is None


def test_battle_opponents_skip_the_host():
    def anchor(uid, nick):
        return SimpleNamespace(value=SimpleNamespace(user=SimpleNamespace(display_id=uid, nick_name=nick)))

    event = SimpleNamespace(anchors_info=[anchor("Host", "Me"), anchor("rival", "Rival"), anchor("", "x")])
    assert battle_opponents(event, "host") == [("rival", "Rival")]
    assert battle_opponents(SimpleNamespace(), "host") == []


def test_service_refreshes_in_the_background(monkeypatch):
    service = ss.SuggestionService()
    monkeypatch.setattr(ss, "CHECK_DELAY_SECONDS", 0)
    monkeypatch.setattr(ss, "rank_candidates", lambda db: [
        ss.Candidate("live_one", "One", 5.0, ["sg_alpha"], {"battle": 1}),
        ss.Candidate("offline", "Off", 1.0, ["sg_alpha"], {"chat": 2}),
        ss.Candidate("broken", "Err", 0.5, ["sg_alpha"], {"chat": 1}),
    ])

    def fake_check(api, username):
        if username == "broken":
            raise RuntimeError("WAF")
        return {"room_id": "1", "nickname": "One"} if username == "live_one" else None

    monkeypatch.setattr(ss, "check_live", fake_check)
    from app.core.recorder_service import recorder_service
    monkeypatch.setattr(recorder_service, "get_api", lambda: object())

    first = service.get()
    assert first["refreshing"] is True and first["items"] == []
    for thread in __import__("threading").enumerate():
        if thread.name == "suggestions":
            thread.join(10)

    result = service.get()
    assert result["refreshing"] is False
    assert [i["username"] for i in result["items"]] == ["live_one"]
    assert result["checked"] == 3 and result["errors"] == 1
    # Fresh results are served from cache; a forced refresh is throttled.
    assert service.get(force=True)["refreshing"] is False
