"""User notifications and targeted broadcasts."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import utcnow
from app.core.errors import not_found
from app.models import Notification


async def notify(
    db: AsyncSession,
    user_id: str,
    *,
    kind: str,
    title: str,
    body: str,
    resource_type: str | None = None,
    resource_id: str | None = None,
) -> Notification:
    notification = Notification(
        user_id=user_id,
        kind=kind,
        title=title,
        body=body,
        resource_type=resource_type,
        resource_id=resource_id,
        created_at=utcnow(),
    )
    db.add(notification)
    await db.flush()
    return notification


async def notify_many(
    db: AsyncSession,
    user_ids: list[str],
    *,
    kind: str,
    title: str,
    body: str,
    resource_type: str | None = None,
    resource_id: str | None = None,
) -> None:
    for user_id in dict.fromkeys(user_ids):
        await notify(
            db,
            user_id,
            kind=kind,
            title=title,
            body=body,
            resource_type=resource_type,
            resource_id=resource_id,
        )


def notification_out(notification: Notification) -> dict:
    return {
        "id": notification.id,
        "kind": notification.kind,
        "title": notification.title,
        "body": notification.body,
        "resource_type": notification.resource_type,
        "resource_id": notification.resource_id,
        "read_at": notification.read_at,
        "created_at": notification.created_at,
    }


async def list_for_user(
    db: AsyncSession, user_id: str, *, unread_only: bool = False, page: int = 1, page_size: int = 25
) -> tuple[list[Notification], int]:
    conditions = [Notification.user_id == user_id]
    if unread_only:
        conditions.append(Notification.read_at.is_(None))
    total = int(
        (await db.execute(select(func.count(Notification.id)).where(*conditions))).scalar_one()
    )
    rows = list(
        (
            await db.execute(
                select(Notification)
                .where(*conditions)
                .order_by(Notification.created_at.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        .scalars()
        .all()
    )
    return rows, total


async def unread_count(db: AsyncSession, user_id: str) -> int:
    return int(
        (
            await db.execute(
                select(func.count(Notification.id)).where(
                    Notification.user_id == user_id, Notification.read_at.is_(None)
                )
            )
        ).scalar_one()
    )


async def mark_read(db: AsyncSession, user_id: str, notification_id: str) -> Notification:
    notification = await db.get(Notification, notification_id)
    if not notification or notification.user_id != user_id:
        raise not_found("Notification")
    if notification.read_at is None:
        notification.read_at = utcnow()
        await db.commit()
    return notification


async def mark_all_read(db: AsyncSession, user_id: str) -> int:
    rows, _total = await list_for_user(db, user_id, unread_only=True, page=1, page_size=1000)
    now = utcnow()
    for notification in rows:
        notification.read_at = now
    await db.commit()
    return len(rows)
