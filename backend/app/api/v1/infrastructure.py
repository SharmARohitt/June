from __future__ import annotations

from fastapi import APIRouter, Depends, Header, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.core.database import get_db
from app.core.errors import JuneError, not_found
from app.models import ExecutionAgent, User
from app.schemas.governance import (
    AgentCreate,
    AgentHeartbeat,
    AgentOut,
    EnvironmentCreate,
    EnvironmentDetail,
    EnvironmentOut,
    ServerCreate,
    ServerGroupCreate,
    ServerGroupOut,
    ServerOut,
)
from app.services import infrastructure_service

router = APIRouter(prefix="/environments", tags=["Infrastructure Nexus"])
server_group_router = APIRouter(prefix="/server-groups", tags=["Infrastructure Nexus"])
infrastructure_router = APIRouter(prefix="/infrastructure", tags=["Infrastructure Nexus"])
agents_router = APIRouter(prefix="/agents", tags=["Execution Agents"])


@router.get("", response_model=list[EnvironmentOut])
async def list_environments(
    user: User = Depends(require_permission("infrastructure:read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    return await infrastructure_service.list_environments(db)


@router.post("", response_model=EnvironmentOut, status_code=status.HTTP_201_CREATED)
async def create_environment(
    payload: EnvironmentCreate,
    user: User = Depends(require_permission("admin:environments")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    environment = await infrastructure_service.create_environment(db, user, payload)
    return {
        "id": environment.id,
        "key": environment.key,
        "name": environment.name,
        "kind": environment.kind,
        "description": environment.description,
        "execution_mode": environment.execution_mode,
        "approval_required": environment.approval_required or environment.kind == "PRODUCTION",
        "color": environment.color,
        "sort_order": environment.sort_order,
        "is_active": environment.is_active,
        "server_count": 0,
        "group_count": 0,
        "last_execution_at": None,
    }


@router.get("/{environment_id}", response_model=EnvironmentDetail)
async def get_environment(
    environment_id: str,
    user: User = Depends(require_permission("infrastructure:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await infrastructure_service.environment_detail(db, environment_id)


@router.post("/{environment_id}/groups", response_model=ServerGroupOut, status_code=201)
async def create_group(
    environment_id: str,
    payload: ServerGroupCreate,
    user: User = Depends(require_permission("infrastructure:write")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    group = await infrastructure_service.create_group(db, user, environment_id, payload)
    return infrastructure_service.group_out(group)


@server_group_router.post("/{group_id}/servers", response_model=ServerOut, status_code=201)
async def create_server(
    group_id: str,
    payload: ServerCreate,
    user: User = Depends(require_permission("infrastructure:write")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    server = await infrastructure_service.create_server(db, user, group_id, payload)
    return infrastructure_service.server_out(server)


@infrastructure_router.get("/topology")
async def topology(
    user: User = Depends(require_permission("infrastructure:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    return await infrastructure_service.topology(db)


@infrastructure_router.get("/agents", response_model=list[AgentOut])
async def list_agents(
    user: User = Depends(require_permission("infrastructure:read")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    from app.services.analytics_service import agent_payload

    agents = list((await db.execute(select(ExecutionAgent))).scalars().all())
    return [agent_payload(agent) for agent in agents]


@infrastructure_router.post("/agents", status_code=201)
async def register_agent(
    payload: AgentCreate,
    user: User = Depends(require_permission("infrastructure:write")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    agent, token = await infrastructure_service.create_agent(db, user, payload)
    return {
        "agent": {
            "id": agent.id,
            "name": agent.name,
            "kind": agent.kind,
            "environment_id": agent.environment_id,
            "status": agent.status,
        },
        "token": token,
        "token_notice": "Copy this token now. JUNE stores only its SHA-256 hash and cannot show it again.",
    }


@agents_router.post("/{agent_id}/heartbeat")
async def heartbeat(
    agent_id: str,
    payload: AgentHeartbeat,
    x_agent_token: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict:
    agent = await infrastructure_service.get_agent_by_token(db, x_agent_token or "")
    if not agent or agent.id != agent_id:
        raise JuneError(401, "invalid_agent_token", "The execution agent token is missing or invalid.")
    updated = await infrastructure_service.record_heartbeat(db, agent, payload)
    return {
        "id": updated.id,
        "status": updated.status,
        "last_heartbeat_at": updated.last_heartbeat_at,
        "server_time": infrastructure_service.utcnow(),
    }
