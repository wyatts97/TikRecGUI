import logging
import threading
import asyncio
from datetime import datetime
from typing import Optional

import httpx
from TikTokLive import TikTokLiveClient
from TikTokLive.events import CommentEvent, GiftEvent, ConnectEvent

from app.db.database import get_session
from app.db.models import LiveEvent

logger = logging.getLogger("tikrec.live_chat")


class LiveChatListener:
    """Per-recording WebSocket listener for TikTok live chat/gift events.

    Runs in a dedicated daemon thread with its own asyncio event loop.
    Fire-and-forget: failure does not affect the recording.

    TikTok's webcast edge rejects the WebSocket handshake intermittently
    (Cloudflare answers the upgrade with HTTP 400), especially for anonymous
    connections from datacenter IPs.  A single attempt therefore loses chat
    for a whole session at random, so the listener keeps reconnecting with
    exponential backoff for as long as the recording is running.
    """

    # Reconnect backoff, in seconds.
    INITIAL_BACKOFF = 5
    MAX_BACKOFF = 60
    # Give up after this many consecutive failures with no successful
    # connection in between, so an ended room stops hammering the sign server.
    MAX_CONSECUTIVE_FAILURES = 10
    # How long to wait for a connection task to wind down after a disconnect
    # before cancelling it, so a stuck socket cannot wedge the listener thread.
    SHUTDOWN_TIMEOUT = 10

    def __init__(
        self,
        recording_id: int,
        username: str,
        room_id: str,
        started_at: datetime,
        proxy: Optional[str] = None,
        cookies: Optional[dict] = None,
    ):
        self.recording_id = recording_id
        self.username = username
        self.room_id = room_id
        self.started_at = started_at
        self.proxy = proxy
        self.cookies = cookies
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        # Capture tallies, reported when the listener exits so that "no chat
        # events because the room was quiet" can be told apart from "never
        # connected".
        self._connect_count = 0
        self._chat_count = 0
        self._gift_count = 0

    def start(self):
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop_event.set()

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def _run(self):
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(self._run_async())
        except Exception as exc:
            logger.warning(
                "LiveChatListener for recording %d ended: %s",
                self.recording_id,
                exc,
                exc_info=True,
            )
        finally:
            loop.close()

    def _make_proxy_objects(self) -> tuple:
        """Convert proxy string to httpx.Proxy objects for web and WS."""
        if not self.proxy:
            return None, None
        try:
            proxy_obj = httpx.Proxy(url=self.proxy)
            return proxy_obj, proxy_obj
        except Exception as exc:
            logger.warning(
                "Invalid proxy '%s' for chat listener: %s", self.proxy, exc
            )
            return None, None

    def _apply_session_cookies(self, client: TikTokLiveClient) -> bool:
        """Authenticate the webcast client with the configured TikTok session.

        TikTok rejects far more anonymous handshakes than signed-in ones,
        particularly from server IPs, so this materially improves the odds of
        the WebSocket connecting at all.  Returns True if a session was set.
        """
        if not self.cookies:
            return False
        session_id = self.cookies.get("sessionid_ss") or self.cookies.get("sessionid")
        if not session_id:
            return False
        tt_target_idc = (
            self.cookies.get("tt-target-idc")
            or self.cookies.get("tt_target_idc")
            or None
        )
        try:
            client.web.set_session(session_id, tt_target_idc)
            return True
        except Exception as exc:
            logger.warning(
                "Could not apply session cookies to chat client for recording %d: %s",
                self.recording_id,
                exc,
            )
            return False

    async def _sleep_unless_stopped(self, seconds: float):
        """Sleep in 1 s slices so a stop request is acted on promptly."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + seconds
        while not self._stop_event.is_set():
            remaining = deadline - loop.time()
            if remaining <= 0:
                return
            await asyncio.sleep(min(1.0, remaining))

    async def _run_async(self):
        backoff = self.INITIAL_BACKOFF
        consecutive_failures = 0
        attempt = 0

        try:
            while not self._stop_event.is_set():
                attempt += 1
                connected = await self._connect_once(attempt)

                if self._stop_event.is_set():
                    break

                if connected:
                    # A working session dropped mid-stream: reset the backoff
                    # so we get back onto the socket promptly.
                    consecutive_failures = 0
                    backoff = self.INITIAL_BACKOFF
                    logger.info(
                        "Chat capture for recording %d dropped after connecting; "
                        "reconnecting in %ds",
                        self.recording_id,
                        backoff,
                    )
                else:
                    consecutive_failures += 1
                    if consecutive_failures >= self.MAX_CONSECUTIVE_FAILURES:
                        logger.error(
                            "Giving up on chat capture for recording %d after %d "
                            "consecutive failed connection attempts",
                            self.recording_id,
                            consecutive_failures,
                        )
                        break
                    logger.warning(
                        "Chat capture attempt %d for recording %d did not connect; "
                        "retrying in %ds (failure %d/%d)",
                        attempt,
                        self.recording_id,
                        backoff,
                        consecutive_failures,
                        self.MAX_CONSECUTIVE_FAILURES,
                    )

                await self._sleep_unless_stopped(backoff)
                backoff = min(backoff * 2, self.MAX_BACKOFF)
        finally:
            if self._connect_count == 0:
                logger.error(
                    "Chat capture for recording %d (@%s) NEVER connected after %d "
                    "attempt(s) - this recording has no chat or gift events",
                    self.recording_id,
                    self.username,
                    attempt,
                )
            else:
                logger.info(
                    "Chat capture for recording %d finished: %d chat + %d gift "
                    "events over %d connection(s)",
                    self.recording_id,
                    self._chat_count,
                    self._gift_count,
                    self._connect_count,
                )

    async def _connect_once(self, attempt: int) -> bool:
        """Run one connection attempt to exhaustion.

        Returns True if the socket actually connected at least once during
        this attempt, so the caller can tell a dropped session apart from a
        handshake that was refused outright.
        """
        web_proxy, ws_proxy = self._make_proxy_objects()
        client = TikTokLiveClient(
            unique_id=f"@{self.username}",
            web_proxy=web_proxy,
            ws_proxy=ws_proxy,
        )
        authed = self._apply_session_cookies(client)

        connected = False

        # --- Event handlers ---

        @client.on(ConnectEvent)
        async def on_connect(event: ConnectEvent):
            nonlocal connected
            connected = True
            self._connect_count += 1
            logger.info(
                "Chat capture connected for @%s (recording %d, room=%s, "
                "attempt %d, authenticated=%s)",
                self.username,
                self.recording_id,
                client.room_id,
                attempt,
                authed,
            )

        @client.on(CommentEvent)
        async def on_comment(event: CommentEvent):
            if self._stop_event.is_set():
                await client.disconnect()
                return
            offset = (datetime.utcnow() - self.started_at).total_seconds()
            try:
                with get_session() as db:
                    db.add(
                        LiveEvent(
                            recording_id=self.recording_id,
                            offset_seconds=offset,
                            event_type="chat",
                            user_nickname=event.user.nickname,
                            user_unique_id=event.user.unique_id,
                            content=event.comment,
                        )
                    )
                    db.commit()
                self._chat_count += 1
                logger.debug(
                    "Chat event saved for recording %d: @%s: %s",
                    self.recording_id,
                    event.user.nickname,
                    event.comment[:60] if event.comment else "",
                )
            except Exception as e:
                logger.warning("Failed to save chat event: %s", e)

        @client.on(GiftEvent)
        async def on_gift(event: GiftEvent):
            if self._stop_event.is_set():
                await client.disconnect()
                return
            # Skip intermediate streak ticks — only save when the streak is complete
            # (or for non-streakable gifts which are always final).
            if event.gift.streakable and event.streaking:
                return
            offset = (datetime.utcnow() - self.started_at).total_seconds()
            repeat_count = event.repeat_count
            diamond_count = getattr(event.gift, 'diamond_count', None)
            try:
                with get_session() as db:
                    db.add(
                        LiveEvent(
                            recording_id=self.recording_id,
                            offset_seconds=offset,
                            event_type="gift",
                            user_nickname=event.user.nickname,
                            user_unique_id=event.user.unique_id,
                            gift_name=event.gift.name,
                            gift_diamond_count=diamond_count,
                            gift_repeat_count=repeat_count,
                        )
                    )
                    db.commit()
                self._gift_count += 1
                logger.debug(
                    "Gift event saved for recording %d: @%s sent %s x%d",
                    self.recording_id,
                    event.user.nickname,
                    event.gift.name,
                    repeat_count,
                )
            except Exception as e:
                logger.warning("Failed to save gift event: %s", e)

        # --- Connect and poll ---

        connection_task = None
        try:
            # Start non-blocking so we can poll the stop event.
            # Pass room_id directly to skip HTML scraping (often blocked on servers).
            # fetch_live_check=False because Phase 2 already confirmed the stream is live.
            # fetch_gift_info=True enables gift name/metadata resolution.
            connection_task = await client.start(
                room_id=int(self.room_id),
                fetch_live_check=False,
                fetch_gift_info=True,
            )
        except Exception:
            logger.warning(
                "Chat capture attempt %d for recording %d failed to start",
                attempt,
                self.recording_id,
                exc_info=True,
            )
            await self._shutdown_client(client)
            return connected

        try:
            # Poll until recording stops or the connection drops
            while not self._stop_event.is_set() and not connection_task.done():
                await asyncio.sleep(1)

            # If we were asked to stop, disconnect cleanly
            if self._stop_event.is_set() and client.connected:
                logger.info(
                    "Stopping chat capture for recording %d",
                    self.recording_id,
                )
                await client.disconnect()

            # Let the connection task finish cleanly, but never block the
            # listener thread forever if the socket refuses to wind down.
            # asyncio.wait() is used rather than awaiting the task directly:
            # it observes the task without re-raising its outcome, so a
            # cancelled connection task cannot kill the retry loop with a
            # CancelledError (which `except Exception` would not catch).
            if not connection_task.done():
                finished, _pending = await asyncio.wait(
                    {connection_task}, timeout=self.SHUTDOWN_TIMEOUT
                )
                if not finished:
                    logger.warning(
                        "Chat capture task for recording %d did not finish within "
                        "%ds; cancelling it",
                        self.recording_id,
                        self.SHUTDOWN_TIMEOUT,
                    )
                    connection_task.cancel()

        except Exception:
            logger.warning(
                "LiveChat client for recording %d error",
                self.recording_id,
                exc_info=True,
            )
        finally:
            # The WebSocket handshake runs inside the task returned by start(),
            # so a rejected handshake surfaces ONLY as that task's exception.
            # Without retrieving it here the failure is invisible apart from
            # asyncio's late "Task exception was never retrieved" warning at
            # garbage-collection time.
            self._log_task_exception(connection_task, attempt)
            await self._shutdown_client(client)

        return connected

    def _log_task_exception(self, task, attempt: int):
        """Surface the exception held by a finished connection task."""
        if task is None or not task.done():
            return
        try:
            exc = task.exception()
        except asyncio.CancelledError:
            return
        if exc is None:
            return
        logger.warning(
            "Chat capture connection for recording %d (@%s, attempt %d) ended: %s: %s",
            self.recording_id,
            self.username,
            attempt,
            type(exc).__name__,
            exc,
            exc_info=exc,
        )

    async def _shutdown_client(self, client: TikTokLiveClient):
        """Tear a client down without letting cleanup errors escape."""
        try:
            await client.disconnect(close_client=True)
        except Exception:
            logger.debug(
                "Chat client cleanup for recording %d failed",
                self.recording_id,
                exc_info=True,
            )


class LiveChatService:
    """Singleton service managing multiple LiveChatListener instances.

    Each recording gets its own listener thread.  Max 3 concurrent listeners.
    """

    MAX_WORKERS = 3

    def __init__(self):
        self._listeners: dict[int, LiveChatListener] = {}
        self._lock = threading.Lock()

    def start_listening(
        self,
        recording_id: int,
        username: str,
        room_id: str,
        started_at: datetime,
        proxy: Optional[str] = None,
        cookies: Optional[dict] = None,
    ) -> bool:
        with self._lock:
            if recording_id in self._listeners:
                logger.warning("Already listening for recording %d", recording_id)
                return False
            if len(self._listeners) >= self.MAX_WORKERS:
                logger.warning("Max listeners reached (%d)", self.MAX_WORKERS)
                return False

            listener = LiveChatListener(
                recording_id=recording_id,
                username=username,
                room_id=room_id,
                started_at=started_at,
                proxy=proxy,
                cookies=cookies,
            )
            listener.start()
            self._listeners[recording_id] = listener
            logger.info("Started chat capture for recording %d", recording_id)
            return True

    def stop_listening(self, recording_id: int) -> bool:
        with self._lock:
            listener = self._listeners.pop(recording_id, None)
            if listener:
                was_running = listener.is_running()
                listener.stop()
                if was_running:
                    logger.info("Stopped chat capture for recording %d", recording_id)
                else:
                    logger.warning(
                        "Chat capture for recording %d had already died before the "
                        "recording ended",
                        recording_id,
                    )
                return True
            return False

    def is_listening(self, recording_id: int) -> bool:
        with self._lock:
            listener = self._listeners.get(recording_id)
            return listener is not None and listener.is_running()

    def get_active_count(self) -> int:
        with self._lock:
            return len(self._listeners)

    def cleanup_finished(self):
        with self._lock:
            finished = [
                rid
                for rid, listener in self._listeners.items()
                if not listener.is_running()
            ]
            for rid in finished:
                del self._listeners[rid]


live_chat_service = LiveChatService()
