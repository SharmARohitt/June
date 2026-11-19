"""Security checks for application configuration defaults."""

from __future__ import annotations

import secrets

import pytest

from app.core.config import get_settings


@pytest.fixture(autouse=True)
def clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_sample_seeding_is_disabled_by_default(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("JUNE_ENV", "development")
    monkeypatch.setenv("JUNE_SECRET_KEY", secrets.token_urlsafe(48))
    monkeypatch.delenv("JUNE_SEED_ON_START", raising=False)
    monkeypatch.delenv("JUNE_SEED_PASSWORD", raising=False)

    assert get_settings().seed_on_start is False


def test_sample_seeding_requires_an_explicit_password(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("JUNE_ENV", "development")
    monkeypatch.setenv("JUNE_SECRET_KEY", secrets.token_urlsafe(48))
    monkeypatch.setenv("JUNE_SEED_ON_START", "true")
    monkeypatch.delenv("JUNE_SEED_PASSWORD", raising=False)

    with pytest.raises(RuntimeError, match="JUNE_SEED_PASSWORD"):
        get_settings()


def test_production_rejects_sample_seeding(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("JUNE_ENV", "production")
    monkeypatch.setenv("JUNE_SECRET_KEY", secrets.token_urlsafe(48))
    monkeypatch.setenv("JUNE_COOKIE_SECURE", "true")
    monkeypatch.setenv("JUNE_SEED_ON_START", "true")
    monkeypatch.setenv("JUNE_SEED_PASSWORD", secrets.token_urlsafe(32))

    with pytest.raises(RuntimeError, match="JUNE_SEED_ON_START"):
        get_settings()
