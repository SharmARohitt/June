"""Server-side authorization and deployment policy evaluation.

Frontend checks are never trusted. Every execution request and every production
promotion is evaluated here against the actor, environment, automation, current
version and available evidence.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.constants import (
    ROLE_PERMISSIONS,
    Permission,
    StageStatus,
    ExecutionStatus,
    ScanStatus,
)
from app.models import Approval, Automation, Environment, Execution, ExecutionStage, SecurityScan, User


@dataclass
class PolicyResult:
    checks: list[dict] = field(default_factory=list)
    requires_approval: bool = False
    evaluated_by: str = "JUNE built-in rule engine"

    def add(self, key: str, name: str, passed: bool, message: str, *, severity: str = "BLOCK", blocking: bool = True) -> None:
        self.checks.append(
            {
                "key": key,
                "name": name,
                "status": "PASS" if passed else ("FAIL" if blocking else "WARN"),
                "severity": severity,
                "message": message,
                "blocking": (not passed) and blocking,
            }
        )

    def info(self, key: str, name: str, message: str, status: str = "PASS", severity: str = "INFO") -> None:
        self.checks.append(
            {"key": key, "name": name, "status": status, "severity": severity, "message": message, "blocking": False}
        )

    @property
    def blocking_issues(self) -> list[str]:
        return [check["message"] for check in self.checks if check["blocking"]]

    @property
    def can_submit(self) -> bool:
        return not self.blocking_issues


async def _opa_check(payload: dict) -> dict | None:
    if not settings.opa_url:
        return None
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            response = await client.post(
                f"{settings.opa_url.rstrip('/')}/v1/data/june/execution/decision",
                json={"input": payload},
            )
        if response.status_code >= 400:
            return {"available": False, "message": f"OPA returned HTTP {response.status_code}."}
        result = response.json().get("result", {})
        return {"available": True, "allow": bool(result.get("allow", False)), "reasons": result.get("reasons", [])}
    except Exception as exc:  # fail closed, never silently allow
        return {"available": False, "message": f"OPA unreachable: {exc.__class__.__name__}."}


async def evaluate_execution_request(
    db: AsyncSession,
    *,
    automation: Automation,
    environment: Environment,
    user: User,
    server_group_id: str | None,
    params: dict,
) -> PolicyResult:
    result = PolicyResult()

    result.add(
        "automation_active",
        "Automation is active",
        automation.status == "ACTIVE",
        "Automation is archived and cannot be executed." if automation.status != "ACTIVE" else "Automation is active.",
    )
    supported = automation.supported_environments or []
    env_supported = not supported or environment.key in supported
    result.add(
        "environment_supported",
        "Environment is supported",
        env_supported,
        f"{automation.name} is not published for {environment.name}."
        if not env_supported
        else f"{environment.name} is an approved target for this automation.",
    )
    result.add(
        "environment_active",
        "Environment is available",
        environment.is_active,
        "Environment is disabled by an administrator." if not environment.is_active else "Environment is enabled.",
    )

    has_execute = Permission.EXECUTIONS_CREATE.value in user.permissions
    result.add(
        "execution_permission",
        "Your role can request executions",
        has_execute,
        "Your role does not include the execution permission."
        if not has_execute
        else "Your role includes the execution permission.",
    )
    if environment.kind == "PRODUCTION":
        has_prod = Permission.EXECUTIONS_CREATE_PRODUCTION.value in user.permissions
        result.add(
            "production_permission",
            "Your role can request production operations",
            has_prod,
            "Production requests require the operations-level production permission."
            if not has_prod
            else "Your role includes the production execution permission.",
        )

    active_count = int(
        (
            await db.execute(
                select(func.count(Execution.id)).where(
                    Execution.automation_id == automation.id,
                    Execution.status.in_([ExecutionStatus.QUEUED, ExecutionStatus.RUNNING]),
                )
            )
        ).scalar_one()
    )
    capacity_free = active_count < automation.concurrency_limit
    result.add(
        "concurrency_capacity",
        "Automation capacity is available",
        capacity_free,
        f"{active_count} of {automation.concurrency_limit} concurrent slots are in use. Wait for the active run to finish."
        if not capacity_free
        else "A concurrency slot is available.",
    )

    result.requires_approval = environment.kind == "PRODUCTION"
    if result.requires_approval:
        result.info(
            "approval_required",
            "Production approval is mandatory",
            "This request will pause at an approval gate. A different authorized approver must approve the exact candidate before promotion.",
            status="PASS",
            severity="INFO",
        )
        result.info(
            "production_isolation",
            "Production execution mode",
            "Production uses the "
            + ("simulated" if environment.execution_mode == "SIMULATION" else environment.execution_mode.lower())
            + " adapter configured for this environment. JUNE will never represent a simulated run as a live production change.",
        )
    else:
        result.info("approval_not_required", "No approval gate", f"{environment.name} runs without an approval gate.")

    result.info(
        "security_gate",
        "Security evidence is collected during the run",
        "Secret and dependency scans execute before any deployment stage. High or critical findings block production promotion.",
    )

    opa = await _opa_check(
        {
            "action": "execution.request",
            "user": {"id": user.id, "role": user.role.key, "permissions": sorted(user.permissions)},
            "automation": {"id": automation.id, "risk": automation.risk_level, "environments": supported},
            "environment": {"key": environment.key, "kind": environment.kind},
            "params": params,
        }
    )
    if opa is not None:
        result.evaluated_by = "Open Policy Agent + JUNE safeguards"
        if not opa.get("available"):
            result.add(
                "opa_available",
                "External policy service reachable",
                False,
                f"OPA is configured but unavailable ({opa.get('message', 'unknown error')}). JUNE fails closed.",
            )
        else:
            result.add(
                "opa_decision",
                "OPA policy decision",
                bool(opa.get("allow")),
                "OPA allowed this request." if opa.get("allow") else "; ".join(opa.get("reasons") or ["OPA denied this request."]),
            )
    return result


async def evaluate_promotion(
    db: AsyncSession,
    *,
    execution: Execution,
    approval: Approval | None,
) -> PolicyResult:
    """Re-checked immediately before the production deployment stage."""
    result = PolicyResult()
    automation = execution.automation
    now = datetime.now(UTC)

    result.add(
        "approval_exists",
        "Approval exists",
        approval is not None,
        "No approval record exists for this candidate." if approval is None else "An approval record is bound to this candidate.",
    )
    approved = approval is not None and approval.status == "APPROVED"
    result.add(
        "approval_approved",
        "Approval is granted",
        approved,
        "The approval is in an APPROVED state."
        if approved
        else "The approval is not in an APPROVED state.",
    )
    bound = approval is not None and approval.candidate_hash == execution.candidate_hash
    result.add(
        "approval_bound",
        "Approval matches the exact candidate",
        bound,
        "The approval is bound to the exact candidate hash."
        if bound
        else "The candidate changed after approval. The approval is no longer valid.",
    )
    separated = approval is not None and approval.decided_by is not None and approval.decided_by != execution.requested_by
    result.add(
        "separation_of_duties",
        "Requester did not approve their own deployment",
        separated,
        "A different authorized approver recorded this decision."
        if separated
        else "Separation of duties requires a different approver.",
    )
    if approval and approval.expires_at:
        expires = approval.expires_at.astimezone(UTC) if approval.expires_at.tzinfo else approval.expires_at.replace(tzinfo=UTC)
        fresh = expires > now
        result.add(
            "approval_fresh",
            "Approval has not expired",
            fresh,
            f"The approval window remains open until {expires.strftime('%d %b %Y %H:%M')} UTC."
            if fresh
            else "The approval window has expired. Request a new approval.",
        )

    scans = list(
        (
            await db.execute(
                select(SecurityScan).where(
                    SecurityScan.execution_id == execution.id,
                    SecurityScan.kind.in_(["SECRETS", "DEPENDENCIES"]),
                )
            )
        )
        .scalars()
        .all()
    )
    passed_scans = bool(scans) and all(scan.status == ScanStatus.PASSED for scan in scans)
    result.add(
        "security_evidence",
        "Security checks passed",
        passed_scans,
        "Required security scans did not pass. Production promotion is blocked."
        if not passed_scans
        else "Secret and dependency checks passed for this exact candidate.",
    )
    open_high = [
        finding
        for scan in scans
        for finding in scan.findings
        if finding.status == "OPEN" and finding.severity in {"CRITICAL", "HIGH"}
    ]
    result.add(
        "no_blocking_findings",
        "No unresolved critical findings",
        not open_high,
        f"{len(open_high)} critical/high finding(s) remain open." if open_high else "No critical or high findings are open.",
    )

    stage_keys = {stage.key: stage for stage in execution.stages}
    if "production_deploy" in stage_keys:
        required_evidence = ("uat_deploy", "automated_test")
    else:
        required_evidence = tuple(key for key in ("uat_deploy", "automated_test") if key in stage_keys)
    uat_ok = all(
        stage_keys.get(key) is not None and stage_keys[key].status == StageStatus.SUCCEEDED
        for key in required_evidence
    )
    result.add(
        "uat_evidence",
        "UAT deployment and tests succeeded",
        uat_ok,
        "UAT deployment and automated tests succeeded in this execution."
        if uat_ok
        else "UAT must pass inside this execution before production promotion.",
    )
    version_current = automation.current_version == execution.automation_version
    result.add(
        "version_unchanged",
        "Approved version is still current",
        version_current,
        f"Version {execution.automation_version} is still the published version."
        if version_current
        else "A newer automation version was published after this request. The approval no longer applies.",
    )

    opa = await _opa_check(
        {
            "action": "production.promote",
            "execution": {
                "id": execution.id,
                "requested_by": execution.requested_by,
                "candidate_hash": execution.candidate_hash,
                "environment": execution.environment.key,
            },
            "approval": {
                "status": approval.status if approval else None,
                "decided_by": approval.decided_by if approval else None,
            },
        }
    )
    if opa is not None:
        result.evaluated_by = "Open Policy Agent + JUNE safeguards"
        if not opa.get("available"):
            result.add("opa_available", "External policy service reachable", False, "OPA is unavailable; promotion fails closed.")
        else:
            result.add(
                "opa_decision",
                "OPA promotion decision",
                bool(opa.get("allow")),
                "OPA allowed promotion." if opa.get("allow") else "OPA denied promotion.",
            )
    return result
