from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.core.constants import RUNNER_TEMPLATES
from app.core.database import get_db
from app.models import User
from app.schemas.automation import (
    AutomationCreate,
    AutomationDetail,
    AutomationSummary,
    AutomationUpdate,
    RunnerTemplateOut,
    VersionOut,
)
from app.schemas.common import Page
from app.services import automation_service
from app.services.serializers import automation_detail, version_out

router = APIRouter(prefix="/automations", tags=["Automation Registry"])


@router.get("", response_model=Page[AutomationSummary])
async def list_automations(
    q: str | None = None,
    category: str | None = None,
    environment: str | None = None,
    tag: str | None = None,
    status_filter: str = Query(default="ACTIVE", alias="status"),
    owner: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=24, ge=1, le=100),
    user: User = Depends(require_permission("automations:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    items, total = await automation_service.list_automations(
        db,
        q=q,
        category=category,
        environment=environment,
        tag=tag,
        status=status_filter,
        owner=owner,
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


@router.get("/runner-templates", response_model=list[RunnerTemplateOut])
async def runner_templates(user: User = Depends(require_permission("automations:read"))) -> list[dict]:
    return [
        {
            "key": key,
            "name": template["name"],
            "category": template["category"],
            "summary": template["summary"],
            "params_schema": template["params_schema"],
        }
        for key, template in RUNNER_TEMPLATES.items()
    ]


@router.post("/validate-manifest")
async def validate_manifest(
    payload: dict,
    user: User = Depends(require_permission("automations:write")),
) -> dict:
    return automation_service.manifest_preview(payload)


@router.post("", response_model=AutomationDetail, status_code=status.HTTP_201_CREATED)
async def create_automation(
    payload: AutomationCreate,
    user: User = Depends(require_permission("automations:write")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    automation = await automation_service.create_automation(db, user, payload)
    return await automation_service.detail(db, automation.id)


@router.get("/{automation_id}", response_model=AutomationDetail)
async def get_automation(
    automation_id: str,
    user: User = Depends(require_permission("automations:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await automation_service.detail(db, automation_id)


@router.patch("/{automation_id}", response_model=AutomationDetail)
async def update_automation(
    automation_id: str,
    payload: AutomationUpdate,
    user: User = Depends(require_permission("automations:write")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await automation_service.update_automation(db, user, automation_id, payload)
    return await automation_service.detail(db, automation_id)


@router.post("/{automation_id}/archive", response_model=AutomationDetail)
async def archive_automation(
    automation_id: str,
    user: User = Depends(require_permission("automations:archive")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await automation_service.archive_automation(db, user, automation_id)
    return await automation_service.detail(db, automation_id)


@router.get("/{automation_id}/versions", response_model=list[VersionOut])
async def list_versions(
    automation_id: str,
    user: User = Depends(require_permission("automations:read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    return await automation_service.versions(db, automation_id)


@router.post("/{automation_id}/versions", response_model=VersionOut, status_code=201)
async def publish_version(
    automation_id: str,
    payload: dict,
    user: User = Depends(require_permission("automations:write")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    version = await automation_service.publish_version(
        db,
        user,
        automation_id,
        version=payload.get("version", ""),
        changelog=payload.get("changelog", ""),
        manifest_overrides=payload.get("manifest_overrides"),
    )
    return version_out(version)
