"""Live detection must survive tikrec outages and say when it is failing.

Regression tests: the recorder's room-ID lookup goes through tikrec.com, and
its only fallback (Euler Stream room_info) now answers 401 without a paid
plan, so a tikrec hiccup made every watched user read as offline. The error
was swallowed, so the UI showed "nobody is live" rather than "lookups fail".
"""
from app.core import recorder_service as rs
from app.core import task_manager as tm


class _Response:
    def __init__(self, text="", payload=None, status_code=200):
        self.text = text
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload


class _Http:
    def __init__(self, routes):
        self.routes = routes

    def get(self, url, params=None, **kwargs):
        for fragment, response in self.routes.items():
            if fragment in url:
                if isinstance(response, Exception):
                    raise response
                return response
        raise AssertionError(f"unexpected request {url}")


class _Api:
    BASE_URL = "https://www.tiktok.com"

    def __init__(self, tikrec, routes, alive=True):
        self._tikrec = tikrec
        self.http_client = _Http(routes)
        self.alive = alive

    def get_room_id_from_user(self, user):
        if isinstance(self._tikrec, Exception):
            raise self._tikrec
        return self._tikrec

    def is_room_alive(self, room_id):
        return self.alive


def _service(monkeypatch, api):
    service = rs.RecorderService.__new__(rs.RecorderService)
    service.__init__()
    monkeypatch.setattr(service, "get_api", lambda: api)
    return service


_SIGI = (
    '<script id="SIGI_STATE" type="application/json">'
    '{"LiveRoom":{"liveRoomUserInfo":{"user":{"uniqueId":"Alice","roomId":"777"}}}}'
    "</script>"
)


def test_tikrec_outage_falls_back_to_unsigned_api():
    api = _Api(
        RuntimeError("Error extracting RoomID"),
        {"api-live/user/room": _Response("{}", {"data": {"user": {"roomId": "555"}}})},
    )
    assert rs.RecorderService.resolve_room_id(None, api, "alice") == "555"


def test_live_page_is_the_last_resort_and_checks_the_owner():
    api = _Api(
        RuntimeError("tikrec down"),
        {
            "api-live/user/room": _Response(""),  # WAF: empty body
            "/@alice/live": _Response(_SIGI),
        },
    )
    assert rs.RecorderService.resolve_room_id(None, api, "alice") == "777"
    # A recommended room on someone else's page must not be taken as theirs.
    api.http_client.routes["/@bob/live"] = _Response(_SIGI)
    assert rs.RecorderService.resolve_room_id(None, api, "bob") is None


def test_missing_user_is_not_an_error_but_total_failure_is():
    missing = _Api(None, {
        "api-live/user/room": _Response("{}", {"data": None, "statusCode": 19881007}),
        "/@ghost/live": _Response("<html>" + _SIGI.replace("Alice", "someone") + "</html>"),
    })
    assert rs.RecorderService.resolve_room_id(None, missing, "ghost") is None

    blocked = _Api(RuntimeError("tikrec down"), {
        "api-live/user/room": _Response("Please wait..."),
        "/@alice/live": _Response("Please wait..."),
    })
    try:
        rs.RecorderService.resolve_room_id(None, blocked, "alice")
    except RuntimeError as exc:
        assert "tikrec down" in str(exc) and "WAF" in str(exc)
    else:
        raise AssertionError("a lookup where every path fails must raise")


def test_failing_checks_are_reported_until_they_recover(monkeypatch):
    blocked = _Api(RuntimeError("tikrec down"), {
        "api-live/user/room": _Response(""),
        "/@alice/live": _Response(""),
    })
    service = _service(monkeypatch, blocked)

    result = service.check_user_live("alice")
    assert result["is_live"] is False and result["error"]
    health = service.live_check_health()
    assert health["failing_users"] == 1
    assert health["last_error_user"] == "alice"

    monkeypatch.setattr(service, "get_api", lambda: _Api("123", {}))
    assert service.check_user_live("alice")["is_live"] is True
    health = service.live_check_health()
    assert health["failing_users"] == 0
    assert health["last_ok_at"] is not None


def test_api_construction_failure_does_not_escape_check(monkeypatch):
    # e.g. the recorder's proxy self-test raising: this used to propagate out
    # of check_user_live and abort the monitor's whole cycle.
    service = _service(monkeypatch, None)

    def boom():
        raise OSError("proxy check failed")

    monkeypatch.setattr(service, "get_api", boom)
    assert service.check_user_live("alice")["error"] == "proxy check failed"


class _CandidateApi:
    def __init__(self, urls):
        self.urls = urls

    def get_live_url_candidates(self, room_id, user=None):
        return list(self.urls)


_HD_FLV = "https://pull-f5.tiktokcdn.com/game/stream-1_hd.flv?expire=1&sign=a"
_HD_HLS = "https://pull-hls.tiktokcdn.com/game/stream-1_hd/index.m3u8?expire=1&sign=b"
_AUDIO = "https://pull-f5.tiktokcdn.com/game/stream-1.flv?expire=1&sign=c&only_audio=1"


def test_failed_stream_url_moves_on_to_the_next_candidate():
    api = _CandidateApi([_HD_FLV, _HD_HLS, _AUDIO])
    assert tm._pick_live_url(api, "1", "u") == _HD_FLV

    # Re-signed URLs differ only in the query string; the key ignores it.
    resigned = _HD_FLV.replace("sign=a", "sign=z")
    failed = {tm._url_key(resigned)}
    assert tm._pick_live_url(api, "1", "u", failed) == _HD_HLS

    # Never fall through to the audio-only rendition while video exists.
    failed.add(tm._url_key(_HD_HLS))
    assert tm._pick_live_url(api, "1", "u", failed) == _HD_FLV


def test_audio_only_is_used_when_it_is_all_there_is():
    assert tm._pick_live_url(_CandidateApi([_AUDIO]), "1", "u") == _AUDIO


def test_recorder_without_candidates_api_still_works():
    class LegacyApi:
        def get_live_url(self, room_id, user=None):
            return _HD_FLV

    assert tm._pick_live_url(LegacyApi(), "1", "u") == _HD_FLV
