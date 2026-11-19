"""Cache adapter: Redis when configured, safe in-process TTL cache otherwise."""

from __future__ import annotations

import json
import time
from typing import Any

from app.core.config import settings


class MemoryCache:
    kind = "memory"

    def __init__(self) -> None:
        self._store: dict[str, tuple[float, str]] = {}

    async def get(self, key: str) -> Any | None:
        entry = self._store.get(key)
        if not entry:
            return None
        expires_at, value = entry
        if expires_at < time.monotonic():
            self._store.pop(key, None)
            return None
        return json.loads(value)

    async def set(self, key: str, value: Any, ttl_seconds: int = 30) -> None:
        self._store[key] = (time.monotonic() + ttl_seconds, json.dumps(value, default=str))

    async def delete(self, key: str) -> None:
        self._store.pop(key, None)

    async def ping(self) -> bool:
        return True


class RedisCache:
    kind = "redis"

    def __init__(self, url: str) -> None:
        import redis.asyncio as redis

        self._client = redis.from_url(url, decode_responses=True)

    async def get(self, key: str) -> Any | None:
        raw = await self._client.get(key)
        return json.loads(raw) if raw is not None else None

    async def set(self, key: str, value: Any, ttl_seconds: int = 30) -> None:
        await self._client.set(key, json.dumps(value, default=str), ex=ttl_seconds)

    async def delete(self, key: str) -> None:
        await self._client.delete(key)

    async def ping(self) -> bool:
        try:
            return bool(await self._client.ping())
        except Exception:
            return False


def build_cache() -> MemoryCache | RedisCache:
    if settings.redis_url:
        try:
            return RedisCache(settings.redis_url)
        except Exception:
            return MemoryCache()
    return MemoryCache()


cache = build_cache()
