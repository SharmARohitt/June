from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.core.constants import STAGE_LIBRARY
from app.core.database import get_db
from app.core.errors import not_found
from app.models import Automation, User, Workflow
from app.schemas.automation import WorkflowListItem, WorkflowOut, WorkflowSave, WorkflowValidate, WorkflowValidationResult
from app.services import workflow_service
from app.services.serializers import workflow_out

router = APIRouter(prefix="/workflows", tags=["Pipeline Studio"])


@router.get("/stage-library")
async def stage_library(user: User = Depends(require_permission("pipelines:read"))) -> list[dict]:
    return [
        {"key": key, "name": meta["name"], "description": meta["description"]}
        for key, meta in STAGE_LIBRARY.items()
    ]


@router.get("", response_model=list[WorkflowListItem])
async def list_workflows(
    automation_id: str | None = None,
    user: User = Depends(require_permission("pipelines:read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    query = select(Workflow).order_by(Workflow.updated_at.desc())
    if automation_id:
        query = query.where(Workflow.automation_id == automation_id)
    workflows = list((await db.execute(query)).scalars().all())
    automation_ids = {workflow.automation_id for workflow in workflows}
    automations = {
        automation.id: automation
        for automation in (
            await db.execute(select(Automation).where(Automation.id.in_(automation_ids)))
        )
        .scalars()
        .all()
    }
    payload = []
    for workflow in workflows:
        data = workflow_out(workflow)
        automation = automations.get(workflow.automation_id)
        data["automation_name"] = automation.name if automation else "Unknown"
        data["automation_slug"] = automation.slug if automation else ""
        data["automation_icon"] = automation.icon if automation else "workflow"
        payload.append(data)
    return payload


@router.get("/{workflow_id}", response_model=WorkflowOut)
async def get_workflow(
    workflow_id: str,
    user: User = Depends(require_permission("pipelines:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    workflow = await db.get(Workflow, workflow_id)
    if not workflow:
        raise not_found("Workflow")
    return workflow_out(workflow)


@router.post("/{workflow_id}/validate", response_model=WorkflowValidationResult)
async def validate_workflow(
    workflow_id: str,
    payload: WorkflowValidate,
    user: User = Depends(require_permission("pipelines:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if not await db.get(Workflow, workflow_id):
        raise not_found("Workflow")
    definition = payload.definition.model_dump()
    issues = workflow_service.validate_definition(definition, has_production=True)
    return {
        "valid": not any(issue["severity"] == "error" for issue in issues),
        "issues": issues,
        "checksum": workflow_service.definition_checksum(definition),
    }


@router.put("/{workflow_id}", response_model=WorkflowOut)
async def save_workflow(
    workflow_id: str,
    payload: WorkflowSave,
    user: User = Depends(require_permission("pipelines:write")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    workflow = await db.get(Workflow, workflow_id)
    if not workflow:
        raise not_found("Workflow")
    await workflow_service.save_draft(db, workflow, user, payload.name, payload.definition.model_dump())
    await db.refresh(workflow, attribute_names=["versions"])
    return workflow_out(workflow)


@router.post("/{workflow_id}/publish", response_model=WorkflowOut)
async def publish_workflow(
    workflow_id: str,
    user: User = Depends(require_permission("pipelines:write")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    workflow = await db.get(Workflow, workflow_id)
    if not workflow:
        raise not_found("Workflow")
    await workflow_service.publish(db, workflow, user)
    await db.refresh(workflow, attribute_names=["versions"])
    return workflow_out(workflow)
