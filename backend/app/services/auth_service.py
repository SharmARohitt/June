"""Authentication, session lifecycle and user administration."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import utcnow
from app.core.errors import conflict, forbidden, invalid, not_found, unauthorized
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    generate_csrf_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.models import AuthSession, Role, Team, User
from app.services import audit_service

_FAILED_ATTEMPTS: dict[str, deque[float]] = defaultdict(deque)
_WINDOW_SECONDS = 600
_MAX_ATTEMPTS = 8


def _check_rate_limit(key: str) -> None:
    now = time.monotonic()
    attempts = _FAILED_ATTEMPTS[key]
    while attempts and attempts[0] < now - _WINDOW_SECONDS:
        attempts.popleft()
    if len(attempts) >= _MAX_ATTEMPTS:
        raise conflict("Too many failed sign-in attempts. Try again in a few minutes.")


def _register_failure(key: str) -> None:
    _FAILED_ATTEMPTS[key].append(time.monotonic())


def serialize_user(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "title": user.title,
        "is_active": user.is_active,
        "preferences": user.preferences or {},
        "last_login_at": user.last_login_at,
        "created_at": user.created_at,
        "role": {
            "id": user.role.id,
            "key": user.role.key,
            "name": user.role.name,
            "description": user.role.description,
        },
        "team": {"id": user.team.id, "name": user.team.name, "slug": user.team.slug} if user.team else None,
        "permissions": sorted(user.permissions),
    }


async def _issue_session(
    db: AsyncSession,
    user: User,
    *,
    ip_address: str,
    user_agent: str,
) -> tuple[str, str, str]:
    refresh_token = create_refresh_token(user.id)
    db.add(
        AuthSession(
            user_id=user.id,
            token_hash=hash_token(refresh_token),
            user_agent=user_agent[:300],
            ip_address=ip_address[:60],
            expires_at=utcnow() + timedelta(days=settings.refresh_token_days),
            created_at=utcnow(),
        )
    )
    access_token = create_access_token(user.id, user.role.key, user.token_version)
    return access_token, refresh_token, generate_csrf_token()


async def login(
    db: AsyncSession,
    *,
    email: str,
    password: str,
    ip_address: str,
    user_agent: str,
) -> tuple[User, str, str, str]:
    rate_key = f"{ip_address}:{email.lower()}"
    _check_rate_limit(rate_key)
    result = await db.execute(select(User).where(func.lower(User.email) == email.lower()))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(password, user.password_hash):
        _register_failure(rate_key)
        await audit_service.record(
            db,
            actor=None,
            actor_label=email.lower(),
            action="auth.login_failed",
            resource_type="session",
            outcome="DENIED",
            details={"reason": "invalid_credentials"},
            ip_address=ip_address,
        )
        await db.commit()
        raise unauthorized("Email or password is incorrect.", code="invalid_credentials")
    if not user.is_active:
        await audit_service.record(
            db,
            actor=user,
            action="auth.login_failed",
            resource_type="session",
            outcome="DENIED",
            details={"reason": "inactive_account"},
            ip_address=ip_address,
        )
        await db.commit()
        raise forbidden("This account is disabled. Contact a platform administrator.")

    _FAILED_ATTEMPTS.pop(rate_key, None)
    user.last_login_at = utcnow()
    access, refresh, csrf = await _issue_session(db, user, ip_address=ip_address, user_agent=user_agent)
    await audit_service.record(
        db,
        actor=user,
        action="auth.login",
        resource_type="session",
        resource_id=user.id,
        details={"role": user.role.key},
        ip_address=ip_address,
    )
    await db.commit()
    return user, access, refresh, csrf


async def refresh(
    db: AsyncSession,
    *,
    refresh_token: str,
    ip_address: str,
    user_agent: str,
) -> tuple[User, str, str, str]:
    try:
        payload = decode_token(refresh_token, "refresh")
    except Exception as exc:
        raise invalid("Your session could not be refreshed. Sign in again.") from exc
    token_hash = hash_token(refresh_token)
    result = await db.execute(select(AuthSession).where(AuthSession.token_hash == token_hash))
    stored = result.scalar_one_or_none()
    now = utcnow()
    if not stored or stored.revoked_at is not None or stored.expires_at < now:
        raise invalid("Your session has ended. Sign in again.")
    user = await db.get(User, payload.get("sub"))
    if not user or not user.is_active:
        raise invalid("This account is not available.")
    if int(payload.get("ver", -1)) != user.token_version:
        raise invalid("Your session was revoked. Sign in again.")
    stored.revoked_at = now
    stored.last_used_at = now
    access, new_refresh, csrf = await _issue_session(db, user, ip_address=ip_address, user_agent=user_agent)
    await db.commit()
    return user, access, new_refresh, csrf


async def logout(db: AsyncSession, *, refresh_token: str | None, user: User | None, ip_address: str) -> None:
    if refresh_token:
        result = await db.execute(select(AuthSession).where(AuthSession.token_hash == hash_token(refresh_token)))
        stored = result.scalar_one_or_none()
        if stored and stored.revoked_at is None:
            stored.revoked_at = utcnow()
    if user:
        await audit_service.record(
            db,
            actor=user,
            action="auth.logout",
            resource_type="session",
            resource_id=user.id,
            ip_address=ip_address,
        )
    await db.commit()


async def update_preferences(db: AsyncSession, user: User, changes: dict) -> User:
    preferences = dict(user.preferences or {})
    for key, value in changes.items():
        if value is not None:
            preferences[key] = value
    user.preferences = preferences
    await audit_service.record(
        db,
        actor=user,
        action="user.preferences_updated",
        resource_type="user",
        resource_id=user.id,
        details={"changed": list(changes.keys())},
    )
    await db.commit()
    return user


async def list_users(db: AsyncSession) -> list[User]:
    result = await db.execute(select(User).order_by(User.full_name))
    return list(result.scalars().all())


async def list_roles(db: AsyncSession) -> list[Role]:
    result = await db.execute(select(Role).order_by(Role.name))
    return list(result.scalars().all())


async def list_teams(db: AsyncSession) -> list[Team]:
    result = await db.execute(select(Team).order_by(Team.name))
    return list(result.scalars().all())


async def create_user(db: AsyncSession, actor: User, payload) -> User:
    existing = await db.execute(select(User).where(func.lower(User.email) == payload.email.lower()))
    if existing.scalar_one_or_none():
        raise conflict("A user with this email already exists.")
    role = (await db.execute(select(Role).where(Role.key == payload.role_key))).scalar_one_or_none()
    if not role:
        raise invalid("Unknown role.")
    user = User(
        email=payload.email.lower(),
        full_name=payload.full_name,
        title=payload.title,
        password_hash=hash_password(payload.password),
        role_id=role.id,
        team_id=payload.team_id,
        is_active=True,
        preferences={"beginner_mode": True},
    )
    db.add(user)
    await db.flush()
    await audit_service.record(
        db,
        actor=actor,
        action="admin.user_created",
        resource_type="user",
        resource_id=user.id,
        details={"email": user.email, "role": role.key},
    )
    await db.commit()
    await db.refresh(user)
    return user


async def update_user(db: AsyncSession, actor: User, user_id: str, payload) -> User:
    user = await db.get(User, user_id)
    if not user:
        raise not_found("User")
    changes: dict = {}
    if payload.role_key and payload.role_key != user.role.key:
        if user.id == actor.id:
            raise forbidden("You cannot change your own role.")
        role = (await db.execute(select(Role).where(Role.key == payload.role_key))).scalar_one_or_none()
        if not role:
            raise invalid("Unknown role.")
        if user.role.key == "SUPER_ADMIN":
            count = int(
                (
                    await db.execute(
                        select(func.count(User.id)).where(
                            User.role.has(key="SUPER_ADMIN"), User.is_active.is_(True)
                        )
                    )
                ).scalar_one()
            )
            if count <= 1:
                raise conflict("At least one active Super Administrator must remain.")
        user.role_id = role.id
        user.token_version += 1
        changes["role"] = role.key
    if payload.password:
        user.password_hash = hash_password(payload.password)
        user.token_version += 1
        changes["password"] = "rotated"
    if payload.is_active is not None and payload.is_active != user.is_active:
        if user.id == actor.id and not payload.is_active:
            raise forbidden("You cannot deactivate your own account.")
        if not payload.is_active and user.role.key == "SUPER_ADMIN":
            count = int(
                (
                    await db.execute(
                        select(func.count(User.id)).where(
                            User.role.has(key="SUPER_ADMIN"), User.is_active.is_(True)
                        )
                    )
                ).scalar_one()
            )
            if count <= 1:
                raise conflict("At least one active Super Administrator must remain.")
        user.is_active = payload.is_active
        if not payload.is_active:
            user.token_version += 1
        changes["is_active"] = payload.is_active
    if payload.full_name:
        user.full_name = payload.full_name
        changes["full_name"] = payload.full_name
    if payload.title is not None:
        user.title = payload.title
        changes["title"] = payload.title
    if payload.team_id is not None:
        user.team_id = payload.team_id or None
        changes["team_id"] = payload.team_id
    await audit_service.record(
        db,
        actor=actor,
        action="admin.user_updated",
        resource_type="user",
        resource_id=user.id,
        details={"changed": changes},
    )
    await db.commit()
    await db.refresh(user)
    return user
