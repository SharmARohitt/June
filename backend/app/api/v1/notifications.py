from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import authenticated_user
from app.core.database import get_db
from app.models import User
from app.schemas.common import Page
from app.schemas.governance import NotificationOut
from app.services import notification_service

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("", response_model=Page[NotificationOut])
async def list_notifications(
    unread_only: bool = False,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    user: User = Depends(authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    rows, total = await notification_service.list_for_user(
        db, user.id, unread_only=unread_only, page=page, page_size=page_size
    )
    return {
        "items": [notification_service.notification_out(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
    }


@router.get("/unread-count")
async def get_unread_count(
    user: User = Depends(authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return {"unread": await notification_service.unread_count(db, user.id)}


@router.post("/read-all")
async def read_all(
    user: User = Depends(authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    marked = await notification_service.mark_all_read(db, user.id)
    return {"marked": marked}


@router.post("/{notification_id}/read", response_model=NotificationOut)
async def read_notification(
    notification_id: str,
    user: User = Depends(authenticated_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    notification = await notification_service.mark_read(db, user.id, notification_id)
    return notification_service.notification_out(notification)
