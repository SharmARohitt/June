from __future__ import annotations

import asyncio
import json
from pathlib import Path

from fastapi import APIRouter, Depends, Query, Request, Response, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.core.config import settings
from app.core.database import SessionLocal, get_db
from app.core.errors import not_found
from app.core.events import event_bus
from app.models import Artifact, User
from app.schemas.common import Page
from app.schemas.execution import (
    ArtifactOut,
    CancelRequest,
    ExecutionCreate,
    ExecutionDetail,
    ExecutionInsight,
    ExecutionLogOut,
    ExecutionPreflightRequest,
    ExecutionSummary,
    PreflightOut,
    StageOut,
)
from app.services import execution_service
from app.services.serializers import execution_detail

router = APIRouter(prefix="/executions", tags=["Execution Center"])


@router.get("", response_model=Page[ExecutionSummary])
async def list_executions(
    status_filter: str | None = Query(default=None, alias="status"),
    environment: str | None = None,
    automation_id: str | None = None,
    requested_by: str | None = None,
    q: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    user: User = Depends(require_permission("executions:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if status_filter == "ACTIVE":
        items = []
        total = 0
        for active_status in ("QUEUED", "RUNNING", "WAITING_FOR_APPROVAL"):
            batch, _count = await execution_service.list_executions(
                db,
                status=active_status,
                environment=environment,
                automation_id=automation_id,
                requested_by=requested_by,
                q=q,
                page=1,
                page_size=page_size,
            )
            items.extend(batch)
        items.sort(key=lambda item: item["created_at"], reverse=True)
        items = items[:page_size]
        total = len(items)
    elif status_filter in {"FAILED", "BLOCKED", "TIMED_OUT"} and status_filter == "FAILED":
        combined = []
        for failed_status in ("FAILED", "BLOCKED", "TIMED_OUT"):
            batch, _count = await execution_service.list_executions(
                db,
                status=failed_status,
                environment=environment,
                automation_id=automation_id,
                requested_by=requested_by,
                q=q,
                page=1,
                page_size=page_size,
            )
            combined.extend(batch)
        combined.sort(key=lambda item: item["created_at"], reverse=True)
        items = combined[:page_size]
        total = len(items)
    else:
        items, total = await execution_service.list_executions(
            db,
            status=status_filter,
            environment=environment,
            automation_id=automation_id,
            requested_by=requested_by,
            q=q,
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


@router.post("/preflight", response_model=PreflightOut)
async def preflight(
    payload: ExecutionPreflightRequest,
    user: User = Depends(require_permission("executions:create")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await execution_service.preflight(
        db,
        user,
        automation_id=payload.automation_id,
        environment_id=payload.environment_id,
        server_group_id=payload.server_group_id,
        params=payload.params,
    )


@router.post("", response_model=ExecutionDetail, status_code=status.HTTP_201_CREATED)
async def create_execution(
    payload: ExecutionCreate,
    response: Response,
    user: User = Depends(require_permission("executions:create")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        execution = await execution_service.submit_execution(db, user, payload)
    except execution_service.DuplicateExecution as duplicate:
        response.status_code = status.HTTP_200_OK
        return execution_detail(duplicate.execution)
    return execution_detail(execution)


@router.get("/{execution_id}", response_model=ExecutionDetail)
async def get_execution(
    execution_id: str,
    user: User = Depends(require_permission("executions:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    execution = await execution_service.get_execution(db, execution_id)
    await db.refresh(execution)
    return execution_detail(execution)


@router.get("/{execution_id}/logs", response_model=list[ExecutionLogOut])
async def get_logs(
    execution_id: str,
    after_id: int = 0,
    limit: int = Query(default=1000, ge=1, le=5000),
    user: User = Depends(require_permission("executions:read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    return await execution_service.logs(db, execution_id, after_id=after_id, limit=limit)


@router.get("/{execution_id}/stages", response_model=list[StageOut])
async def get_stages(
    execution_id: str,
    user: User = Depends(require_permission("executions:read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    execution = await execution_service.get_execution(db, execution_id)
    return [
        {
            "id": stage.id,
            "key": stage.key,
            "name": stage.name,
            "description": stage.description,
            "order_index": stage.order_index,
            "status": stage.status,
            "attempt": stage.attempt,
            "started_at": stage.started_at,
            "finished_at": stage.finished_at,
            "duration_ms": stage.duration_ms,
            "output": stage.output or {},
            "error_message": stage.error_message,
        }
        for stage in execution.stages
    ]


@router.get("/{execution_id}/events", response_model=list[ExecutionLogOut])
async def get_events(
    execution_id: str,
    after_id: int = 0,
    user: User = Depends(require_permission("executions:read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    return await execution_service.logs(db, execution_id, after_id=after_id, limit=5000)


@router.get("/{execution_id}/insight", response_model=ExecutionInsight)
async def get_insight(
    execution_id: str,
    user: User = Depends(require_permission("executions:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    execution = await execution_service.get_execution(db, execution_id)
    return execution_service.insight(execution)


@router.post("/{execution_id}/cancel", response_model=ExecutionDetail)
async def cancel_execution(
    execution_id: str,
    payload: CancelRequest,
    user: User = Depends(require_permission("executions:cancel")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    execution = await execution_service.cancel_execution(db, user, execution_id, payload.reason)
    await db.refresh(execution)
    return execution_detail(execution)


@router.get("/{execution_id}/artifacts", response_model=list[ArtifactOut])
async def list_artifacts(
    execution_id: str,
    user: User = Depends(require_permission("executions:read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    return await execution_service.artifacts(db, execution_id)


@router.get("/{execution_id}/artifacts/{artifact_id}/download")
async def download_artifact(
    execution_id: str,
    artifact_id: str,
    user: User = Depends(require_permission("executions:read")),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    artifact = await db.get(Artifact, artifact_id)
    if not artifact or artifact.execution_id != execution_id:
        raise not_found("Artifact")
    storage_root = settings.storage_path.resolve()
    path = (Path(settings.storage_path) / artifact.path).resolve()
    if not path.is_relative_to(storage_root) or not path.exists():
        raise not_found("Artifact file")
    return FileResponse(path, filename=artifact.name, media_type="application/json")


@router.get("/{execution_id}/stream")
async def stream_execution(
    execution_id: str,
    request: Request,
    after: int = 0,
    user: User = Depends(require_permission("executions:read")),
) -> StreamingResponse:
    async with SessionLocal() as check_db:
        execution = await execution_service.get_execution(check_db, execution_id)
        initial = execution_detail(execution)
        initial_logs = await execution_service.logs(check_db, execution_id, after_id=after)

    async def generator():
        # Replay persisted logs before the snapshot: clients close the stream as
        # soon as they see a terminal snapshot, which would otherwise drop them.
        for log in initial_logs:
            yield f"event: log\ndata: {json.dumps(jsonable_encoder(log), default=str)}\n\n"
        yield f"event: snapshot\ndata: {json.dumps(jsonable_encoder(initial), default=str)}\n\n"
        if initial.get("status") in {"SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT", "BLOCKED"}:
            return
        queue = await event_bus.subscribe(f"execution:{execution_id}")
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                except TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                yield f"event: {event['type']}\ndata: {json.dumps(event['data'], default=str)}\n\n"
        finally:
            await event_bus.unsubscribe(f"execution:{execution_id}", queue)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
