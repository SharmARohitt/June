"""Authentication dependencies, RBAC guards and request helpers."""

from __future__ import annotations

from collections.abc import Callable

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.errors import JuneError, forbidden
from app.core.security import ACCESS_COOKIE, TokenError, decode_token
from app.models import Role, User


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _extract_access_token(request: Request) -> str | None:
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()
    return request.cookies.get(ACCESS_COOKIE)


async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    token = _extract_access_token(request)
    if not token:
        raise JuneError(401, "unauthenticated", "Sign in to continue.")
    try:
        payload = decode_token(token, "access")
    except TokenError as exc:
        raise JuneError(401, exc.code if exc.code == "expired" else "unauthenticated", exc.message) from exc

    user = await db.get(User, payload.get("sub"))
    if not user or not user.is_active:
        raise JuneError(401, "unauthenticated", "This account is not active.")
    if int(payload.get("ver", -1)) != user.token_version:
        raise JuneError(401, "session_revoked", "Your session was revoked. Sign in again.")
    return user


def has_permission(user: User, permission: str) -> bool:
    return permission in user.permissions


def require_permission(permission: str) -> Callable:
    async def guard(user: User = Depends(get_current_user)) -> User:
        if permission not in user.permissions:
            raise forbidden(
                "Your role does not include this capability.",
                {"required_permission": permission, "role": user.role.key},
            )
        return user

    return guard


def require_any_permission(*permissions: str) -> Callable:
    async def guard(user: User = Depends(get_current_user)) -> User:
        if not any(permission in user.permissions for permission in permissions):
            raise forbidden(
                "Your role does not include this capability.",
                {"required_permissions": list(permissions), "role": user.role.key},
            )
        return user

    return guard


async def authenticated_user(user: User = Depends(get_current_user)) -> User:
    return user


async def users_with_permission(db: AsyncSession, permission: str) -> list[User]:
    from app.core.constants import ROLE_PERMISSIONS

    role_keys = [key for key, perms in ROLE_PERMISSIONS.items() if permission in perms]
    result = await db.execute(
        select(User).where(User.is_active.is_(True), User.role.has(Role.key.in_(role_keys)))
    )
    return list(result.scalars().all())
