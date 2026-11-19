from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.core.database import get_db
from app.models import User
from app.schemas.governance import IntegrationOut, IntegrationTestResult
from app.services import integration_service
from app.services.serializers import integration_out

router = APIRouter(prefix="/integrations", tags=["Integrations"])


@router.get("", response_model=list[IntegrationOut])
async def list_integrations(
    user: User = Depends(require_permission("integrations:read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    rows = await integration_service.list_integrations(db)
    return [integration_out(row) for row in rows]


@router.get("/{key}", response_model=IntegrationOut)
async def get_integration(
    key: str,
    user: User = Depends(require_permission("integrations:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return integration_out(await integration_service.get_integration(db, key))


@router.post("/{key}/test", response_model=IntegrationTestResult)
async def test_integration(
    key: str,
    user: User = Depends(require_permission("integrations:write")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await integration_service.test_integration(db, user, key)


@router.post("/refresh", response_model=list[IntegrationOut])
async def refresh_integrations(
    user: User = Depends(require_permission("integrations:write")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    await integration_service.ensure_integrations(db)
    rows = await integration_service.list_integrations(db)
    return [integration_out(row) for row in rows]
