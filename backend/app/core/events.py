"""In-process realtime event bus used for execution streaming (SSE).

The MVP runs a single API process. The interface is deliberately small so a Redis
pub/sub adapter can replace it without touching domain code (see docs).
"""

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any


class EventBus:
    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def subscribe(self, channel: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=500)
        async with self._lock:
            self._subscribers[channel].add(queue)
        return queue

    async def unsubscribe(self, channel: str, queue: asyncio.Queue) -> None:
        async with self._lock:
            self._subscribers[channel].discard(queue)

    async def publish(self, channel: str, event: dict[str, Any]) -> None:
        async with self._lock:
            queues = list(self._subscribers.get(channel, ()))
        for queue in queues:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # A slow client must never block execution. It can re-sync via polling.
                pass


event_bus = EventBus()
