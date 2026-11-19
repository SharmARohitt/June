"""Environments, target groups, servers and execution agents.

Connectivity is only ever reported from a real probe recorded by the health-check
runner. Registration and topology never invent reachability.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import ExecutionStatus
from app.core.database import utcnow
from app.core.errors import conflict, invalid, not_found
from app.core.security import generate_agent_token, hash_token
from app.models import Environment, Execution, ExecutionAgent, Server, ServerGroup, User
from app.services import audit_service
from app.services.analytics_service import agent_payload
from app.services.automation_service import slugify
from app.services.serializers import environment_mini, execution_summary


def _environment_out(environment: Environment, *, last_execution_at=None) -> dict:
    servers = [server for group in environment.server_groups for server in group.servers]
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
        "server_count": len(servers),
        "group_count": len(environment.server_groups),
        "last_execution_at": last_execution_at,
    }


def server_out(server: Server) -> dict:
    return {
        "id": server.id,
        "hostname": server.hostname,
        "display_name": server.display_name,
        "address": server.address,
        "port": server.port,
        "role": server.role,
        "is_simulated": server.is_simulated,
        "status": server.status,
        "last_checked_at": server.last_checked_at,
        "details": server.details or {},
    }


def group_out(group: ServerGroup) -> dict:
    return {
        "id": group.id,
        "name": group.name,
        "slug": group.slug,
        "description": group.description,
        "check_protocol": group.check_protocol,
        "environment_id": group.environment_id,
        "servers": [server_out(server) for server in group.servers],
    }


async def list_environments(db: AsyncSession) -> list[dict]:
    environments = list(
        (await db.execute(select(Environment).order_by(Environment.sort_order))).scalars().all()
    )
    last = dict(
        (
            await db.execute(
                select(Execution.environment_id, func.max(Execution.created_at)).group_by(Execution.environment_id)
            )
        ).all()
    )
    return [_environment_out(environment, last_execution_at=last.get(environment.id)) for environment in environments]


async def environment_detail(db: AsyncSession, environment_id: str) -> dict:
    environment = await db.get(Environment, environment_id)
    if not environment:
        raise not_found("Environment")
    agents = list(
        (
            await db.execute(select(ExecutionAgent).where(ExecutionAgent.environment_id == environment.id))
        )
        .scalars()
        .all()
    )
    data = _environment_out(environment)
    data["groups"] = [group_out(group) for group in environment.server_groups]
    data["agents"] = [agent_payload(agent) for agent in agents]
    return data


async def create_environment(db: AsyncSession, actor: User, payload) -> Environment:
    existing = (
        await db.execute(select(Environment).where(Environment.key == payload.key))
    ).scalar_one_or_none()
    if existing:
        raise conflict("An environment with this key already exists.")
    order = int((await db.execute(select(func.coalesce(func.max(Environment.sort_order), 0)))).scalar_one()) + 1
    environment = Environment(
        key=payload.key,
        name=payload.name,
        kind=payload.kind,
        description=payload.description,
        execution_mode=payload.execution_mode,
        approval_required=payload.approval_required or payload.kind == "PRODUCTION",
        color=payload.color,
        sort_order=order,
        is_active=True,
    )
    db.add(environment)
    await db.flush()
    await audit_service.record(
        db,
        actor=actor,
        action="environment.created",
        resource_type="environment",
        resource_id=environment.id,
        details={"key": environment.key, "kind": environment.kind, "mode": environment.execution_mode},
    )
    await db.commit()
    await db.refresh(environment)
    return environment


async def create_group(db: AsyncSession, actor: User, environment_id: str, payload) -> ServerGroup:
    environment = await db.get(Environment, environment_id)
    if not environment:
        raise not_found("Environment")
    slug = slugify(payload.name)
    existing = (
        await db.execute(
            select(ServerGroup).where(ServerGroup.environment_id == environment_id, ServerGroup.slug == slug)
        )
    ).scalar_one_or_none()
    if existing:
        raise conflict("A target group with this name already exists in the environment.")
    group = ServerGroup(
        environment_id=environment.id,
        name=payload.name,
        slug=slug,
        description=payload.description,
        check_protocol=payload.check_protocol,
    )
    db.add(group)
    await db.flush()
    await audit_service.record(
        db,
        actor=actor,
        action="server_group.created",
        resource_type="server_group",
        resource_id=group.id,
        details={"environment": environment.key, "slug": slug},
    )
    await db.commit()
    await db.refresh(group, attribute_names=["servers"])
    return group


async def create_server(db: AsyncSession, actor: User, group_id: str, payload) -> Server:
    group = await db.get(ServerGroup, group_id)
    if not group:
        raise not_found("Server group")
    environment = await db.get(Environment, group.environment_id)
    if (
        payload.is_simulated
        and environment is not None
        and environment.kind == "PRODUCTION"
        and environment.execution_mode != "SIMULATION"
    ):
        raise invalid(
            "Simulated servers cannot be added to a live production group. "
            "Use a simulation environment for demonstration targets."
        )
    server = Server(
        group_id=group.id,
        hostname=payload.hostname,
        display_name=payload.display_name or payload.hostname,
        address=payload.address,
        port=payload.port,
        role=payload.role,
        is_simulated=payload.is_simulated,
        status="UNKNOWN",
        details={},
    )
    db.add(server)
    await db.flush()
    await audit_service.record(
        db,
        actor=actor,
        action="server.created",
        resource_type="server",
        resource_id=server.id,
        details={"group": group.slug, "hostname": server.hostname, "simulated": server.is_simulated},
    )
    await db.commit()
    await db.refresh(server)
    return server


async def create_agent(db: AsyncSession, actor: User, payload) -> tuple[ExecutionAgent, str]:
    existing = (
        await db.execute(select(ExecutionAgent).where(ExecutionAgent.name == payload.name))
    ).scalar_one_or_none()
    if existing:
        raise conflict("An execution agent with this name already exists.")
    if payload.environment_id and not await db.get(Environment, payload.environment_id):
        raise invalid("The selected environment does not exist.")
    token = generate_agent_token()
    agent = ExecutionAgent(
        name=payload.name,
        kind=payload.kind,
        environment_id=payload.environment_id,
        endpoint=payload.endpoint,
        status="OFFLINE",
        capabilities=payload.capabilities,
        labels=payload.labels,
        token_hash=hash_token(token),
    )
    db.add(agent)
    await db.flush()
    await audit_service.record(
        db,
        actor=actor,
        action="agent.registered",
        resource_type="execution_agent",
        resource_id=agent.id,
        details={"name": agent.name, "kind": agent.kind},
    )
    await db.commit()
    await db.refresh(agent)
    return agent, token


async def get_agent_by_token(db: AsyncSession, token: str) -> ExecutionAgent | None:
    if not token:
        return None
    digest = hash_token(token)
    return (
        await db.execute(select(ExecutionAgent).where(ExecutionAgent.token_hash == digest))
    ).scalar_one_or_none()


async def record_heartbeat(db: AsyncSession, agent: ExecutionAgent, payload) -> ExecutionAgent:
    agent.last_heartbeat_at = utcnow()
    agent.status = payload.status
    agent.version = payload.version
    if payload.capabilities is not None:
        agent.capabilities = payload.capabilities
    if payload.labels is not None:
        agent.labels = payload.labels
    await db.commit()
    await db.refresh(agent)
    return agent


async def topology(db: AsyncSession) -> dict:
    environments = list(
        (await db.execute(select(Environment).order_by(Environment.sort_order))).scalars().all()
    )
    agents = list((await db.execute(select(ExecutionAgent))).scalars().all())
    recent_failures = list(
        (
            await db.execute(
                select(Execution)
                .where(
                    Execution.status.in_(
                        [ExecutionStatus.FAILED, ExecutionStatus.BLOCKED, ExecutionStatus.TIMED_OUT]
                    )
                )
                .order_by(Execution.created_at.desc())
                .limit(6)
            )
        )
        .scalars()
        .all()
    )
    environments_payload = []
    for environment in environments:
        groups = [group_out(group) for group in environment.server_groups]
        environments_payload.append(
            {
                **environment_mini(environment),
                "groups": groups,
                "servers_total": sum(len(group["servers"]) for group in groups),
                "servers_reachable": sum(
                    1 for group in groups for server in group["servers"] if server["status"] == "REACHABLE"
                ),
                "servers_unreachable": sum(
                    1 for group in groups for server in group["servers"] if server["status"] == "UNREACHABLE"
                ),
                "servers_simulated": sum(
                    1 for group in groups for server in group["servers"] if server["is_simulated"]
                ),
                "agents": [
                    agent_payload(agent)
                    for agent in agents
                    if agent.environment_id == environment.id
                ],
            }
        )
    return {
        "generated_at": utcnow(),
        "environments": environments_payload,
        "agents": [agent_payload(agent) for agent in agents],
        "recent_failures": [execution_summary(execution) for execution in recent_failures],
    }
