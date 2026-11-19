"""Execution state machine with a governed approval pause and live event fan-out."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import timedelta

from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.constants import (
    StageStatus,
    ExecutionStatus,
    TERMINAL_EXECUTION_STATUSES,
)
from app.core.database import SessionLocal, utcnow
from app.core.events import event_bus
from app.core.metrics import record_execution
from app.models import (
    Approval,
    Automation,
    AutomationVersion,
    Environment,
    Execution,
    ExecutionLog,
    ExecutionStage,
    ServerGroup,
    WorkflowVersion,
)
from app.services import audit_service, notification_service, policy_engine
from app.services.serializers import execution_detail
from app.api.deps import users_with_permission
from app.engine.runners import RunnerFailure, StageContext, build_result_summary, run_stage

logger = logging.getLogger("june.execution")

APPROVAL_WINDOW_HOURS = 24


class ExecutionEngine:
    def __init__(self) -> None:
        self._tasks: dict[str, asyncio.Task] = {}

    def schedule(self, execution_id: str) -> None:
        existing = self._tasks.get(execution_id)
        if existing and not existing.done():
            return
        task = asyncio.create_task(self._run_guarded(execution_id))
        self._tasks[execution_id] = task

        def _cleanup(_task: asyncio.Task) -> None:
            self._tasks.pop(execution_id, None)

        task.add_done_callback(_cleanup)

    async def _run_guarded(self, execution_id: str) -> None:
        try:
            await self._run(execution_id)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("execution_engine_crash", extra={"execution_id": execution_id})
            await self._fail_safely(
                execution_id,
                "ENGINE_CRASH",
                "The JUNE execution engine hit an unexpected error and stopped this execution. No further stages will run.",
            )

    async def _fail_safely(self, execution_id: str, code: str, message: str) -> None:
        """Last-resort failure handling so a crashed run never stays RUNNING forever."""
        try:
            async with SessionLocal() as db:
                execution = await db.get(Execution, execution_id)
                if execution is None or execution.status in TERMINAL_EXECUTION_STATUSES:
                    return
                finished = utcnow()
                execution.status = ExecutionStatus.FAILED
                execution.error_code = code
                execution.error_message = message
                execution.finished_at = finished
                if execution.started_at:
                    execution.duration_ms = int((finished - execution.started_at).total_seconds() * 1000)
                execution.result_summary = {
                    "headline": "Execution stopped. " + message,
                    "details": ["Submit a new execution request. If this repeats, contact the JUNE platform team."],
                    "blocked_reason": code,
                    "environment": execution.environment.name,
                    "simulated": execution.execution_mode == "SIMULATION",
                }
                for stage in execution.stages:
                    if stage.status in {StageStatus.RUNNING, StageStatus.WAITING_FOR_APPROVAL}:
                        stage.status = StageStatus.FAILED
                        stage.finished_at = finished
                        stage.error_message = message
                approval = (
                    await db.execute(select(Approval).where(Approval.execution_id == execution.id))
                ).scalar_one_or_none()
                if approval and approval.status == "PENDING":
                    approval.status = "INVALIDATED"
                    approval.decision_reason = "The execution stopped before a decision could be applied."
                await _log_db(db, execution, "ERROR", message)
                await audit_service.record(
                    db,
                    actor=None,
                    actor_label="JUNE execution engine",
                    action="execution.failed",
                    resource_type="execution",
                    resource_id=execution.id,
                    outcome="FAILED",
                    details={"display_id": execution.display_id, "code": code},
                )
                await notification_service.notify(
                    db,
                    execution.requested_by,
                    kind="EXECUTION_FAILED",
                    title=f"{execution.automation.name} needs attention",
                    body=f"Execution {execution.display_id} stopped: {message}",
                    resource_type="execution",
                    resource_id=execution.id,
                )
                await db.commit()
                await self._publish(execution)
            record_execution("FAILED")
            logger.error("execution_engine_recovered", extra={"execution_id": execution_id, "code": code})
        except Exception:
            logger.exception("execution_engine_recovery_failed", extra={"execution_id": execution_id})

    async def _publish(self, execution: Execution, kind: str = "execution") -> None:
        try:
            data = jsonable_encoder(execution_detail(execution))
            await event_bus.publish(f"execution:{execution.id}", {"type": kind, "data": data})
            await event_bus.publish(
                "pulse", {"type": "pulse", "data": {"execution_id": execution.id, "status": execution.status}}
            )
        except Exception:
            # Live fan-out is best-effort: a dropped stream must never fail a governed execution.
            logger.warning("execution_publish_failed", exc_info=True, extra={"execution_id": execution.id})

    async def _log(
        self,
        db: AsyncSession,
        execution: Execution,
        stage_key: str | None,
        level: str,
        message: str,
        source: str = "june",
    ) -> None:
        log = ExecutionLog(
            execution_id=execution.id,
            stage_key=stage_key,
            level=level,
            source=source,
            message=message,
            created_at=utcnow(),
        )
        db.add(log)
        await db.commit()
        try:
            await event_bus.publish(
                f"execution:{execution.id}",
                {
                    "type": "log",
                    "data": {
                        "id": log.id,
                        "execution_id": execution.id,
                        "stage_key": stage_key,
                        "level": level,
                        "source": source,
                        "message": message,
                        "created_at": log.created_at.isoformat(),
                    },
                },
            )
        except Exception:
            logger.warning("execution_log_publish_failed", exc_info=True, extra={"execution_id": execution.id})

    async def _run(self, execution_id: str) -> None:
        async with SessionLocal() as db:
            execution = await db.get(Execution, execution_id)
            if execution is None:
                return
            if execution.status in TERMINAL_EXECUTION_STATUSES:
                return
            automation: Automation = execution.automation
            environment: Environment = execution.environment
            version = (
                await db.execute(
                    select(AutomationVersion).where(
                        AutomationVersion.automation_id == automation.id,
                        AutomationVersion.version == execution.automation_version,
                    )
                )
            ).scalar_one_or_none()
            workflow_version = await db.get(WorkflowVersion, execution.workflow_version_id)
            if version is None or workflow_version is None:
                await self._fail(db, execution, "PACKAGE_MISSING", "The published automation or workflow version no longer exists.")
                return
            server_group: ServerGroup | None = None
            if execution.server_group_id:
                server_group = await db.get(ServerGroup, execution.server_group_id)
                if server_group is None:
                    # The candidate was approved against a specific group; silently retargeting would break that binding.
                    await self._fail(
                        db,
                        execution,
                        "TARGET_GROUP_MISSING",
                        "The server group bound to this candidate no longer exists. The execution was stopped rather than retargeted.",
                    )
                    return
            elif automation.supported_environments:
                server_group = (
                    await db.execute(select(ServerGroup).where(ServerGroup.environment_id == environment.id))
                ).scalars().first()

            if execution.status == ExecutionStatus.QUEUED:
                execution.status = ExecutionStatus.RUNNING
                execution.started_at = utcnow()
                await db.commit()
                await self._log(db, execution, None, "INFO", f"Execution {execution.display_id} started.", "june")
                await self._log(
                    db,
                    execution,
                    None,
                    "INFO",
                    f"Target: {environment.name} · mode {environment.execution_mode} · requested by {execution.requested_by_user.full_name}.",
                    "june",
                )
                await self._publish(execution)

            scratch = settings.sandbox_path / execution.display_id
            scratch.mkdir(parents=True, exist_ok=True)

            async def check_cancel() -> None:
                await db.refresh(execution)
                if execution.cancel_requested:
                    raise asyncio.CancelledError

            for stage in sorted(execution.stages, key=lambda item: item.order_index):
                await db.refresh(execution)
                if execution.cancel_requested:
                    await self._cancel(db, execution)
                    return
                if stage.status in {StageStatus.SUCCEEDED, StageStatus.SKIPPED}:
                    continue
                if stage.status == StageStatus.WAITING_FOR_APPROVAL:
                    should_continue = await self._handle_approval_gate(db, execution, stage, automation, workflow_version)
                    if not should_continue:
                        return
                    continue
                if stage.key == "approval_gate":
                    should_continue = await self._handle_approval_gate(db, execution, stage, automation, workflow_version)
                    if not should_continue:
                        return
                    continue
                if stage.key == "production_deploy" and environment.kind != "PRODUCTION":
                    stage.status = StageStatus.SKIPPED
                    stage.finished_at = utcnow()
                    await db.commit()
                    await self._log(db, execution, stage.key, "INFO", "Production deployment skipped: this execution targets " + environment.name + ".")
                    continue
                if stage.key == "uat_deploy" and environment.kind == "PRODUCTION":
                    pass  # Production requests still rehearse in the UAT sandbox first.

                stage.status = StageStatus.RUNNING
                stage.started_at = utcnow()
                await db.commit()
                await self._log(db, execution, stage.key, "INFO", f"Starting {stage.name}.")
                await self._publish(execution)

                if stage.key == "production_deploy":
                    await self._log(db, execution, stage.key, "INFO", "Re-evaluating production policy and approval evidence.")
                    approval = (
                        await db.execute(select(Approval).where(Approval.execution_id == execution.id))
                    ).scalar_one_or_none()
                    promotion = await policy_engine.evaluate_promotion(db, execution=execution, approval=approval)
                    for check in promotion.checks:
                        level = "INFO" if check["status"] == "PASS" else ("ERROR" if check["blocking"] else "WARN")
                        await self._log(db, execution, stage.key, level, f"{check['name']}: {check['message']}")
                    if not promotion.can_submit:
                        await self._policy_block(db, execution, stage, "PRODUCTION_POLICY_BLOCKED", promotion.blocking_issues)
                        return

                started = utcnow()
                ctx = StageContext(
                    db=db,
                    execution=execution,
                    automation=automation,
                    environment=environment,
                    stage=stage,
                    version=version,
                    server_group=server_group,
                    params=execution.params or {},
                    log=lambda level, message, stage_key=stage.key: self._log(
                        db, execution, stage_key, level, message, "runner"
                    ),
                    check_cancel=check_cancel,
                    scratch=scratch,
                )
                try:
                    output = await asyncio.wait_for(run_stage(ctx), timeout=execution.timeout_seconds)
                except asyncio.CancelledError:
                    stage.status = StageStatus.CANCELLED
                    await db.commit()
                    await self._cancel(db, execution)
                    return
                except TimeoutError:
                    await self._stage_failure(
                        db,
                        execution,
                        stage,
                        started,
                        RunnerFailure(
                            "STAGE_TIMEOUT",
                            f"{stage.name} exceeded the {execution.timeout_seconds}s stage timeout.",
                            "Increase the automation timeout or investigate the target responsiveness.",
                        ),
                        timeout=True,
                    )
                    return
                except RunnerFailure as failure:
                    await self._stage_failure(db, execution, stage, started, failure)
                    return
                except Exception as exc:
                    logger.exception("stage_crashed", extra={"execution_id": execution.id})
                    await self._stage_failure(
                        db,
                        execution,
                        stage,
                        started,
                        RunnerFailure(
                            "RUNNER_ERROR",
                            f"{stage.name} failed with an unexpected runner error ({exc.__class__.__name__}).",
                            "Check the platform logs and retry. If it persists, contact the JUNE platform team.",
                        ),
                    )
                    return

                stage.status = StageStatus.SUCCEEDED
                stage.finished_at = utcnow()
                stage.duration_ms = int((stage.finished_at - started).total_seconds() * 1000)
                stage.output = json.loads(json.dumps(output, default=str))
                await db.commit()
                await self._log(
                    db,
                    execution,
                    stage.key,
                    "SUCCESS",
                    f"{stage.name} completed in {stage.duration_ms} ms.",
                )
                await self._publish(execution, "stage")

            execution.status = ExecutionStatus.SUCCEEDED
            execution.finished_at = utcnow()
            if execution.started_at:
                execution.duration_ms = int((execution.finished_at - execution.started_at).total_seconds() * 1000)
            execution.result_summary = build_result_summary(execution)
            execution.error_code = None
            execution.error_message = None
            await self._log(db, execution, None, "SUCCESS", "Execution completed successfully.")
            await audit_service.record(
                db,
                actor=None,
                actor_label="JUNE execution engine",
                action="execution.completed",
                resource_type="execution",
                resource_id=execution.id,
                details={"display_id": execution.display_id, "status": "SUCCEEDED", "environment": environment.key},
            )
            await notification_service.notify(
                db,
                execution.requested_by,
                kind="EXECUTION_FINISHED",
                title=f"{automation.name} completed",
                body=f"Execution {execution.display_id} finished successfully in {environment.name}.",
                resource_type="execution",
                resource_id=execution.id,
            )
            await db.commit()
            record_execution("SUCCEEDED")
            await self._publish(execution)
            logger.info("execution_succeeded", extra={"execution_id": execution.id})

    async def _handle_approval_gate(
        self,
        db: AsyncSession,
        execution: Execution,
        stage: ExecutionStage,
        automation: Automation,
        workflow_version: WorkflowVersion,
    ) -> bool:
        if execution.environment.kind != "PRODUCTION":
            stage.status = StageStatus.SKIPPED
            stage.finished_at = utcnow()
            await db.commit()
            await self._log(db, execution, stage.key, "INFO", "Approval gate not required for this environment.")
            return True

        approval = (
            await db.execute(select(Approval).where(Approval.execution_id == execution.id))
        ).scalar_one_or_none()

        if approval is None:
            if automation.current_version != execution.automation_version:
                await self._policy_block(
                    db,
                    execution,
                    stage,
                    "VERSION_CHANGED",
                    ["A newer automation version was published while this execution was running."],
                )
                return False
            security_scans: list[dict] = []
            for scan_stage in execution.stages:
                if scan_stage.key == "security_scan" and isinstance(scan_stage.output, dict):
                    security_scans.extend(
                        scan for scan in scan_stage.output.get("scans", []) if isinstance(scan, dict)
                    )
            uat_outputs = {
                stage.key: stage.output
                for stage in execution.stages
                if stage.key in {"uat_deploy", "automated_test"} and stage.output
            }
            evidence = {
                "candidate": {
                    "hash": execution.candidate_hash,
                    "automation_version": execution.automation_version,
                    "environment": execution.environment.key,
                    "server_group": execution.server_group.name if execution.server_group else None,
                    "workflow_version": workflow_version.version,
                    "workflow_checksum": workflow_version.checksum,
                },
                "security": security_scans,
                "uat": uat_outputs,
                "risk_level": automation.risk_level,
                "systems_affected": automation.systems_affected,
                "what_could_go_wrong": automation.what_could_go_wrong,
                "impact": (
                    "This promotes the approved candidate to the production environment using the "
                    f"{execution.environment.execution_mode} adapter. "
                    + (
                        "The adapter is a simulation: no live system will be modified."
                        if execution.execution_mode == "SIMULATION"
                        else "The adapter targets the configured production execution plane."
                    )
                ),
            }
            approvers = await users_with_permission(db, "approvals:decide")
            approval = Approval(
                execution_id=execution.id,
                automation_id=automation.id,
                requested_by=execution.requested_by,
                candidate_hash=execution.candidate_hash,
                automation_version=execution.automation_version,
                workflow_version_id=workflow_version.id,
                environment_id=execution.environment_id,
                status="PENDING",
                evidence=evidence,
                expires_at=utcnow() + timedelta(hours=APPROVAL_WINDOW_HOURS),
            )
            db.add(approval)
            stage.status = StageStatus.WAITING_FOR_APPROVAL
            execution.status = ExecutionStatus.WAITING_FOR_APPROVAL
            await db.flush()
            approval_id = approval.id
            await audit_service.record(
                db,
                actor=None,
                actor_label=execution.requested_by_user.full_name,
                action="approval.requested",
                resource_type="approval",
                resource_id=approval_id,
                details={
                    "execution": execution.display_id,
                    "candidate_hash": execution.candidate_hash,
                    "environment": execution.environment.key,
                },
            )
            await notification_service.notify_many(
                db,
                [user.id for user in approvers],
                kind="APPROVAL_REQUESTED",
                title=f"Approval required: {automation.name}",
                body=f"{execution.requested_by_user.full_name} requested a production run ({execution.display_id}). Review the bound candidate evidence.",
                resource_type="approval",
                resource_id=approval_id,
            )
            await db.commit()
            await self._log(
                db,
                execution,
                stage.key,
                "WARN",
                "Production execution paused. Waiting for an authorized approver who is not the requester.",
            )
            await self._publish(execution, "approval")
            return False

        if approval.status == "APPROVED":
            if approval.candidate_hash != execution.candidate_hash or approval.decided_by == execution.requested_by:
                approval.status = "INVALIDATED"
                await db.commit()
                await self._policy_block(
                    db, execution, stage, "APPROVAL_INVALIDATED", ["The approval is not valid for this candidate."]
                )
                return False
            stage.status = StageStatus.SUCCEEDED
            stage.started_at = stage.started_at or utcnow()
            stage.finished_at = utcnow()
            stage.duration_ms = int((stage.finished_at - stage.started_at).total_seconds() * 1000)
            stage.output = {
                "approval_id": approval.id,
                "approved_by": approval.decided_by,
                "candidate_hash": approval.candidate_hash,
            }
            execution.status = ExecutionStatus.RUNNING
            await db.commit()
            await self._log(db, execution, stage.key, "SUCCESS", "Approval verified. Continuing to the production deployment stage.")
            await self._publish(execution)
            return True

        if approval.status == "PENDING":
            execution.status = ExecutionStatus.WAITING_FOR_APPROVAL
            stage.status = StageStatus.WAITING_FOR_APPROVAL
            await db.commit()
            await self._publish(execution)
            return False

        outcome = {
            "REJECTED": (
                "APPROVAL_REJECTED",
                "Production deployment was rejected by the approver.",
                "Read the approver's comment, address the concern and submit a new production request.",
            ),
            "EXPIRED": (
                "APPROVAL_EXPIRED",
                "The production approval window expired before a decision was made.",
                "Submit a new production request if the change is still needed.",
            ),
            "INVALIDATED": (
                "APPROVAL_INVALIDATED",
                "The approval was invalidated because the candidate or automation version changed.",
                "Submit a new production request against the current version.",
            ),
        }.get(
            approval.status,
            (
                "APPROVAL_INVALID",
                f"The approval is {approval.status.lower()} and cannot be used for promotion.",
                "Submit a new production request.",
            ),
        )
        await self._stage_failure(
            db,
            execution,
            stage,
            stage.started_at or utcnow(),
            RunnerFailure(outcome[0], outcome[1], outcome[2]),
        )
        return False

    async def _stage_failure(
        self,
        db: AsyncSession,
        execution: Execution,
        stage: ExecutionStage,
        started,
        failure: RunnerFailure,
        *,
        timeout: bool = False,
    ) -> None:
        finished = utcnow()
        stage.status = StageStatus.FAILED
        stage.finished_at = finished
        stage.duration_ms = int((finished - started).total_seconds() * 1000)
        stage.error_message = failure.message
        execution.error_code = failure.code
        execution.error_message = failure.message
        execution.finished_at = finished
        if execution.started_at:
            execution.duration_ms = int((finished - execution.started_at).total_seconds() * 1000)
        blocked_codes = {
            "SECURITY_BLOCKED",
            "APPROVAL_INVALID",
            "APPROVAL_REJECTED",
            "APPROVAL_EXPIRED",
            "APPROVAL_INVALIDATED",
            "PRODUCTION_POLICY_BLOCKED",
            "VERSION_CHANGED",
        }
        execution.status = ExecutionStatus.TIMED_OUT if timeout else (
            ExecutionStatus.BLOCKED if failure.code in blocked_codes else ExecutionStatus.FAILED
        )
        execution.result_summary = {
            "headline": "Execution stopped. " + failure.message,
            "details": [failure.guidance] if failure.guidance else [],
            "blocked_reason": failure.code,
            "environment": execution.environment.name,
            "simulated": execution.execution_mode == "SIMULATION",
        }
        await self._log(db, execution, stage.key, "ERROR", failure.message)
        if failure.guidance:
            await self._log(db, execution, stage.key, "INFO", f"Next step: {failure.guidance}")
        await audit_service.record(
            db,
            actor=None,
            actor_label="JUNE execution engine",
            action="execution.failed",
            resource_type="execution",
            resource_id=execution.id,
            outcome="FAILED",
            details={"display_id": execution.display_id, "code": failure.code, "stage": stage.key},
        )
        await notification_service.notify(
            db,
            execution.requested_by,
            kind="EXECUTION_FAILED",
            title=f"{execution.automation.name} needs attention",
            body=f"Execution {execution.display_id} stopped: {failure.message}",
            resource_type="execution",
            resource_id=execution.id,
        )
        await db.commit()
        record_execution(execution.status)
        await self._publish(execution)
        logger.warning("execution_failed", extra={"execution_id": execution.id, "action": failure.code})

    async def _policy_block(
        self, db: AsyncSession, execution: Execution, stage: ExecutionStage, code: str, reasons: list[str]
    ) -> None:
        await self._stage_failure(
            db,
            execution,
            stage,
            stage.started_at or utcnow(),
            RunnerFailure(code, "Production policy blocked this execution. " + " ".join(reasons)),
        )

    async def _cancel(self, db: AsyncSession, execution: Execution) -> None:
        execution.status = ExecutionStatus.CANCELLED
        execution.finished_at = utcnow()
        if execution.started_at:
            execution.duration_ms = int((execution.finished_at - execution.started_at).total_seconds() * 1000)
        for stage in execution.stages:
            if stage.status in {StageStatus.RUNNING, StageStatus.WAITING_FOR_APPROVAL}:
                stage.status = StageStatus.CANCELLED
                stage.finished_at = utcnow()
        approval = (await db.execute(select(Approval).where(Approval.execution_id == execution.id))).scalar_one_or_none()
        if approval and approval.status == "PENDING":
            approval.status = "INVALIDATED"
            approval.decision_reason = "Execution cancelled by the requester."
        await audit_service.record(
            db,
            actor=None,
            actor_label="JUNE execution engine",
            action="execution.cancelled",
            resource_type="execution",
            resource_id=execution.id,
            details={"display_id": execution.display_id},
        )
        await db.commit()
        await self._log(db, execution, None, "WARN", "Execution cancelled. No further stages will run.")
        record_execution("CANCELLED")
        await self._publish(execution)
        logger.info("execution_cancelled", extra={"execution_id": execution.id})

    async def _fail(self, db: AsyncSession, execution: Execution, code: str, message: str) -> None:
        finished = utcnow()
        execution.status = ExecutionStatus.FAILED
        execution.error_code = code
        execution.error_message = message
        execution.finished_at = finished
        if execution.started_at:
            execution.duration_ms = int((finished - execution.started_at).total_seconds() * 1000)
        execution.result_summary = {
            "headline": "Execution stopped. " + message,
            "details": ["Submit a new execution request once the underlying cause is fixed."],
            "blocked_reason": code,
            "environment": execution.environment.name,
            "simulated": execution.execution_mode == "SIMULATION",
        }
        for stage in execution.stages:
            if stage.status in {StageStatus.RUNNING, StageStatus.WAITING_FOR_APPROVAL}:
                stage.status = StageStatus.FAILED
                stage.finished_at = finished
                stage.error_message = message
        await self._log(db, execution, None, "ERROR", message)
        await audit_service.record(
            db,
            actor=None,
            actor_label="JUNE execution engine",
            action="execution.failed",
            resource_type="execution",
            resource_id=execution.id,
            outcome="FAILED",
            details={"display_id": execution.display_id, "code": code},
        )
        await notification_service.notify(
            db,
            execution.requested_by,
            kind="EXECUTION_FAILED",
            title=f"{execution.automation.name} needs attention",
            body=f"Execution {execution.display_id} stopped: {message}",
            resource_type="execution",
            resource_id=execution.id,
        )
        await db.commit()
        record_execution("FAILED")
        await self._publish(execution)


engine = ExecutionEngine()


async def _log_db(db: AsyncSession, execution: Execution, level: str, message: str) -> None:
    db.add(
        ExecutionLog(
            execution_id=execution.id,
            level=level,
            source="june",
            message=message,
            created_at=utcnow(),
        )
    )
    await db.flush()


async def reconcile_interrupted_executions() -> int:
    """A restart cannot leave executions stuck in RUNNING/QUEUED forever."""
    async with SessionLocal() as db:
        result = await db.execute(
            select(Execution).where(Execution.status.in_([ExecutionStatus.RUNNING, ExecutionStatus.QUEUED]))
        )
        executions = list(result.scalars().all())
        for execution in executions:
            execution.status = ExecutionStatus.FAILED
            execution.error_code = "INTERRUPTED_BY_RESTART"
            execution.error_message = "The JUNE execution engine restarted while this execution was active."
            execution.finished_at = utcnow()
            await _log_db(db, execution, "ERROR", "Execution interrupted by a platform restart. Request a new execution.")
            await audit_service.record(
                db,
                actor=None,
                actor_label="JUNE execution engine",
                action="execution.interrupted",
                resource_type="execution",
                resource_id=execution.id,
                outcome="FAILED",
                details={"display_id": execution.display_id},
            )
        if executions:
            await db.commit()
        return len(executions)
