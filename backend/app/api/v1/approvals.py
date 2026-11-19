from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.core.database import get_db
from app.models import User
from app.schemas.common import Page
from app.schemas.governance import ApprovalDecision, ApprovalOut
from app.services import approval_service

router = APIRouter(prefix="/approvals", tags=["Approval Center"])


@router.get("", response_model=Page[ApprovalOut])
async def list_approvals(
    status_filter: str | None = Query(default="PENDING", alias="status"),
    environment: str | None = None,
    mine: bool = False,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    user: User = Depends(require_permission("approvals:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    items, total = await approval_service.list_approvals(
        db,
        status=status_filter,
        environment=environment,
        mine=mine,
        user=user,
        page=page,
        page_size=page_size,
    )
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
    }


@router.get("/{approval_id}", response_model=ApprovalOut)
async def get_approval(
    approval_id: str,
    user: User = Depends(require_permission("approvals:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    approval = await approval_service.get_approval(db, approval_id)
    return approval_service.approval_summary(approval)


@router.post("/{approval_id}/approve", response_model=ApprovalOut)
async def approve(
    approval_id: str,
    payload: ApprovalDecision,
    user: User = Depends(require_permission("approvals:decide")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    approval = await approval_service.approve(
        db, user, approval_id, comment=payload.comment, reason=payload.reason
    )
    return approval_service.approval_summary(approval)


@router.post("/{approval_id}/reject", response_model=ApprovalOut)
async def reject(
    approval_id: str,
    payload: ApprovalDecision,
    user: User = Depends(require_permission("approvals:decide")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    approval = await approval_service.reject(
        db, user, approval_id, comment=payload.comment, reason=payload.reason
    )
    return approval_service.approval_summary(approval)
