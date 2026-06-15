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
    """

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
        except Exception:
            logger.warning(
                "LiveChatListener for recording %d ended: %s",
                self.recording_id,
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

    async def _run_async(self):
        web_proxy, ws_proxy = self._make_proxy_objects()
        # Pass cookies at construction so they apply to all HTTP requests
        # (including the initial sign-server fetch), not just post-init.
        httpx_kwargs: dict = {}
        if self.cookies:
            httpx_kwargs["cookies"] = self.cookies
        client = TikTokLiveClient(
            unique_id=f"@{self.username}",
            web_proxy=web_proxy,
            ws_proxy=ws_proxy,
            httpx_kwargs=httpx_kwargs if httpx_kwargs else None,
        )

        # --- Event handlers ---

        @client.on(ConnectEvent)
        async def on_connect(event: ConnectEvent):
            logger.info(
                "Chat capture connected for @%s (recording %d, room=%s)",
                self.username,
                self.recording_id,
                client.room_id,
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

            # Let the connection task finish cleanly
            if not connection_task.done():
                await connection_task

        except Exception:
            logger.warning(
                "LiveChat client for recording %d error",
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
                listener.stop()
                logger.info("Stopped chat capture for recording %d", recording_id)
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
