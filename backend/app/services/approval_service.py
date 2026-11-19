"""Production approval workflow with separation of duties and immutable candidates."""

from __future__ import annotations

from datetime import UTC

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.constants import ExecutionStatus, ScanStatus, StageStatus
from app.core.database import utcnow
from app.core.errors import conflict, forbidden, not_found
from app.models import Approval, Automation, Environment, Execution, ExecutionLog, SecurityScan, User
from app.services import audit_service, notification_service
from app.services.serializers import approval_out, execution_summary
from app.engine.executor import engine


async def list_approvals(
    db: AsyncSession,
    *,
    status: str | None = "PENDING",
    environment: str | None = None,
    mine: bool = False,
    user: User | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[dict], int]:
    query = select(Approval).options(selectinload(Approval.execution))
    if status and status != "ALL":
        query = query.where(Approval.status == status)
    if environment:
        query = query.join(Environment, Environment.id == Approval.environment_id).where(Environment.key == environment)
    if mine and user:
        query = query.where(Approval.requested_by == user.id)
    total = int((await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one())
    query = query.order_by(Approval.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    approvals = list((await db.execute(query)).scalars().all())
    return [approval_out(approval) for approval in approvals], total


async def get_approval(db: AsyncSession, approval_id: str, *, lock: bool = False) -> Approval:
    query = select(Approval).options(selectinload(Approval.execution)).where(Approval.id == approval_id)
    if lock:
        # PostgreSQL takes a row lock so two approvers cannot decide the same request concurrently.
        query = query.with_for_update()
    approval = (await db.execute(query)).scalar_one_or_none()
    if not approval:
        raise not_found("Approval")
    return approval


async def _release_expired_execution(db: AsyncSession, approval: Approval) -> None:
    """Expiring an approval must also release the waiting execution, or it would stay paused forever."""
    execution = await db.get(Execution, approval.execution_id)
    if execution is None or execution.status != ExecutionStatus.WAITING_FOR_APPROVAL:
        return
    finished = utcnow()
    execution.status = ExecutionStatus.FAILED
    execution.error_code = "APPROVAL_EXPIRED"
    execution.error_message = "The production approval window expired before a decision was made."
    execution.finished_at = finished
    if execution.started_at:
        execution.duration_ms = int((finished - execution.started_at).total_seconds() * 1000)
    execution.result_summary = {
        "headline": "Execution stopped. " + execution.error_message,
        "details": ["Submit a new production request if the change is still needed."],
        "blocked_reason": "APPROVAL_EXPIRED",
        "environment": execution.environment.name,
        "simulated": execution.execution_mode == "SIMULATION",
    }
    for stage in execution.stages:
        if stage.status == StageStatus.WAITING_FOR_APPROVAL:
            stage.status = StageStatus.FAILED
            stage.finished_at = finished
            stage.error_message = execution.error_message
    db.add(
        ExecutionLog(
            execution_id=execution.id,
            stage_key="approval_gate",
            level="ERROR",
            source="approval",
            message=execution.error_message,
            created_at=finished,
        )
    )
    await audit_service.record(
        db,
        actor=None,
        actor_label="JUNE approval service",
        action="approval.expired",
        resource_type="approval",
        resource_id=approval.id,
        outcome="EXPIRED",
        details={"execution": execution.display_id, "candidate_hash": approval.candidate_hash},
    )
    await notification_service.notify(
        db,
        approval.requested_by,
        kind="EXECUTION_FAILED",
        title=f"Approval expired: {approval.automation.name}",
        body=f"Execution {execution.display_id} stopped because the approval window expired. Submit a new request if it is still needed.",
        resource_type="execution",
        resource_id=execution.id,
    )


async def _validate_decision(db: AsyncSession, approval: Approval, actor: User) -> None:
    if approval.status != "PENDING":
        raise conflict(f"This approval is already {approval.status.lower()}.")
    if approval.requested_by == actor.id:
        raise forbidden(
            "Separation of duties prevents you from approving your own production request.",
            {"policy": "requester_cannot_approve", "approval_id": approval.id},
        )
    if approval.expires_at:
        expires = (
            approval.expires_at.astimezone(UTC)
            if approval.expires_at.tzinfo
            else approval.expires_at.replace(tzinfo=UTC)
        )
        if expires < utcnow():
            approval.status = "EXPIRED"
            approval.decision_reason = "The approval window expired before a decision was made."
            await _release_expired_execution(db, approval)
            await db.commit()
            raise conflict("This approval window has expired. The requester must submit a new request.")

    automation = await db.get(Automation, approval.automation_id)
    execution = await db.get(Execution, approval.execution_id)
    if not automation or not execution:
        approval.status = "INVALIDATED"
        await db.commit()
        raise conflict("The approval is no longer linked to a valid automation and execution.")
    if automation.current_version != approval.automation_version:
        approval.status = "INVALIDATED"
        approval.decision_reason = "A newer automation version was published; the approval no longer applies."
        await db.commit()
        raise conflict(
            "This approval is invalid because a newer automation version was published.",
            {"approved_version": approval.automation_version, "current_version": automation.current_version},
        )
    if execution.status in {ExecutionStatus.CANCELLED, ExecutionStatus.FAILED, ExecutionStatus.TIMED_OUT}:
        approval.status = "INVALIDATED"
        await db.commit()
        raise conflict("The underlying execution is no longer waiting for approval.")
    if approval.candidate_hash != execution.candidate_hash:
        approval.status = "INVALIDATED"
        await db.commit()
        raise conflict("The candidate changed after this approval was requested.")


async def _evidence_ready(db: AsyncSession, approval: Approval) -> list[str]:
    execution = await db.get(Execution, approval.execution_id)
    problems: list[str] = []
    scans = list(
        (
            await db.execute(
                select(SecurityScan).where(
                    SecurityScan.execution_id == approval.execution_id,
                    SecurityScan.kind.in_(["SECRETS", "DEPENDENCIES"]),
                )
            )
        )
        .scalars()
        .all()
    )
    if not scans or any(scan.status != ScanStatus.PASSED for scan in scans):
        problems.append("Required security scans have not passed for this candidate.")
    stage_map = {stage.key: stage for stage in execution.stages} if execution else {}
    if "automated_test" in stage_map and stage_map["automated_test"].status != StageStatus.SUCCEEDED:
        problems.append("The automated test stage has not succeeded.")
    if "uat_deploy" in stage_map and stage_map["uat_deploy"].status != StageStatus.SUCCEEDED:
        problems.append("The UAT deployment has not succeeded.")
    return problems


async def approve(db: AsyncSession, actor: User, approval_id: str, *, comment: str, reason: str) -> Approval:
    approval = await get_approval(db, approval_id, lock=True)
    await _validate_decision(db, approval, actor)
    problems = await _evidence_ready(db, approval)
    if problems:
        raise conflict("The candidate is missing required evidence. Approval cannot be recorded.", problems)

    approval.status = "APPROVED"
    approval.decided_by = actor.id
    approval.decided_at = utcnow()
    approval.comment = comment
    approval.decision_reason = reason
    execution = await db.get(Execution, approval.execution_id)
    execution.status = ExecutionStatus.RUNNING
    await db.flush()
    await audit_service.record(
        db,
        actor=actor,
        action="approval.approved",
        resource_type="approval",
        resource_id=approval.id,
        details={
            "execution": execution.display_id,
            "candidate_hash": approval.candidate_hash,
            "automation_version": approval.automation_version,
            "comment": comment,
            "separation_of_duties": True,
        },
    )
    await notification_service.notify(
        db,
        approval.requested_by,
        kind="APPROVAL_DECIDED",
        title=f"Approved: {approval.automation.name}",
        body=f"{actor.full_name} approved {execution.display_id}. The exact candidate will now be promoted.",
        resource_type="execution",
        resource_id=execution.id,
    )
    await db.commit()
    engine.schedule(execution.id)
    return approval


async def reject(db: AsyncSession, actor: User, approval_id: str, *, comment: str, reason: str) -> Approval:
    approval = await get_approval(db, approval_id, lock=True)
    await _validate_decision(db, approval, actor)

    approval.status = "REJECTED"
    approval.decided_by = actor.id
    approval.decided_at = utcnow()
    approval.comment = comment
    approval.decision_reason = reason
    execution = await db.get(Execution, approval.execution_id)
    execution.status = ExecutionStatus.BLOCKED
    execution.error_code = "APPROVAL_REJECTED"
    execution.error_message = f"Production deployment rejected by {actor.full_name}."
    execution.finished_at = utcnow()
    if execution.started_at:
        execution.duration_ms = int((execution.finished_at - execution.started_at).total_seconds() * 1000)
    for stage in execution.stages:
        if stage.status == StageStatus.WAITING_FOR_APPROVAL:
            stage.status = StageStatus.FAILED
            stage.finished_at = utcnow()
            stage.error_message = execution.error_message
    db.add(
        ExecutionLog(
            execution_id=execution.id,
            stage_key="approval_gate",
            level="ERROR",
            source="approval",
            message=f"Approval rejected by {actor.full_name}. {comment}",
            created_at=utcnow(),
        )
    )
    await db.flush()
    await audit_service.record(
        db,
        actor=actor,
        action="approval.rejected",
        resource_type="approval",
        resource_id=approval.id,
        outcome="REJECTED",
        details={
            "execution": execution.display_id,
            "candidate_hash": approval.candidate_hash,
            "comment": comment,
            "reason": reason,
        },
    )
    await notification_service.notify(
        db,
        approval.requested_by,
        kind="APPROVAL_DECIDED",
        title=f"Rejected: {approval.automation.name}",
        body=f"{actor.full_name} rejected {execution.display_id}. Production promotion was prevented.",
        resource_type="approval",
        resource_id=approval.id,
    )
    await db.commit()
    return approval


async def expire_approvals(db: AsyncSession) -> int:
    """Expire overdue approvals and release their executions with an honest failure."""
    expired = list(
        (
            await db.execute(
                select(Approval).where(Approval.status == "PENDING", Approval.expires_at < utcnow())
            )
        )
        .scalars()
        .all()
    )
    for approval in expired:
        approval.status = "EXPIRED"
        approval.decision_reason = "The approval window expired before a decision was made."
        await _release_expired_execution(db, approval)
    # Self-heal: an approval may have expired through the decision path while its execution stayed paused.
    stale = list(
        (
            await db.execute(
                select(Approval)
                .join(Execution, Execution.id == Approval.execution_id)
                .where(Approval.status == "EXPIRED", Execution.status == ExecutionStatus.WAITING_FOR_APPROVAL)
            )
        )
        .scalars()
        .all()
    )
    for approval in stale:
        await _release_expired_execution(db, approval)
    if expired or stale:
        await db.commit()
    return len(expired)


async def pending_for_automation(db: AsyncSession, automation_id: str) -> list[Approval]:
    result = await db.execute(
        select(Approval).where(Approval.automation_id == automation_id, Approval.status == "PENDING")
    )
    return list(result.scalars().all())


async def invalidate_for_automation(db: AsyncSession, automation_id: str, reason: str) -> int:
    approvals = await pending_for_automation(db, automation_id)
    for approval in approvals:
        approval.status = "INVALIDATED"
        approval.decision_reason = reason
    if approvals:
        await db.flush()
    return len(approvals)


def approval_summary(approval: Approval) -> dict:
    return approval_out(approval)


def execution_brief(execution: Execution) -> dict:
    return execution_summary(execution)
