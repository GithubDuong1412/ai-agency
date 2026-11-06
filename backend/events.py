"""Event bus: ghi sự kiện vào DB và đẩy realtime tới các client SSE.

Orchestrator chạy trong thread riêng nên publish() an toàn khi gọi từ thread bất kỳ.
"""
from __future__ import annotations

import asyncio
import threading

from .db import DB


class EventBus:
    def __init__(self, db: DB):
        self.db = db
        self._subs: set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = set()
        self._lock = threading.Lock()

    def publish(self, project_id: str, type_: str, agent: str | None = None, **data) -> dict:
        ev = self.db.add_event(project_id, type_, agent, data)
        with self._lock:
            subs = list(self._subs)
        for loop, q in subs:
            try:
                loop.call_soon_threadsafe(q.put_nowait, ev)
            except RuntimeError:  # loop đã đóng
                self.unsubscribe((loop, q))
        return ev

    def subscribe(self) -> tuple[asyncio.AbstractEventLoop, asyncio.Queue]:
        sub = (asyncio.get_running_loop(), asyncio.Queue())
        with self._lock:
            self._subs.add(sub)
        return sub

    def unsubscribe(self, sub) -> None:
        with self._lock:
            self._subs.discard(sub)
