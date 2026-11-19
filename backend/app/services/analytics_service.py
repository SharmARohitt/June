"""Dashboard, analytics and live operations snapshots computed from real records."""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import ExecutionStatus, TERMINAL_EXECUTION_STATUSES
from app.core.database import utcnow
from app.models import (
    Approval,
    AuditEvent,
    Automation,
    Environment,
    Execution,
    ExecutionAgent,
    SecurityFinding,
    SecurityScan,
    ServerGroup,
    User,
)
from app.services.serializers import (
    approval_out,
    audit_out,
    execution_summary,
)


def _agent_status(agent: ExecutionAgent) -> str:
    if agent.last_heartbeat_at is None:
        return "OFFLINE"
    last = agent.last_heartbeat_at.astimezone(UTC) if agent.last_heartbeat_at.tzinfo else agent.last_heartbeat_at.replace(tzinfo=UTC)
    age = (utcnow() - last).total_seconds()
    if age <= 120:
        return "ONLINE"
    if age <= 900:
        return "STALE"
    return "OFFLINE"


def agent_payload(agent: ExecutionAgent) -> dict:
    return {
        "id": agent.id,
        "name": agent.name,
        "kind": agent.kind,
        "environment_id": agent.environment_id,
        "status": _agent_status(agent),
        "endpoint": agent.endpoint,
        "version": agent.version,
        "capabilities": agent.capabilities or [],
        "labels": agent.labels or {},
        "last_heartbeat_at": agent.last_heartbeat_at,
    }


async def _environment_health(db: AsyncSession, *, since: datetime) -> list[dict]:
    environments = list((await db.execute(select(Environment).order_by(Environment.sort_order))).scalars().all())
    agents = list((await db.execute(select(ExecutionAgent))).scalars().all())
    health = []
    for environment in environments:
        groups = list(
            (
                await db.execute(select(ServerGroup).where(ServerGroup.environment_id == environment.id))
            )
            .scalars()
            .all()
        )
        servers = [server for group in groups for server in group.servers]
        reachable = sum(1 for server in servers if server.status == "REACHABLE")
        unreachable = sum(1 for server in servers if server.status == "UNREACHABLE")
        simulated = sum(1 for server in servers if server.is_simulated)
        unknown = len(servers) - reachable - unreachable - simulated
        env_agents = [agent for agent in agents if agent.environment_id == environment.id]
        online_agents = sum(1 for agent in env_agents if _agent_status(agent) == "ONLINE")

        recent = list(
            (
                await db.execute(
                    select(Execution.status).where(
                        Execution.environment_id == environment.id, Execution.created_at >= since
                    )
                )
            )
            .scalars()
            .all()
        )
        terminal = [status for status in recent if status in TERMINAL_EXECUTION_STATUSES]
        success_rate = (
            round(sum(1 for status in recent if status == ExecutionStatus.SUCCEEDED) / len(terminal) * 100, 1)
            if terminal
            else None
        )
        last_execution = (
            await db.execute(
                select(Execution.created_at)
                .where(Execution.environment_id == environment.id)
                .order_by(Execution.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

        if not servers and environment.execution_mode == "SIMULATION":
            status = "SIMULATED"
            detail = "No server inventory yet. Deployment runs use the simulation adapter and are labelled as such."
        elif servers and simulated == len(servers):
            status = "SIMULATED"
            detail = "All registered targets are simulated; connectivity is never claimed."
        elif environment.execution_mode == "REMOTE_AGENT" and not online_agents:
            status = "AGENT_OFFLINE"
            detail = "No execution agent heartbeat is available for this environment."
        elif unreachable:
            status = "DEGRADED"
            detail = f"{unreachable} server(s) reported unreachable on their last real probe."
        elif reachable:
            status = "HEALTHY"
            detail = f"{reachable} server(s) passed their last real probe."
        else:
            status = "UNKNOWN"
            detail = "No connectivity probes have run yet. JUNE does not invent a healthy state."

        health.append(
            {
                "id": environment.id,
                "key": environment.key,
                "name": environment.name,
                "kind": environment.kind,
                "execution_mode": environment.execution_mode,
                "status": status,
                "detail": detail,
                "success_rate": success_rate,
                "executions_in_range": len(recent),
                "last_execution_at": last_execution,
                "servers_total": len(servers),
                "reachable": reachable,
                "unreachable": unreachable,
                "simulated": simulated,
                "unknown": max(unknown, 0),
                "agents_online": online_agents,
                "agents_total": len(env_agents),
            }
        )
    return health


def _day_series(rows: list[tuple], days: int, since: datetime) -> list[dict]:
    buckets: dict[str, dict] = {}
    today = utcnow().date()
    for offset in range(days - 1, -1, -1):
        label = (today - timedelta(days=offset)).isoformat()
        buckets[label] = {"label": label, "succeeded": 0, "failed": 0, "blocked": 0, "total": 0}
    for status, created_at in rows:
        day = created_at.date().isoformat()
        if day not in buckets:
            continue
        bucket = buckets[day]
        bucket["total"] += 1
        if status == ExecutionStatus.SUCCEEDED:
            bucket["succeeded"] += 1
        elif status in {ExecutionStatus.FAILED, ExecutionStatus.TIMED_OUT}:
            bucket["failed"] += 1
        elif status == ExecutionStatus.BLOCKED:
            bucket["blocked"] += 1
    return list(buckets.values())


async def dashboard_overview(db: AsyncSession, *, days: int = 7) -> dict:
    now = utcnow()
    since = now - timedelta(days=days)
    automations_total = int(
        (await db.execute(select(func.count(Automation.id)).where(Automation.status == "ACTIVE"))).scalar_one()
    )
    active_executions = int(
        (
            await db.execute(
                select(func.count(Execution.id)).where(
                    Execution.status.in_(
                        [ExecutionStatus.QUEUED, ExecutionStatus.RUNNING, ExecutionStatus.WAITING_FOR_APPROVAL]
                    )
                )
            )
        ).scalar_one()
    )
    pending_approvals_total = int(
        (await db.execute(select(func.count(Approval.id)).where(Approval.status == "PENDING"))).scalar_one()
    )
    rows = list(
        (
            await db.execute(
                select(Execution.status, Execution.created_at, Execution.environment_id, Execution.automation_id)
                .where(Execution.created_at >= since)
                .order_by(Execution.created_at.desc())
            )
        ).all()
    )
    failed = sum(1 for status, *_ in rows if status in {ExecutionStatus.FAILED, ExecutionStatus.BLOCKED, ExecutionStatus.TIMED_OUT})
    terminal = [status for status, *_ in rows if status in TERMINAL_EXECUTION_STATUSES]
    success_rate = round(terminal.count(ExecutionStatus.SUCCEEDED) / len(terminal) * 100, 1) if terminal else 0.0

    uat = await db.execute(select(Environment).where(Environment.kind == "UAT"))
    uat_env = uat.scalars().first()
    uat_rows = [status for status, _, env_id, _ in rows if uat_env and env_id == uat_env.id]
    uat_terminal = [status for status in uat_rows if status in TERMINAL_EXECUTION_STATUSES]
    uat_success = (
        round(uat_terminal.count(ExecutionStatus.SUCCEEDED) / len(uat_terminal) * 100, 1) if uat_terminal else None
    )

    kpis = [
        {
            "key": "automations",
            "label": "Registered automations",
            "value": automations_total,
            "unit": None,
            "delta": None,
            "trend": None,
            "help": "Active automations in the registry.",
            "href": "/automations",
        },
        {
            "key": "active",
            "label": "Active executions",
            "value": active_executions,
            "unit": None,
            "delta": None,
            "trend": None,
            "help": "Queued, running, or waiting for approval right now.",
            "href": "/executions?status=ACTIVE",
        },
        {
            "key": "approvals",
            "label": "Pending approvals",
            "value": pending_approvals_total,
            "unit": None,
            "delta": None,
            "trend": None,
            "help": "Production candidates awaiting a separation-of-duties decision.",
            "href": "/approvals",
        },
        {
            "key": "failures",
            "label": f"Stopped runs · {days}d",
            "value": failed,
            "unit": None,
            "delta": None,
            "trend": None,
            "help": "Failed, blocked or timed-out executions in the selected period.",
            "href": "/executions?status=FAILED",
        },
        {
            "key": "success_rate",
            "label": f"Success rate · {days}d",
            "value": success_rate,
            "unit": "%",
            "delta": None,
            "trend": None,
            "help": f"{len(terminal)} completed execution(s) in this period." if terminal else "No completed executions in this period yet.",
            "href": "/analytics",
        },
        {
            "key": "uat_health",
            "label": "UAT success rate",
            "value": uat_success if uat_success is not None else 0,
            "unit": "%",
            "delta": None,
            "trend": None,
            "help": f"{len(uat_terminal)} completed UAT run(s) in this period."
            if uat_terminal
            else "No completed UAT runs in this period. Run an automation in UAT to build evidence.",
            "href": "/executions?status=SUCCEEDED",
        },
    ]

    recent_executions = list(
        (
            await db.execute(select(Execution).order_by(Execution.created_at.desc()).limit(6))
        ).scalars().all()
    )
    recent_failures = list(
        (
            await db.execute(
                select(Execution)
                .where(Execution.status.in_([ExecutionStatus.FAILED, ExecutionStatus.BLOCKED, ExecutionStatus.TIMED_OUT]))
                .order_by(Execution.created_at.desc())
                .limit(5)
            )
        )
        .scalars()
        .all()
    )
    pending = list(
        (
            await db.execute(
                select(Approval).where(Approval.status == "PENDING").order_by(Approval.created_at.asc()).limit(5)
            )
        )
        .scalars()
        .all()
    )
    audit = list(
        (await db.execute(select(AuditEvent).order_by(AuditEvent.id.desc()).limit(8))).scalars().all()
    )
    environment_health = await _environment_health(db, since=since)

    alerts: list[dict] = []
    for execution in recent_failures[:3]:
        if execution.created_at >= now - timedelta(hours=24):
            alerts.append(
                {
                    "id": f"exec-{execution.id}",
                    "severity": "high",
                    "title": f"{execution.automation.name} stopped",
                    "message": execution.error_message or "Execution failed.",
                    "href": f"/executions/{execution.id}",
                    "ts": execution.created_at,
                }
            )
    for approval in pending:
        if approval.created_at <= now - timedelta(hours=12):
            alerts.append(
                {
                    "id": f"approval-{approval.id}",
                    "severity": "medium",
                    "title": f"Approval waiting over 12h: {approval.automation.name}",
                    "message": "A production candidate is waiting for a decision.",
                    "href": "/approvals",
                    "ts": approval.created_at,
                }
            )
    agents = list((await db.execute(select(ExecutionAgent))).scalars().all())
    for agent in agents:
        status = _agent_status(agent)
        if status != "ONLINE":
            alerts.append(
                {
                    "id": f"agent-{agent.id}",
                    "severity": "medium" if status == "STALE" else "high",
                    "title": f"Execution agent {agent.name} is {status.lower()}",
                    "message": "Runner capacity may be reduced." if status == "STALE" else "No recent heartbeat from this runner.",
                    "href": "/infrastructure",
                    "ts": agent.last_heartbeat_at,
                }
            )
    open_high = int(
        (
            await db.execute(
                select(func.count(SecurityFinding.id))
                .join(SecurityScan, SecurityScan.id == SecurityFinding.scan_id)
                .where(SecurityFinding.status == "OPEN", SecurityFinding.severity.in_(["CRITICAL", "HIGH"]))
            )
        ).scalar_one()
    )
    if open_high:
        alerts.append(
            {
                "id": "security-open-high",
                "severity": "high",
                "title": f"{open_high} open critical/high security finding(s)",
                "message": "Production promotion is blocked for affected candidates until findings are resolved.",
                "href": "/security",
                "ts": now,
            }
        )

    running = int(
        (await db.execute(select(func.count(Execution.id)).where(Execution.status == ExecutionStatus.RUNNING))).scalar_one()
    )
    queued = int(
        (await db.execute(select(func.count(Execution.id)).where(Execution.status == ExecutionStatus.QUEUED))).scalar_one()
    )
    capacity = int(
        (
            await db.execute(
                select(func.sum(Automation.concurrency_limit)).where(Automation.status == "ACTIVE")
            )
        ).scalar_one()
        or 0
    )
    agents_online = sum(1 for agent in agents if _agent_status(agent) == "ONLINE")
    live_pulse = {
        "active": running + queued,
        "running": running,
        "queued": queued,
        "utilization": round(running / capacity * 100, 1) if capacity else 0.0,
        "capacity": capacity,
        "agents_online": agents_online,
        "agents_total": len(agents),
        "failure_rate_24h": None,
    }
    last_24 = [
        status for status, created_at, *_ in rows if created_at >= now - timedelta(hours=24)
    ]
    last_24_terminal = [status for status in last_24 if status in TERMINAL_EXECUTION_STATUSES]
    if last_24_terminal:
        failures_24 = sum(
            1 for status in last_24 if status in {ExecutionStatus.FAILED, ExecutionStatus.BLOCKED, ExecutionStatus.TIMED_OUT}
        )
        live_pulse["failure_rate_24h"] = round(failures_24 / len(last_24_terminal) * 100, 1)

    return {
        "generated_at": now,
        "range_days": days,
        "kpis": kpis,
        "execution_series": _day_series([(status, created_at) for status, created_at, *_ in rows], days, since),
        "environment_health": environment_health,
        "recent_executions": [execution_summary(execution) for execution in recent_executions],
        "recent_failures": [execution_summary(execution) for execution in recent_failures],
        "pending_approvals": [approval_out(approval) for approval in pending],
        "recent_audit": [audit_out(event) for event in audit],
        "active_alerts": alerts,
        "live_pulse": live_pulse,
    }


async def analytics_overview(db: AsyncSession, *, days: int = 30) -> dict:
    now = utcnow()
    since = now - timedelta(days=days)
    rows = list(
        (
            await db.execute(
                select(
                    Execution.status,
                    Execution.created_at,
                    Execution.duration_ms,
                    Execution.automation_id,
                    Execution.environment_id,
                    Execution.error_code,
                ).where(Execution.created_at >= since)
            )
        ).all()
    )
    automations = {automation.id: automation for automation in (await db.execute(select(Automation))).scalars().all()}
    environments = {environment.id: environment for environment in (await db.execute(select(Environment))).scalars().all()}

    terminal = [row for row in rows if row.status in TERMINAL_EXECUTION_STATUSES]
    success_rate = (
        round(sum(1 for row in rows if row.status == ExecutionStatus.SUCCEEDED) / len(terminal) * 100, 1)
        if terminal
        else None
    )
    durations = [row.duration_ms for row in terminal if row.duration_ms is not None]
    by_automation: dict[str, dict] = defaultdict(lambda: {"executions": 0, "succeeded": 0, "terminal": 0, "durations": []})
    by_environment: dict[str, dict] = defaultdict(lambda: {"executions": 0, "succeeded": 0, "terminal": 0})
    failures: dict[str, int] = defaultdict(int)
    for row in rows:
        automation_bucket = by_automation[row.automation_id]
        automation_bucket["executions"] += 1
        if row.status in TERMINAL_EXECUTION_STATUSES:
            automation_bucket["terminal"] += 1
            if row.status == ExecutionStatus.SUCCEEDED:
                automation_bucket["succeeded"] += 1
            if row.duration_ms is not None:
                automation_bucket["durations"].append(row.duration_ms)
        env_bucket = by_environment[row.environment_id]
        env_bucket["executions"] += 1
        if row.status in TERMINAL_EXECUTION_STATUSES:
            env_bucket["terminal"] += 1
            if row.status == ExecutionStatus.SUCCEEDED:
                env_bucket["succeeded"] += 1
        if row.status in {ExecutionStatus.FAILED, ExecutionStatus.BLOCKED, ExecutionStatus.TIMED_OUT}:
            failures[row.error_code or "UNKNOWN"] += 1

    approvals = list(
        (
            await db.execute(select(Approval).where(Approval.created_at >= since))
        )
        .scalars()
        .all()
    )
    decided = [approval for approval in approvals if approval.decided_at]
    avg_decision = (
        round(
            sum((approval.decided_at - approval.created_at).total_seconds() for approval in decided) / len(decided),
            0,
        )
        if decided
        else None
    )

    failure_labels = {
        "SECURITY_BLOCKED": "Security blocked",
        "APPROVAL_REJECTED": "Approval rejected",
        "PRODUCTION_POLICY_BLOCKED": "Policy blocked",
        "APPROVAL_INVALIDATED": "Approval invalidated",
        "STAGE_TIMEOUT": "Timeout",
        "TARGET_UNREACHABLE": "Target unreachable",
        "NO_LIVE_TARGETS": "No live targets",
        "INVALID_INPUT": "Invalid input",
        "AGENT_CHANNEL_NOT_CONFIGURED": "Agent not configured",
        "INTERRUPTED_BY_RESTART": "Platform restart",
        "UNKNOWN": "Unclassified",
    }

    return {
        "range_days": days,
        "total_executions": len(rows),
        "success_rate": success_rate,
        "avg_duration_ms": round(sum(durations) / len(durations)) if durations else None,
        "by_day": _day_series([(row.status, row.created_at) for row in rows], days, since),
        "by_automation": sorted(
            (
                {
                    "automation_id": automation_id,
                    "name": automations[automation_id].name if automation_id in automations else "Unknown",
                    "executions": bucket["executions"],
                    "success_rate": round(bucket["succeeded"] / bucket["terminal"] * 100, 1)
                    if bucket["terminal"]
                    else None,
                    "avg_duration_ms": round(sum(bucket["durations"]) / len(bucket["durations"]))
                    if bucket["durations"]
                    else None,
                }
                for automation_id, bucket in by_automation.items()
            ),
            key=lambda item: item["executions"],
            reverse=True,
        ),
        "by_environment": [
            {
                "key": environments[environment_id].key if environment_id in environments else "unknown",
                "name": environments[environment_id].name if environment_id in environments else "Unknown",
                "executions": bucket["executions"],
                "success_rate": round(bucket["succeeded"] / bucket["terminal"] * 100, 1)
                if bucket["terminal"]
                else None,
            }
            for environment_id, bucket in by_environment.items()
        ],
        "failures": [
            {"code": code, "label": failure_labels.get(code, code), "count": count}
            for code, count in sorted(failures.items(), key=lambda item: item[1], reverse=True)
        ],
        "approvals": {
            "total": len(approvals),
            "pending": sum(1 for approval in approvals if approval.status == "PENDING"),
            "approved": sum(1 for approval in approvals if approval.status == "APPROVED"),
            "rejected": sum(1 for approval in approvals if approval.status == "REJECTED"),
            "invalidated": sum(1 for approval in approvals if approval.status == "INVALIDATED"),
            "avg_decision_seconds": avg_decision,
        },
    }


async def pulse_snapshot(db: AsyncSession) -> dict:
    now = utcnow()
    active = list(
        (
            await db.execute(
                select(Execution)
                .where(
                    Execution.status.in_(
                        [ExecutionStatus.QUEUED, ExecutionStatus.RUNNING, ExecutionStatus.WAITING_FOR_APPROVAL]
                    )
                )
                .order_by(Execution.created_at.desc())
                .limit(12)
            )
        )
        .scalars()
        .all()
    )
    agents = list((await db.execute(select(ExecutionAgent))).scalars().all())
    queue_depth = int(
        (await db.execute(select(func.count(Execution.id)).where(Execution.status == ExecutionStatus.QUEUED))).scalar_one()
    )
    running = sum(1 for execution in active if execution.status == ExecutionStatus.RUNNING)
    capacity = int(
        (await db.execute(select(func.sum(Automation.concurrency_limit)).where(Automation.status == "ACTIVE"))).scalar_one()
        or 0
    )
    last_24 = list(
        (
            await db.execute(
                select(Execution.status).where(Execution.created_at >= now - timedelta(hours=24))
            )
        )
        .scalars()
        .all()
    )
    terminal = [status for status in last_24 if status in TERMINAL_EXECUTION_STATUSES]
    failures = sum(1 for status in last_24 if status in {ExecutionStatus.FAILED, ExecutionStatus.BLOCKED, ExecutionStatus.TIMED_OUT})
    recent_events = list(
        (await db.execute(select(AuditEvent).order_by(AuditEvent.id.desc()).limit(10))).scalars().all()
    )
    return {
        "generated_at": now,
        "active_executions": [execution_summary(execution) for execution in active],
        "queue_depth": queue_depth,
        "runner_utilization": round(running / capacity * 100, 1) if capacity else 0.0,
        "agents": [agent_payload(agent) for agent in agents],
        "failure_rate_24h": round(failures / len(terminal) * 100, 1) if terminal else None,
        "recent_events": [audit_out(event) for event in recent_events],
        "environment_health": await _environment_health(db, since=now - timedelta(days=1)),
        "stale": False,
    }


async def environment_health(db: AsyncSession) -> list[dict]:
    return await _environment_health(db, since=utcnow() - timedelta(days=7))
