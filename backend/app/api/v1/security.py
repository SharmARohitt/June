from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_permission
from app.core.database import get_db
from app.core.errors import invalid
from app.models import (
    Automation,
    AutomationVersion,
    Execution,
    Policy,
    SecurityFinding,
    SecurityScan,
    User,
)
from app.schemas.common import Page
from app.schemas.governance import FindingOut, PolicyOut, ScanOut
from app.services import audit_service, security_service
from app.services.serializers import finding_out, scan_out

router = APIRouter(prefix="/security", tags=["Security & Governance"])


@router.get("/scans", response_model=Page[ScanOut])
async def list_scans(
    automation_id: str | None = None,
    kind: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    execution_id: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    user: User = Depends(require_permission("security:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    query = select(SecurityScan)
    if automation_id:
        query = query.where(SecurityScan.automation_id == automation_id)
    if kind:
        query = query.where(SecurityScan.kind == kind)
    if status_filter:
        query = query.where(SecurityScan.status == status_filter)
    if execution_id:
        query = query.where(SecurityScan.execution_id == execution_id)
    total = int((await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one())
    query = query.order_by(SecurityScan.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    scans = list((await db.execute(query)).scalars().all())
    return {
        "items": [scan_out(scan) for scan in scans],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
    }


@router.get("/scans/{scan_id}", response_model=ScanOut)
async def get_scan(
    scan_id: str,
    user: User = Depends(require_permission("security:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    scan = await db.get(SecurityScan, scan_id)
    if not scan:
        from app.core.errors import not_found

        raise not_found("Security scan")
    return scan_out(scan)


@router.get("/findings", response_model=Page[FindingOut])
async def list_findings(
    severity: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    automation_id: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user: User = Depends(require_permission("security:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    query = select(SecurityFinding).join(SecurityScan, SecurityScan.id == SecurityFinding.scan_id)
    if severity:
        query = query.where(SecurityFinding.severity == severity)
    if status_filter:
        query = query.where(SecurityFinding.status == status_filter)
    if automation_id:
        query = query.where(SecurityScan.automation_id == automation_id)
    total = int((await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one())
    query = query.order_by(SecurityFinding.severity.desc()).offset((page - 1) * page_size).limit(page_size)
    findings = list((await db.execute(query)).scalars().all())
    return {
        "items": [finding_out(finding) for finding in findings],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
    }


@router.post("/scans", response_model=list[ScanOut], status_code=201)
async def run_scans(
    payload: dict,
    user: User = Depends(require_permission("security:run")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    automation_id = payload.get("automation_id")
    if not automation_id:
        raise invalid("automation_id is required.")
    automation = await db.get(Automation, automation_id)
    if not automation:
        raise invalid("Automation not found.")
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
        raise invalid("This automation has no published version to scan.")
    scans = await security_service.run_security_scans(
        db, automation=automation, version=version, triggered_by=user.id
    )
    await audit_service.record(
        db,
        actor=user,
        action="security.scan_requested",
        resource_type="automation",
        resource_id=automation.id,
        details={"version": version.version, "scans": [scan.kind for scan in scans]},
    )
    await db.commit()
    return [scan_out(scan) for scan in scans]


@router.get("/summary")
async def security_summary(
    user: User = Depends(require_permission("security:read")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    severity_counts = {
        severity: int(
            (
                await db.execute(
                    select(func.count(SecurityFinding.id)).where(
                        SecurityFinding.severity == severity, SecurityFinding.status == "OPEN"
                    )
                )
            ).scalar_one()
        )
        for severity in ("CRITICAL", "HIGH", "MEDIUM", "LOW")
    }
    scans_total = int((await db.execute(select(func.count(SecurityScan.id)))).scalar_one())
    failed_scans = int(
        (await db.execute(select(func.count(SecurityScan.id)).where(SecurityScan.status == "FAILED"))).scalar_one()
    )
    blocked = int(
        (
            await db.execute(
                select(func.count(Execution.id)).where(Execution.status == "BLOCKED", Execution.error_code == "SECURITY_BLOCKED")
            )
        ).scalar_one()
    )
    return {
        "open_findings": severity_counts,
        "total_open": sum(severity_counts.values()),
        "scans_total": scans_total,
        "scans_failed": failed_scans,
        "executions_blocked": blocked,
        "scanner_coverage": {
            "built_in_secret_rules": True,
            "built_in_dependency_policy": True,
            "external_vulnerability_db": False,
            "note": "External vulnerability scanning requires Trivy/Grype or the enterprise scanner integration. JUNE reports this as a coverage gap, not a pass.",
        },
    }


@router.get("/policies", response_model=list[PolicyOut])
async def list_policies(
    user: User = Depends(require_permission("security:read")),
    db: AsyncSession = Depends(get_db),
) -> list[Policy]:
    return list((await db.execute(select(Policy).order_by(Policy.name))).scalars().all())
