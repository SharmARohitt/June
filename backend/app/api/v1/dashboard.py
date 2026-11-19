from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.core.database import get_db
from app.models import User
from app.schemas.governance import AnalyticsOverview, DashboardOverview, PulseSnapshot
from app.services import analytics_service

router = APIRouter(tags=["Command Center"])


@router.get("/dashboard/overview", response_model=DashboardOverview)
async def dashboard_overview(
    days: int = Query(default=7, ge=1, le=90),
    user: User = Depends(require_permission("analytics:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await analytics_service.dashboard_overview(db, days=days)


@router.get("/pulse", response_model=PulseSnapshot)
async def pulse(
    user: User = Depends(require_permission("analytics:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await analytics_service.pulse_snapshot(db)


@router.get("/analytics/overview", response_model=AnalyticsOverview)
async def analytics_overview(
    days: int = Query(default=30, ge=1, le=180),
    user: User = Depends(require_permission("analytics:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await analytics_service.analytics_overview(db, days=days)


@router.get("/analytics/executions")
async def analytics_executions(
    days: int = Query(default=30, ge=1, le=180),
    user: User = Depends(require_permission("analytics:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    data = await analytics_service.analytics_overview(db, days=days)
    return {
        "range_days": data["range_days"],
        "total_executions": data["total_executions"],
        "success_rate": data["success_rate"],
        "avg_duration_ms": data["avg_duration_ms"],
        "by_day": data["by_day"],
        "by_automation": data["by_automation"],
        "by_environment": data["by_environment"],
    }


@router.get("/analytics/failures")
async def analytics_failures(
    days: int = Query(default=30, ge=1, le=180),
    user: User = Depends(require_permission("analytics:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    data = await analytics_service.analytics_overview(db, days=days)
    return {
        "range_days": data["range_days"],
        "failures": data["failures"],
        "total_executions": data["total_executions"],
        "success_rate": data["success_rate"],
    }
