import logging
import threading
import asyncio
from datetime import datetime
from typing import Optional

from TikTokLive import TikTokLiveClient
from TikTokLive.events import CommentEvent, GiftEvent

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
        started_at: datetime,
        proxy: Optional[str] = None,
    ):
        self.recording_id = recording_id
        self.username = username
        self.started_at = started_at
        self.proxy = proxy
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

    async def _run_async(self):
        client = TikTokLiveClient(unique_id=f"@{self.username}", proxy=self.proxy)

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
            except Exception as e:
                logger.warning("Failed to save chat event: %s", e)

        @client.on(GiftEvent)
        async def on_gift(event: GiftEvent):
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
                            event_type="gift",
                            user_nickname=event.user.nickname,
                            user_unique_id=event.user.unique_id,
                            gift_name=event.gift.name,
                            gift_diamond_count=event.gift.diamond_count,
                            gift_repeat_count=event.gift.repeat_count,
                        )
                    )
                    db.commit()
            except Exception as e:
                logger.warning("Failed to save gift event: %s", e)

        try:
            await client.run()
        except Exception:
            logger.warning(
                "LiveChat client for recording %d disconnected",
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
        started_at: datetime,
        proxy: Optional[str] = None,
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
                started_at=started_at,
                proxy=proxy,
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
