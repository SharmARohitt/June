"""Test harness: real ASGI app, real seeded SQLite database, real cookies."""

from __future__ import annotations

import os
import secrets
import tempfile
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

ROOT = Path(tempfile.mkdtemp(prefix="june-tests-"))
os.environ.update(
    {
        "JUNE_ENV": "test",
        "JUNE_DEBUG": "false",
        "JUNE_DATABASE_URL": f"sqlite+aiosqlite:///{(ROOT / 'test.db').as_posix()}",
        "JUNE_AUTO_CREATE_TABLES": "true",
        "JUNE_SEED_ON_START": "false",
        "JUNE_SANDBOX_DIR": str(ROOT / "sandboxes"),
        "JUNE_STORAGE_DIR": str(ROOT / "storage"),
        "JUNE_SECRET_KEY": secrets.token_urlsafe(32),
        "JUNE_COOKIE_SECURE": "false",
        "JUNE_FRONTEND_ORIGIN": "http://localhost:3000",
    }
)

from app.core.database import SessionLocal, init_models  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed_if_empty  # noqa: E402

_state = {"ready": False}
TEST_PASSWORD = secrets.token_urlsafe(32)


@pytest.fixture(scope="session")
async def prepared_database():
    if not _state["ready"]:
        await init_models()
        async with SessionLocal() as db:
            await seed_if_empty(db, TEST_PASSWORD)
        _state["ready"] = True
    return True


@pytest.fixture
async def client(prepared_database):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as session:
        yield session


async def login(client: AsyncClient, email: str, password: str = TEST_PASSWORD) -> dict:
    response = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )
    assert response.status_code == 200, response.text
    return response.json()


def csrf(client: AsyncClient) -> str:
    token = client.cookies.get("june_csrf")
    assert token, "CSRF cookie missing after login"
    return token


async def post(client: AsyncClient, url: str, payload: dict | None = None):
    return await client.post(url, json=payload, headers={"X-CSRF-Token": csrf(client)})


async def patch(client: AsyncClient, url: str, payload: dict):
    return await client.patch(url, json=payload, headers={"X-CSRF-Token": csrf(client)})
