from __future__ import annotations

import csv
import io
import json
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.core.database import get_db
from app.models import AuditEvent, User
from app.schemas.common import Page
from app.schemas.governance import AuditEventOut, AuditIntegrityOut
from app.services import audit_service
from app.services.serializers import audit_out

router = APIRouter(prefix="/audit-events", tags=["Chronicle"])


def _filters(
    *,
    action: str | None,
    resource_type: str | None,
    resource_id: str | None,
    actor: str | None,
    outcome: str | None,
    q: str | None,
    date_from: datetime | None,
    date_to: datetime | None,
) -> list:
    clauses = []
    if action:
        clauses.append(AuditEvent.action == action)
    if resource_type:
        clauses.append(AuditEvent.resource_type == resource_type)
    if resource_id:
        clauses.append(AuditEvent.resource_id == resource_id)
    if actor:
        clauses.append(AuditEvent.actor_id == actor)
    if outcome:
        clauses.append(AuditEvent.outcome == outcome)
    if date_from:
        clauses.append(AuditEvent.created_at >= date_from)
    if date_to:
        clauses.append(AuditEvent.created_at <= date_to)
    if q:
        needle = f"%{q.strip()}%"
        clauses.append(
            or_(
                AuditEvent.actor_label.ilike(needle),
                AuditEvent.action.ilike(needle),
                AuditEvent.resource_type.ilike(needle),
                AuditEvent.resource_id.ilike(needle),
            )
        )
    return clauses


@router.get("", response_model=Page[AuditEventOut])
async def list_audit_events(
    action: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    actor: str | None = None,
    outcome: str | None = None,
    q: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user: User = Depends(require_permission("audit:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    clauses = _filters(
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        actor=actor,
        outcome=outcome,
        q=q,
        date_from=date_from,
        date_to=date_to,
    )
    base = select(AuditEvent)
    for clause in clauses:
        base = base.where(clause)
    total = int(
        (await db.execute(select(func.count(AuditEvent.id)).where(*clauses))).scalar_one()
    )
    rows = list(
        (
            await db.execute(
                base.order_by(AuditEvent.id.desc()).offset((page - 1) * page_size).limit(page_size)
            )
        )
        .scalars()
        .all()
    )
    return {
        "items": [audit_out(event) for event in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
    }


@router.get("/actions")
async def audit_actions(
    user: User = Depends(require_permission("audit:read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    rows = (
        await db.execute(
            select(AuditEvent.action, AuditEvent.resource_type, func.count(AuditEvent.id))
            .group_by(AuditEvent.action, AuditEvent.resource_type)
            .order_by(AuditEvent.action)
        )
    ).all()
    return [
        {"action": action, "resource_type": resource_type, "count": int(count)}
        for action, resource_type, count in rows
    ]


@router.get("/integrity", response_model=AuditIntegrityOut)
async def verify_integrity(
    user: User = Depends(require_permission("audit:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await audit_service.verify_chain(db)


@router.get("/export")
async def export_audit_events(
    format: str = Query(default="json", pattern="^(json|csv)$"),
    action: str | None = None,
    resource_type: str | None = None,
    actor: str | None = None,
    outcome: str | None = None,
    q: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    user: User = Depends(require_permission("audit:read")),
    db: AsyncSession = Depends(get_db),
) -> Response:
    clauses = _filters(
        action=action,
        resource_type=resource_type,
        resource_id=None,
        actor=actor,
        outcome=outcome,
        q=q,
        date_from=date_from,
        date_to=date_to,
    )
    query = select(AuditEvent).order_by(AuditEvent.id.desc()).limit(10_000)
    for clause in clauses:
        query = query.where(clause)
    events = list((await db.execute(query)).scalars().all())
    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    if format == "csv":
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(["id", "created_at", "actor", "action", "resource_type", "resource_id", "outcome", "hash", "prev_hash"])
        for event in events:
            writer.writerow(
                [
                    event.id,
                    event.created_at.isoformat(),
                    event.actor_label,
                    event.action,
                    event.resource_type,
                    event.resource_id or "",
                    event.outcome,
                    event.hash,
                    event.prev_hash,
                ]
            )
        return Response(
            content=buffer.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="june-audit-{stamp}.csv"'},
        )
    payload = {
        "exported_at": datetime.utcnow().isoformat(),
        "exported_by": user.email,
        "record_count": len(events),
        "chain_integrity": await audit_service.verify_chain(db),
        "events": [audit_out(event) for event in events],
    }
    return Response(
        content=json.dumps(payload, default=str, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="june-audit-{stamp}.json"'},
    )
