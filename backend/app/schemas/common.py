"""Shared response envelopes."""

from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict

T = TypeVar("T")


class APIModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    pages: int


class MessageResponse(BaseModel):
    message: str


class HealthComponent(BaseModel):
    key: str
    name: str
    status: str
    detail: str
    latency_ms: float | None = None


class SystemHealth(BaseModel):
    status: str
    version: str
    environment: str
    generated_at: str
    components: list[HealthComponent]
