"""Execution requests, preflight, retrieval, cancellation and deterministic insight."""

from __future__ import annotations

import hashlib
import json
import secrets
from datetime import UTC, datetime, timedelta

from jsonschema import Draft202012Validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import TERMINAL_EXECUTION_STATUSES, ExecutionStatus, StageStatus
from app.core.database import utcnow
from app.core.errors import conflict, forbidden, invalid, not_found
from app.models import (
    Approval,
    Artifact,
    Automation,
    AutomationVersion,
    Environment,
    Execution,
    ExecutionLog,
    ExecutionStage,
    ServerGroup,
    User,
    WorkflowVersion,
)
from app.services import audit_service, policy_engine, workflow_service
from app.services.serializers import execution_summary
from app.engine.executor import engine


class DuplicateExecution(Exception):
    def __init__(self, execution: Execution) -> None:
        self.execution = execution


def candidate_hash(
    *,
    automation: Automation,
    automation_version: str,
    workflow_version: WorkflowVersion,
    environment: Environment,
    server_group: ServerGroup | None,
    params: dict,
) -> str:
    payload = {
        "automation_id": automation.id,
        "automation_version": automation_version,
        "workflow_checksum": workflow_version.checksum,
        "environment": environment.key,
        "server_group": server_group.id if server_group else None,
        "params": params,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _validate_params(automation: Automation, params: dict) -> None:
    validator = Draft202012Validator(automation.input_schema or {})
    errors = sorted(validator.iter_errors(params), key=lambda error: list(error.path))
    if errors:
        raise invalid(
            "The execution parameters do not match the published input schema.",
            [
                {"field": "/".join(str(part) for part in error.path) or "input", "message": error.message}
                for error in errors[:8]
            ],
        )


async def _load_context(db: AsyncSession, automation_id: str, environment_id: str):
    automation = await db.get(Automation, automation_id)
    if not automation:
        raise not_found("Automation")
    environment = await db.get(Environment, environment_id)
    if not environment:
        raise not_found("Environment")
    if not environment.is_active:
        raise invalid("This environment is disabled.")
    if environment.execution_mode not in {"LOCAL_SANDBOX", "SIMULATION", "REMOTE_AGENT"}:
        raise invalid(
            f"Environment '{environment.name}' declares an unsupported execution mode. JUNE will not execute against it.",
            {"execution_mode": environment.execution_mode},
        )
    workflow = await workflow_service.get_default_workflow(db, automation.id)
    if not workflow:
        raise conflict("This automation has no workflow. Publish a workflow in Pipeline Studio first.")
    workflow_version = await workflow_service.latest_published_version(db, workflow.id)
    if not workflow_version:
        raise conflict("This automation has no published workflow version.")
    version = (
        await db.execute(
            select(AutomationVersion)
            .where(
                AutomationVersion.automation_id == automation.id,
                AutomationVersion.version == automation.current_version,
            )
        )
    ).scalar_one_or_none()
    if not version:
        raise conflict(
            "The automation's current version record is missing. Re-register the automation or publish a version before executing.",
            {"automation": automation.slug, "current_version": automation.current_version},
        )
    return automation, environment, workflow, workflow_version, version


async def _resolve_group(db: AsyncSession, environment: Environment, server_group_id: str | None) -> ServerGroup | None:
    if server_group_id:
        group = await db.get(ServerGroup, server_group_id)
        if not group:
            raise not_found("Server group")
        if group.environment_id != environment.id:
            raise invalid("The selected server group does not belong to this environment.")
        return group
    group = (await db.execute(select(ServerGroup).where(ServerGroup.environment_id == environment.id))).scalars().first()
    return group


async def preflight(
    db: AsyncSession,
    user: User,
    *,
    automation_id: str,
    environment_id: str,
    server_group_id: str | None,
    params: dict,
) -> dict:
    automation, environment, _workflow, _workflow_version, _version = await _load_context(
        db, automation_id, environment_id
    )
    server_group = await _resolve_group(db, environment, server_group_id)
    result = await policy_engine.evaluate_execution_request(
        db,
        automation=automation,
        environment=environment,
        user=user,
        server_group_id=server_group.id if server_group else None,
        params=params,
    )
    try:
        _validate_params(automation, params)
        result.add("input_schema", "Inputs match the published schema", True, "All supplied inputs are valid.")
    except Exception as exc:
        detail = exc.details if hasattr(exc, "details") else None
        message = exc.message if hasattr(exc, "message") else "Input validation failed."
        result.checks.append(
            {
                "key": "input_schema",
                "name": "Inputs match the published schema",
                "status": "FAIL",
                "severity": "BLOCK",
                "message": message,
                "blocking": True,
                "details": detail,
            }
        )
    return {
        "checks": result.checks,
        "can_submit": result.can_submit,
        "requires_approval": result.requires_approval,
        "blocking_issues": result.blocking_issues,
        "evaluated_by": result.evaluated_by,
    }


async def submit_execution(db: AsyncSession, user: User, payload) -> Execution:
    automation, environment, workflow, workflow_version, version = await _load_context(
        db, payload.automation_id, payload.environment_id
    )
    server_group = await _resolve_group(db, environment, payload.server_group_id)

    if payload.idempotency_key:
        existing = (
            await db.execute(
                select(Execution).where(
                    Execution.requested_by == user.id,
                    Execution.idempotency_key == payload.idempotency_key,
                )
            )
        ).scalar_one_or_none()
        if existing:
            requested_group = server_group.id if server_group else None
            if (
                existing.automation_id != automation.id
                or existing.environment_id != environment.id
                or (existing.server_group_id or None) != requested_group
                or (existing.params or {}) != payload.params
            ):
                raise conflict(
                    "This idempotency key was already used for a different execution request.",
                    {"execution": existing.display_id},
                )
            raise DuplicateExecution(existing)

    _validate_params(automation, payload.params)
    policy = await policy_engine.evaluate_execution_request(
        db,
        automation=automation,
        environment=environment,
        user=user,
        server_group_id=server_group.id if server_group else None,
        params=payload.params,
    )
    if not policy.can_submit:
        raise forbidden(
            "JUNE blocked this execution request before it started.",
            {"checks": policy.checks, "blocking_issues": policy.blocking_issues},
        )

    issues = workflow_service.validate_definition(workflow_version.definition, has_production=True)
    errors = [issue for issue in issues if issue["severity"] == "error"]
    if errors:
        raise conflict("The published workflow is not valid and cannot execute.", errors)

    ordered_nodes = workflow_service.topological_order(workflow_version.definition)
    candidate = candidate_hash(
        automation=automation,
        automation_version=version.version,
        workflow_version=workflow_version,
        environment=environment,
        server_group=server_group,
        params=payload.params,
    )
    execution = Execution(
        display_id=f"EXE-{utcnow().year}-{secrets.token_hex(3).upper()}",
        automation_id=automation.id,
        automation_version=version.version,
        workflow_version_id=workflow_version.id,
        requested_by=user.id,
        environment_id=environment.id,
        server_group_id=server_group.id if server_group else None,
        status=ExecutionStatus.QUEUED,
        params=payload.params,
        reason=payload.reason,
        idempotency_key=payload.idempotency_key,
        candidate_hash=candidate,
        adapter="local_sandbox",
        execution_mode=environment.execution_mode,
        timeout_seconds=automation.timeout_seconds,
    )
    db.add(execution)
    await db.flush()
    for index, node in enumerate(ordered_nodes):
        stage_key = node["stage_key"]
        db.add(
            ExecutionStage(
                execution_id=execution.id,
                key=stage_key,
                name=node.get("label") or stage_key,
                description=node.get("description", ""),
                order_index=index,
                status=StageStatus.PENDING,
            )
        )
    await audit_service.record(
        db,
        actor=user,
        action="execution.requested",
        resource_type="execution",
        resource_id=execution.id,
        details={
            "display_id": execution.display_id,
            "automation": automation.slug,
            "automation_version": version.version,
            "environment": environment.key,
            "execution_mode": environment.execution_mode,
            "candidate_hash": candidate,
            "requires_approval": policy.requires_approval,
            "reason": payload.reason,
            "policy_engine": policy.evaluated_by,
        },
    )
    await db.commit()
    await db.refresh(execution)
    engine.schedule(execution.id)
    return execution


async def get_execution(db: AsyncSession, execution_id: str) -> Execution:
    execution = await db.get(Execution, execution_id)
    if not execution:
        raise not_found("Execution")
    return execution


async def list_executions(
    db: AsyncSession,
    *,
    status: str | None = None,
    environment: str | None = None,
    automation_id: str | None = None,
    requested_by: str | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int = 25,
) -> tuple[list[dict], int]:
    query = select(Execution)
    if status and status.upper() == "ACTIVE":
        query = query.where(
            Execution.status.in_(
                [ExecutionStatus.QUEUED, ExecutionStatus.RUNNING, ExecutionStatus.WAITING_FOR_APPROVAL]
            )
        )
    elif status and status != "ALL":
        query = query.where(Execution.status == status)
    if environment:
        query = query.join(Environment, Environment.id == Execution.environment_id).where(Environment.key == environment)
    if automation_id:
        query = query.where(Execution.automation_id == automation_id)
    if requested_by:
        query = query.where(Execution.requested_by == requested_by)
    if q:
        query = query.where(Execution.display_id.ilike(f"%{q}%"))
    total = int((await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one())
    query = query.order_by(Execution.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    executions = list((await db.execute(query)).scalars().all())
    return [execution_summary(execution) for execution in executions], total


async def logs(
    db: AsyncSession, execution_id: str, *, after_id: int = 0, limit: int = 1000
) -> list[dict]:
    await get_execution(db, execution_id)
    result = await db.execute(
        select(ExecutionLog)
        .where(ExecutionLog.execution_id == execution_id, ExecutionLog.id > after_id)
        .order_by(ExecutionLog.id.asc())
        .limit(limit)
    )
    return [
        {
            "id": log.id,
            "execution_id": log.execution_id,
            "stage_key": log.stage_key,
            "level": log.level,
            "source": log.source,
            "message": log.message,
            "created_at": log.created_at,
        }
        for log in result.scalars().all()
    ]


async def artifacts(db: AsyncSession, execution_id: str) -> list[dict]:
    await get_execution(db, execution_id)
    result = await db.execute(
        select(Artifact).where(Artifact.execution_id == execution_id).order_by(Artifact.created_at.desc())
    )
    return [
        {
            "id": artifact.id,
            "name": artifact.name,
            "kind": artifact.kind,
            "size_bytes": artifact.size_bytes,
            "checksum": artifact.checksum,
            "created_at": artifact.created_at,
        }
        for artifact in result.scalars().all()
    ]


async def cancel_execution(db: AsyncSession, user: User, execution_id: str, reason: str) -> Execution:
    execution = await get_execution(db, execution_id)
    if execution.status in TERMINAL_EXECUTION_STATUSES:
        raise conflict("This execution has already finished.")
    if execution.requested_by != user.id and "admin:settings" not in user.permissions:
        raise forbidden("Only the requester or a platform administrator can cancel this execution.")

    execution.cancel_requested = True
    approval = (await db.execute(select(Approval).where(Approval.execution_id == execution.id))).scalar_one_or_none()
    if approval and approval.status == "PENDING":
        approval.status = "INVALIDATED"
        approval.decision_reason = "Execution cancelled."
    if execution.status in {ExecutionStatus.QUEUED, ExecutionStatus.WAITING_FOR_APPROVAL}:
        execution.status = ExecutionStatus.CANCELLED
        execution.finished_at = utcnow()
        for stage in execution.stages:
            if stage.status in {StageStatus.PENDING, StageStatus.WAITING_FOR_APPROVAL}:
                stage.status = StageStatus.CANCELLED
                stage.finished_at = utcnow()
        db.add(
            ExecutionLog(
                execution_id=execution.id,
                level="WARN",
                source="june",
                message="Execution cancelled before the next stage started.",
                created_at=utcnow(),
            )
        )
    else:
        db.add(
            ExecutionLog(
                execution_id=execution.id,
                level="WARN",
                source="june",
                message="Cancellation requested. The engine will stop before the next stage.",
                created_at=utcnow(),
            )
        )
    await audit_service.record(
        db,
        actor=user,
        action="execution.cancel_requested",
        resource_type="execution",
        resource_id=execution.id,
        details={"reason": reason, "display_id": execution.display_id},
    )
    await db.commit()
    await db.refresh(execution)
    return execution


INSIGHT_RULES: dict[str, dict] = {
    "SECURITY_BLOCKED": {
        "category": "Security",
        "title": "Security validation blocked the run",
        "explanation": "The candidate produced critical or high security findings, so JUNE stopped it before deployment.",
        "likely_causes": ["A credential was committed to the package", "A dependency policy rule failed"],
        "suggested_steps": [
            "Open Security & Governance and review the finding evidence.",
            "Remove or rotate the exposed credential.",
            "Publish a fixed version and request a new execution.",
        ],
    },
    "TARGET_UNREACHABLE": {
        "category": "Connectivity",
        "title": "An approved target could not be reached",
        "explanation": "The execution could not establish a connection to its target servers.",
        "likely_causes": ["The service is stopped", "Network policy or firewall is blocking the port", "The registered address is stale"],
        "suggested_steps": [
            "Confirm the service is running on the target host.",
            "Check the server address and port in Infrastructure Nexus.",
            "Ask the network team to verify connectivity from the execution plane.",
        ],
    },
    "NO_LIVE_TARGETS": {
        "category": "Configuration",
        "title": "No live targets are configured",
        "explanation": "Every server in the selected group is marked simulated, so there was nothing real to probe.",
        "likely_causes": ["The selected environment is a simulation", "The server group has no registered live endpoints"],
        "suggested_steps": ["Select an environment with live endpoints.", "Register real servers in Infrastructure Nexus."],
    },
    "APPROVAL_REJECTED": {
        "category": "Governance",
        "title": "The approval was rejected",
        "explanation": "An authorized approver rejected this candidate, so production promotion was prevented.",
        "likely_causes": ["Evidence was incomplete", "The change window was not acceptable", "The approach needs revision"],
        "suggested_steps": ["Read the approver's comment.", "Address the concern and submit a new request."],
    },
    "PRODUCTION_POLICY_BLOCKED": {
        "category": "Governance",
        "title": "Production policy blocked promotion",
        "explanation": "At promotion time, one or more mandatory policy checks failed.",
        "likely_causes": ["Approval expired or was bound to an older candidate", "Security evidence was missing", "The version changed after approval"],
        "suggested_steps": ["Review the stage log for each failed check.", "Request a fresh approval for the current candidate."],
    },
    "APPROVAL_INVALIDATED": {
        "category": "Governance",
        "title": "The approval no longer applies",
        "explanation": "The candidate changed after approval, so the approval was invalidated.",
        "likely_causes": ["A new automation version was published", "The workflow was republished"],
        "suggested_steps": ["Request a new production execution against the current version."],
    },
    "APPROVAL_EXPIRED": {
        "category": "Governance",
        "title": "The approval window expired",
        "explanation": "No authorized approver decided within the 24-hour window, so JUNE released the execution instead of leaving it paused.",
        "likely_causes": ["The approver was unavailable", "The request was no longer needed"],
        "suggested_steps": ["Submit a new production request if the change is still required."],
    },
    "APPROVAL_INVALID": {
        "category": "Governance",
        "title": "The approval cannot be used",
        "explanation": "The approval record is missing, was replaced, or does not match the candidate attempting to deploy.",
        "likely_causes": ["The candidate changed after the approval", "The approval was invalidated"],
        "suggested_steps": ["Open the approval record and request a fresh decision for the current candidate."],
    },
    "TARGET_GROUP_MISSING": {
        "category": "Configuration",
        "title": "The bound target group no longer exists",
        "explanation": "The server group recorded in this candidate was removed. JUNE stopped the run instead of silently retargeting it.",
        "likely_causes": ["The server group was deleted after the execution was requested", "Infrastructure was re-registered under a new group"],
        "suggested_steps": ["Recreate the server group or register a new execution against an existing group."],
    },
    "VERSION_CHANGED": {
        "category": "Governance",
        "title": "The automation version changed mid-run",
        "explanation": "A newer automation version was published while this execution was running, so the candidate is no longer current.",
        "likely_causes": ["Someone published a new version during the run"],
        "suggested_steps": ["Submit a new production request for the current version."],
    },
    "ENGINE_CRASH": {
        "category": "Platform",
        "title": "The execution engine hit an unexpected error",
        "explanation": "JUNE could not finish this execution safely, so it was marked failed rather than left running.",
        "likely_causes": ["An unexpected platform error", "A dependent service was unavailable"],
        "suggested_steps": ["Submit a new execution request.", "If this repeats, contact the JUNE platform team with the execution ID."],
    },
    "PACKAGE_INVALID": {
        "category": "Configuration",
        "title": "The automation package is invalid",
        "explanation": "The stored package manifest could not be read, so JUNE refused to execute it.",
        "likely_causes": ["The package was modified outside JUNE", "The package manifest is corrupt"],
        "suggested_steps": ["Restore the package from the approved repository and publish a new version."],
    },
    "ADAPTER_NOT_CONFIGURED": {
        "category": "Integration",
        "title": "No certified adapter exists for this environment",
        "explanation": "The environment declares an execution mode JUNE cannot execute safely, so the run was stopped before any change.",
        "likely_causes": ["The environment mode was set manually", "A new mode was introduced without an adapter"],
        "suggested_steps": ["Set the environment mode to SIMULATION or LOCAL_SANDBOX until an adapter is registered."],
    },
    "VERIFICATION_FAILED": {
        "category": "Execution",
        "title": "Post-deployment verification failed",
        "explanation": "The deployed files did not match the recorded checksums, so the execution cannot be reported as successful.",
        "likely_causes": ["A file changed after deployment", "The deployment was incomplete"],
        "suggested_steps": ["Inspect the stage log for drifted files.", "Re-run the deployment from the approved candidate."],
    },
    "INVALID_INPUT": {
        "category": "Configuration",
        "title": "The inputs were invalid",
        "explanation": "A parameter did not satisfy the automation's published input schema.",
        "likely_causes": ["A value is outside its allowed range", "A required field is missing"],
        "suggested_steps": ["Review the form and correct the highlighted values.", "Re-run the execution with valid inputs."],
    },
    "STAGE_TIMEOUT": {
        "category": "Performance",
        "title": "The stage timed out",
        "explanation": "A stage exceeded the timeout configured for this automation.",
        "likely_causes": ["The target is slow or unresponsive", "The timeout is too short for the workload"],
        "suggested_steps": ["Check the target's responsiveness.", "Ask the automation owner to review the timeout."],
    },
    "AGENT_CHANNEL_NOT_CONFIGURED": {
        "category": "Integration",
        "title": "Remote production execution is not configured",
        "explanation": "This environment requires a registered execution agent, but no authenticated channel is available.",
        "likely_causes": ["No agent is registered for the production environment", "The agent is offline"],
        "suggested_steps": ["Register or restore the execution agent.", "Use the simulation environment for rehearsals until the agent is connected."],
    },
    "INTERRUPTED_BY_RESTART": {
        "category": "Platform",
        "title": "The platform restarted during execution",
        "explanation": "JUNE restarted while this execution was active, so it was marked failed rather than left in an ambiguous state.",
        "likely_causes": ["Scheduled deployment or maintenance", "Unexpected process exit"],
        "suggested_steps": ["Verify target state before retrying.", "Submit a new execution request."],
    },
}


def _insight(execution: Execution) -> dict | None:
    if execution.status == ExecutionStatus.SUCCEEDED:
        return None
    code = execution.error_code or ""
    rule = INSIGHT_RULES.get(code)
    if rule is None:
        rule = {
            "category": "Execution",
            "title": "The execution stopped unexpectedly",
            "explanation": execution.error_message or "No classified error is available for this execution.",
            "likely_causes": ["Inspect the stage logs for the first error line."],
            "suggested_steps": ["Review the failed stage and its logs.", "If the issue persists, contact the automation owner."],
        }
    return {"category": rule["category"], **rule, "deterministic": True}


def insight(db_execution: Execution) -> dict:
    return {"execution_id": db_execution.id, "status": db_execution.status, "insight": _insight(db_execution)}


async def approval_evidence_summary(db: AsyncSession, execution: Execution) -> dict:
    scans = []
    from app.models import SecurityScan

    result = await db.execute(select(SecurityScan).where(SecurityScan.execution_id == execution.id))
    for scan in result.scalars().all():
        scans.append(
            {
                "kind": scan.kind,
                "status": scan.status,
                "findings": len(scan.findings),
                "summary": scan.summary,
            }
        )
    return {"scans": scans}


async def expired_pending_approvals(db: AsyncSession) -> int:
    result = await db.execute(
        select(Approval).where(Approval.status == "PENDING", Approval.expires_at < datetime.now(UTC))
    )
    approvals = list(result.scalars().all())
    for approval in approvals:
        approval.status = "EXPIRED"
        approval.decision_reason = "The approval window expired before a decision was made."
    if approvals:
        await db.commit()
    return len(approvals)


async def recently_active(db: AsyncSession, since: timedelta) -> int:
    cutoff = utcnow() - since
    return int(
        (
            await db.execute(
                select(func.count(Execution.id)).where(
                    Execution.status.in_([ExecutionStatus.RUNNING, ExecutionStatus.QUEUED, ExecutionStatus.WAITING_FOR_APPROVAL]),
                    Execution.created_at >= cutoff,
                )
            )
        ).scalar_one()
    )


def execution_exists_or_raise(execution: Execution | None) -> Execution:
    if execution is None:
        raise not_found("Execution")
    return execution
