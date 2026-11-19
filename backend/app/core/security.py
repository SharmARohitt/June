"""Password hashing, JWT issuance and CSRF primitives.

Passwords use stdlib scrypt with per-user salts (no external crypto dependency).
Every token carries a type claim so refresh tokens can never be used as access tokens.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import timedelta
from typing import Any

import jwt

from app.core.config import settings
from app.core.database import utcnow

_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_MAXMEM = 64 * 1024 * 1024

JWT_ALGORITHM = "HS256"

ACCESS_COOKIE = "june_access"
REFRESH_COOKIE = "june_refresh"
CSRF_COOKIE = "june_csrf"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, maxmem=_SCRYPT_MAXMEM
    )
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, n, r, p, salt_hex, digest_hex = encoded.split("$")
        if scheme != "scrypt":
            return False
        digest = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt_hex),
            n=int(n),
            r=int(r),
            p=int(p),
            maxmem=_SCRYPT_MAXMEM,
        )
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def _create_token(subject: str, token_type: str, expires_delta: timedelta, extra: dict[str, Any] | None = None) -> str:
    now = utcnow()
    payload: dict[str, Any] = {
        "sub": subject,
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
        "jti": secrets.token_urlsafe(16),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.secret_key, algorithm=JWT_ALGORITHM)


def create_access_token(user_id: str, role: str, token_version: int) -> str:
    return _create_token(
        user_id,
        "access",
        timedelta(minutes=settings.access_token_minutes),
        {"role": role, "ver": token_version},
    )


def create_refresh_token(user_id: str) -> str:
    return _create_token(user_id, "refresh", timedelta(days=settings.refresh_token_days))


def decode_token(token: str, expected_type: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("expired", "Your session has expired.") from exc
    except jwt.InvalidTokenError as exc:
        raise TokenError("invalid", "Invalid session token.") from exc
    if payload.get("type") != expected_type:
        raise TokenError("invalid_type", "Invalid token type.")
    return payload


class TokenError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def tokens_match(candidate: str | None, expected: str | None) -> bool:
    if not candidate or not expected:
        return False
    return hmac.compare_digest(candidate, expected)


def generate_agent_token() -> str:
    return f"june_agent_{secrets.token_urlsafe(32)}"
