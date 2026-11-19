from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.core.database import get_db
from app.models import User
from app.schemas.common import SystemHealth
from app.services import system_service

router = APIRouter(prefix="/system", tags=["System"])


@router.get("/health", response_model=SystemHealth)
async def system_health(
    user: User = Depends(require_permission("analytics:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await system_service.system_health(db)


@router.get("/info")
async def system_info(
    user: User = Depends(require_permission("admin:settings")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await system_service.system_summary(db)
