"""ORM → API serializers. Keeps computed fields (progress, current stage) in one place."""

from __future__ import annotations

from app.core.constants import ExecutionStatus, StageStatus, TERMINAL_EXECUTION_STATUSES
from app.models import (
    Approval,
    AuditEvent,
    Automation,
    AutomationVersion,
    Environment,
    Execution,
    Integration,
    SecurityFinding,
    SecurityScan,
    User,
    Workflow,
    WorkflowVersion,
)


def user_tiny(user: User | None) -> dict | None:
    if user is None:
        return None
    return {"id": user.id, "full_name": user.full_name, "email": user.email, "title": user.title}


def environment_mini(environment: Environment) -> dict:
    return {
        "id": environment.id,
        "key": environment.key,
        "name": environment.name,
        "kind": environment.kind,
        "execution_mode": environment.execution_mode,
        "approval_required": environment.approval_required or environment.kind == "PRODUCTION",
        "color": environment.color,
    }


def automation_mini(automation: Automation) -> dict:
    return {
        "id": automation.id,
        "slug": automation.slug,
        "name": automation.name,
        "icon": automation.icon,
        "category": automation.category,
        "risk_level": automation.risk_level,
        "current_version": automation.current_version,
    }


def automation_summary(automation: Automation, stats: dict | None = None) -> dict:
    stats = stats or {}
    return {
        "id": automation.id,
        "slug": automation.slug,
        "name": automation.name,
        "summary": automation.summary,
        "category": automation.category,
        "icon": automation.icon,
        "risk_level": automation.risk_level,
        "status": automation.status,
        "tags": automation.tags or [],
        "supported_environments": automation.supported_environments or [],
        "current_version": automation.current_version,
        "approval_required": automation.approval_required,
        "timeout_seconds": automation.timeout_seconds,
        "is_sample": automation.is_sample,
        "owner": user_tiny(automation.owner),
        "team_name": automation.team.name if automation.team else None,
        "created_at": automation.created_at,
        "updated_at": automation.updated_at,
        "execution_count": stats.get("execution_count", 0),
        "success_rate": stats.get("success_rate"),
        "last_execution_at": stats.get("last_execution_at"),
        "last_execution_status": stats.get("last_execution_status"),
    }


def version_out(version: AutomationVersion) -> dict:
    return {
        "id": version.id,
        "version": version.version,
        "checksum": version.checksum,
        "changelog": version.changelog,
        "status": version.status,
        "created_at": version.created_at,
        "created_by": version.creator.full_name if version.creator else None,
        "manifest": version.manifest,
    }


def workflow_version_out(version: WorkflowVersion) -> dict:
    return {
        "id": version.id,
        "version": version.version,
        "checksum": version.checksum,
        "status": version.status,
        "published_at": version.published_at,
        "definition": version.definition,
    }


def workflow_out(workflow: Workflow) -> dict:
    published = [v for v in workflow.versions if v.status == "PUBLISHED"]
    versions = published[:1] if published else workflow.versions[:1]
    return {
        "id": workflow.id,
        "name": workflow.name,
        "description": workflow.description,
        "status": workflow.status,
        "is_default": workflow.is_default,
        "automation_id": workflow.automation_id,
        "versions": [workflow_version_out(v) for v in versions],
    }


def automation_detail(automation: Automation, workflow: Workflow | None = None) -> dict:
    data = automation_summary(automation)
    data.update(
        {
            "what_it_does": automation.what_it_does,
            "why_it_exists": automation.why_it_exists,
            "when_to_use": automation.when_to_use,
            "expected_output": automation.expected_output,
            "what_could_go_wrong": automation.what_could_go_wrong,
            "failure_guidance": automation.failure_guidance,
            "systems_affected": automation.systems_affected or [],
            "required_permissions": automation.required_permissions or [],
            "language": automation.language,
            "execution_type": automation.execution_type,
            "runner_key": automation.runner_key,
            "input_schema": automation.input_schema or {},
            "output_schema": automation.output_schema or {},
            "concurrency_limit": automation.concurrency_limit,
            "repository_path": automation.repository_path,
            "repository": (
                {
                    "id": automation.repository.id,
                    "name": automation.repository.name,
                    "provider": automation.repository.provider,
                    "url": automation.repository.url,
                    "default_branch": automation.repository.default_branch,
                    "status": automation.repository.status,
                    "last_synced_at": automation.repository.last_synced_at,
                }
                if automation.repository
                else None
            ),
            "versions": [version_out(v) for v in automation.versions],
            "workflow": workflow_out(workflow) if workflow else None,
        }
    )
    return data


def stage_out(stage) -> dict:
    return {
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


def execution_progress(execution: Execution) -> tuple[str | None, int]:
    stages = execution.stages
    if not stages:
        return None, 0
    active = next((s for s in stages if s.status in {StageStatus.RUNNING, StageStatus.WAITING_FOR_APPROVAL}), None)
    current = active.name if active else None
    done = sum(1 for s in stages if s.status in {StageStatus.SUCCEEDED, StageStatus.SKIPPED})
    return current, round(done / len(stages) * 100)


def approval_mini(approval: Approval | None) -> dict | None:
    if approval is None:
        return None
    return {
        "id": approval.id,
        "status": approval.status,
        "requested_by": approval.requested_by,
        "decided_by": approval.decided_by,
        "candidate_hash": approval.candidate_hash,
        "comment": approval.comment,
        "created_at": approval.created_at,
        "decided_at": approval.decided_at,
    }


def execution_summary(execution: Execution) -> dict:
    current_stage, progress = execution_progress(execution)
    return {
        "id": execution.id,
        "display_id": execution.display_id,
        "automation": automation_mini(execution.automation),
        "automation_version": execution.automation_version,
        "requested_by_user": user_tiny(execution.requested_by_user),
        "environment": environment_mini(execution.environment),
        "server_group": (
            {
                "id": execution.server_group.id,
                "name": execution.server_group.name,
                "slug": execution.server_group.slug,
                "check_protocol": execution.server_group.check_protocol,
            }
            if execution.server_group
            else None
        ),
        "status": execution.status,
        "execution_mode": execution.execution_mode,
        "adapter": execution.adapter,
        "reason": execution.reason,
        "created_at": execution.created_at,
        "started_at": execution.started_at,
        "finished_at": execution.finished_at,
        "duration_ms": execution.duration_ms,
        "current_stage": current_stage,
        "progress": progress,
        "error_code": execution.error_code,
        "error_message": execution.error_message,
    }


def execution_detail(execution: Execution) -> dict:
    data = execution_summary(execution)
    data.update(
        {
            "workflow_version_id": execution.workflow_version_id,
            "params": execution.params or {},
            "candidate_hash": execution.candidate_hash,
            "timeout_seconds": execution.timeout_seconds,
            "cancel_requested": execution.cancel_requested,
            "result_summary": execution.result_summary or {},
            "stages": [stage_out(s) for s in execution.stages],
            "approval": approval_mini(execution.approval),
        }
    )
    return data


def _normalise_evidence(evidence: dict | None) -> dict:
    data = dict(evidence or {})
    security = data.get("security")
    if isinstance(security, list):
        flat: list[dict] = []
        for item in security:
            if not isinstance(item, dict):
                continue
            if isinstance(item.get("scans"), list):
                flat.extend(scan for scan in item["scans"] if isinstance(scan, dict))
            elif "kind" in item:
                flat.append(item)
        data["security"] = flat
    return data


def approval_out(approval: Approval) -> dict:
    return {
        "id": approval.id,
        "status": approval.status,
        "automation": automation_mini(approval.automation),
        "automation_version": approval.automation_version,
        "candidate_hash": approval.candidate_hash,
        "requested_by": approval.requested_by,
        "requester": user_tiny(approval.requester),
        "decided_by": approval.decided_by,
        "decider": user_tiny(approval.decider),
        "environment": environment_mini(approval.environment),
        "comment": approval.comment,
        "decision_reason": approval.decision_reason,
        "evidence": _normalise_evidence(approval.evidence),
        "created_at": approval.created_at,
        "decided_at": approval.decided_at,
        "expires_at": approval.expires_at,
        "execution": execution_summary(approval.execution) if approval.execution else None,
    }


def finding_out(finding: SecurityFinding) -> dict:
    return {
        "id": finding.id,
        "severity": finding.severity,
        "title": finding.title,
        "description": finding.description,
        "file_path": finding.file_path,
        "line_number": finding.line_number,
        "rule_id": finding.rule_id,
        "remediation": finding.remediation,
        "status": finding.status,
    }


def scan_out(scan: SecurityScan) -> dict:
    return {
        "id": scan.id,
        "automation": automation_mini(scan.automation),
        "automation_version": scan.automation_version,
        "kind": scan.kind,
        "status": scan.status,
        "scanner": scan.scanner,
        "summary": scan.summary or {},
        "artifact_path": scan.artifact_path,
        "started_at": scan.started_at,
        "finished_at": scan.finished_at,
        "created_at": scan.created_at,
        "findings": [finding_out(f) for f in scan.findings],
    }


def audit_out(event: AuditEvent) -> dict:
    return {
        "id": event.id,
        "actor_id": event.actor_id,
        "actor_label": event.actor_label,
        "action": event.action,
        "resource_type": event.resource_type,
        "resource_id": event.resource_id,
        "outcome": event.outcome,
        "details": event.details or {},
        "ip_address": event.ip_address,
        "prev_hash": event.prev_hash,
        "hash": event.hash,
        "created_at": event.created_at,
    }


def integration_out(integration: Integration) -> dict:
    return {
        "id": integration.id,
        "key": integration.key,
        "name": integration.name,
        "category": integration.category,
        "description": integration.description,
        "setup_hint": integration.setup_hint,
        "docs_url": integration.docs_url,
        "status": integration.status,
        "config": integration.config or {},
        "message": integration.message,
        "last_checked_at": integration.last_checked_at,
    }


def execution_stats(executions: list[tuple[str, str | None, object]]) -> dict:
    """Stats from (status, finished_at, created_at) tuples."""
    total = len(executions)
    succeeded = sum(1 for status, _, _ in executions if status == ExecutionStatus.SUCCEEDED)
    terminal = sum(1 for status, _, _ in executions if status in TERMINAL_EXECUTION_STATUSES)
    last_at = max((created for _, _, created in executions), default=None)
    last_status = executions[0][0] if executions else None
    return {
        "execution_count": total,
        "success_rate": round(succeeded / terminal * 100, 1) if terminal else None,
        "last_execution_at": last_at,
        "last_execution_status": last_status,
    }
