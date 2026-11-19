from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import client_ip, get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.errors import JuneError
from app.core.security import ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE
from app.models import User
from app.schemas.auth import LoginRequest, PreferencesUpdate, SessionResponse
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["Authentication"])


def _set_session_cookies(response: Response, access: str, refresh: str, csrf: str) -> None:
    common = {
        "path": "/",
        "secure": settings.cookie_secure,
        "samesite": "lax",
        "domain": settings.cookie_domain,
    }
    response.set_cookie(ACCESS_COOKIE, access, max_age=settings.access_token_minutes * 60, httponly=True, **common)
    response.set_cookie(REFRESH_COOKIE, refresh, max_age=settings.refresh_token_days * 86400, httponly=True, **common)
    response.set_cookie(CSRF_COOKIE, csrf, max_age=settings.refresh_token_days * 86400, httponly=False, **common)


def _clear_session_cookies(response: Response) -> None:
    for name in (ACCESS_COOKIE, REFRESH_COOKIE, CSRF_COOKIE):
        response.delete_cookie(name, path="/", domain=settings.cookie_domain)


@router.post("/login", response_model=SessionResponse)
async def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> dict:
    user, access, refresh, csrf = await auth_service.login(
        db,
        email=payload.email,
        password=payload.password,
        ip_address=client_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )
    _set_session_cookies(response, access, refresh, csrf)
    return {
        "user": auth_service.serialize_user(user),
        "csrf_token": csrf,
        "expires_in": settings.access_token_minutes * 60,
    }


@router.post("/refresh", response_model=SessionResponse)
async def refresh(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> dict:
    token = request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise JuneError(401, "unauthenticated", "No refresh session is available.")
    user, access, new_refresh, csrf = await auth_service.refresh(
        db,
        refresh_token=token,
        ip_address=client_ip(request),
        user_agent=request.headers.get("user-agent", ""),
    )
    _set_session_cookies(response, access, new_refresh, csrf)
    return {
        "user": auth_service.serialize_user(user),
        "csrf_token": csrf,
        "expires_in": settings.access_token_minutes * 60,
    }


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> dict:
    user = None
    try:
        user = await get_current_user(request, db)
    except JuneError:
        user = None
    await auth_service.logout(
        db,
        refresh_token=request.cookies.get(REFRESH_COOKIE),
        user=user,
        ip_address=client_ip(request),
    )
    _clear_session_cookies(response)
    return {"message": "Signed out."}


@router.get("/me")
async def me(user: User = Depends(get_current_user)) -> dict:
    return {"user": auth_service.serialize_user(user)}


@router.patch("/me/preferences")
async def update_preferences(
    payload: PreferencesUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    updated = await auth_service.update_preferences(db, user, payload.model_dump(exclude_none=True))
    return {"user": auth_service.serialize_user(updated)}
