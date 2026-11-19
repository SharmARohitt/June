"""Tamper-evident audit trail.

Every record is linked to the previous record with SHA-256. The application never
exposes update/delete paths for audit records. `verify_chain` recomputes the full
chain so tampering can be detected (Chronicle UI exposes this check).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import utcnow
from app.models import AuditEvent, User

_audit_lock = asyncio.Lock()
GENESIS_HASH = "0" * 64


def _digest(
    *,
    prev_hash: str,
    actor_label: str,
    action: str,
    resource_type: str,
    resource_id: str | None,
    outcome: str,
    details: dict,
    created_at: str,
) -> str:
    canonical = json.dumps(
        {
            "prev_hash": prev_hash,
            "actor": actor_label,
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "outcome": outcome,
            "details": details,
            "created_at": created_at,
        },
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def record(
    db: AsyncSession,
    *,
    actor: User | None,
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    outcome: str = "SUCCESS",
    details: dict[str, Any] | None = None,
    ip_address: str = "",
    actor_label: str | None = None,
) -> AuditEvent:
    async with _audit_lock:
        result = await db.execute(select(AuditEvent).order_by(AuditEvent.id.desc()).limit(1))
        last = result.scalar_one_or_none()
        prev_hash = last.hash if last else GENESIS_HASH
        created = utcnow()
        actor_label = actor_label or (actor.full_name if actor else "system")
        payload = details or {}
        event = AuditEvent(
            actor_id=actor.id if actor else None,
            actor_label=actor_label,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            outcome=outcome,
            details=payload,
            ip_address=ip_address,
            prev_hash=prev_hash,
            hash=_digest(
                prev_hash=prev_hash,
                actor_label=actor_label,
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                outcome=outcome,
                details=payload,
                created_at=created.isoformat(),
            ),
            created_at=created,
        )
        db.add(event)
        await db.flush()
        return event


async def verify_chain(db: AsyncSession, limit: int = 50_000) -> dict:
    result = await db.execute(select(AuditEvent).order_by(AuditEvent.id.asc()).limit(limit))
    events = list(result.scalars().all())
    expected_prev = GENESIS_HASH
    for event in events:
        if event.prev_hash != expected_prev:
            return {
                "valid": False,
                "checked_events": len(events),
                "first_invalid_event_id": event.id,
                "message": f"Chain break at event {event.id}: previous hash does not match.",
            }
        created = event.created_at.astimezone(UTC) if event.created_at.tzinfo else event.created_at.replace(tzinfo=UTC)
        recomputed = _digest(
            prev_hash=event.prev_hash,
            actor_label=event.actor_label,
            action=event.action,
            resource_type=event.resource_type,
            resource_id=event.resource_id,
            outcome=event.outcome,
            details=event.details or {},
            created_at=created.isoformat(),
        )
        if recomputed != event.hash:
            return {
                "valid": False,
                "checked_events": len(events),
                "first_invalid_event_id": event.id,
                "message": f"Chain break at event {event.id}: record hash mismatch.",
            }
        expected_prev = event.hash
    return {
        "valid": True,
        "checked_events": len(events),
        "first_invalid_event_id": None,
        "message": f"Verified {len(events)} audit records; hash chain is intact.",
    }


async def count_events(db: AsyncSession) -> int:
    from sqlalchemy import func

    return int((await db.execute(select(func.count(AuditEvent.id)))).scalar_one())


def utc_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat()
