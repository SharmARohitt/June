"""Automation registry: registration, manifest validation, versioning, search."""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime

from jsonschema import Draft202012Validator
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import RUNNER_TEMPLATES, Severity
from app.core.database import utcnow
from app.core.errors import conflict, invalid, not_found
from app.models import Automation, AutomationVersion, Environment, Execution, Team, User
from app.models import Approval
from app.services import audit_service, security_service, workflow_service
from app.services.serializers import automation_detail, automation_summary, execution_stats, version_out
from app.services.workflow_service import build_default_definition, definition_checksum

SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(value: str) -> str:
    return SLUG_RE.sub("-", value.lower()).strip("-")[:100] or "automation"


def _unique_slug(base: str) -> str:
    return f"{base}-{utcnow().strftime('%H%M%S')}"[:120]


def _write_package(
    automation: Automation,
    manifest: dict,
    profile: dict,
    *,
    owner_name: str | None = None,
    team_name: str | None = None,
) -> str:
    root = security_service.package_dir(automation.slug)
    (root / "config").mkdir(parents=True, exist_ok=True)
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    readme = f"""# {automation.name}

{automation.summary}

## What this automation does
{profile['what_it_does']}

## Why it exists
{profile['why_it_exists']}

## When to use it
{profile['when_to_use']}

## Expected output
{profile['expected_output']}

## What can go wrong
{profile['what_could_go_wrong']}

## If the run fails
{profile['failure_guidance']}

## Ownership
{owner_name or 'Unassigned'} — {team_name or 'No team'}

## Execution
Runner: `{automation.runner_key}` · Timeout: {automation.timeout_seconds}s · Production approval: {'required' if automation.approval_required else 'per policy'}

> This package is managed by JUNE. Execution is restricted to the registered runner;
> JUNE never executes arbitrary uploaded code.
"""
    (root / "README.md").write_text(readme, encoding="utf-8")
    defaults = {
        name: (spec.get("default") if isinstance(spec, dict) else None)
        for name, spec in (automation.input_schema or {}).get("properties", {}).items()
    }
    (root / "config" / "defaults.json").write_text(json.dumps(defaults, indent=2), encoding="utf-8")
    return f"engine/packages/{automation.slug}"


def _validate_params_schema(schema: dict) -> None:
    try:
        Draft202012Validator.check_schema(schema)
    except Exception as exc:
        raise invalid("The input schema is not a valid JSON Schema.", str(exc)) from exc


def build_manifest(
    automation: Automation,
    version: str,
    *,
    owner_email: str | None = None,
    team_slug: str | None = None,
) -> dict:
    return {
        "schemaVersion": "1.0",
        "slug": automation.slug,
        "name": automation.name,
        "summary": automation.summary,
        "version": version,
        "runner": automation.runner_key,
        "language": automation.language,
        "riskLevel": automation.risk_level,
        "inputs": automation.input_schema,
        "outputs": automation.output_schema,
        "supportedEnvironments": automation.supported_environments,
        "timeoutSeconds": automation.timeout_seconds,
        "approvalRequired": automation.approval_required,
        "systems": automation.systems_affected,
        "requiredPermissions": automation.required_permissions,
        "dependencies": [],
        "owner": owner_email,
        "team": team_slug,
    }


async def create_automation(db: AsyncSession, actor: User, payload) -> Automation:
    if actor.team is None:
        raise invalid("Your account is not assigned to a team, so you cannot own an automation.")

    template = RUNNER_TEMPLATES.get(payload.runner_key)
    if not template:
        raise invalid("Choose a supported execution runner.", {"allowed": list(RUNNER_TEMPLATES)})

    environments = list((await db.execute(select(Environment))).scalars().all())
    known_env_keys = {environment.key for environment in environments}
    unknown = [key for key in payload.supported_environments if key not in known_env_keys]
    if unknown:
        raise invalid("One or more environments do not exist.", {"unknown_environments": unknown})
    if not payload.supported_environments:
        raise invalid("Select at least one supported environment.")

    if payload.repository_id:
        from app.models import RepositoryConnection

        if not await db.get(RepositoryConnection, payload.repository_id):
            raise invalid("The selected repository connection does not exist.")

    slug = payload.slug or slugify(payload.name)
    exists = (await db.execute(select(Automation).where(Automation.slug == slug))).scalar_one_or_none()
    if exists:
        if payload.slug:
            raise conflict("An automation with this slug already exists.")
        slug = _unique_slug(slug)

    input_schema = payload.input_schema or template["params_schema"]
    _validate_params_schema(input_schema)
    output_schema = {
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "metrics": {"type": "object"},
            "details": {"type": "object"},
        },
    }

    automation = Automation(
        slug=slug,
        name=payload.name,
        summary=payload.summary,
        category=payload.category,
        icon=_icon_for(payload.runner_key),
        risk_level=payload.risk_level,
        status="ACTIVE",
        what_it_does=payload.what_it_does,
        why_it_exists=payload.why_it_exists,
        when_to_use=payload.when_to_use,
        expected_output=payload.expected_output,
        what_could_go_wrong=payload.what_could_go_wrong,
        failure_guidance=payload.failure_guidance,
        systems_affected=payload.systems_affected,
        required_permissions=payload.required_permissions,
        tags=payload.tags,
        supported_environments=payload.supported_environments,
        language="python",
        execution_type="RUNNER",
        runner_key=payload.runner_key,
        input_schema=input_schema,
        output_schema=output_schema,
        timeout_seconds=payload.timeout_seconds,
        approval_required=payload.approval_required,
        current_version="1.0.0",
        owner_id=actor.id,
        team_id=payload.team_id or actor.team_id,
        repository_id=payload.repository_id,
        repository_path=payload.repository_path,
    )
    db.add(automation)
    await db.flush()

    manifest = build_manifest(
        automation,
        "1.0.0",
        owner_email=actor.email,
        team_slug=actor.team.slug if actor.team else None,
    )
    package_path = _write_package(
        automation,
        manifest,
        {
            "what_it_does": payload.what_it_does,
            "why_it_exists": payload.why_it_exists,
            "when_to_use": payload.when_to_use,
            "expected_output": payload.expected_output,
            "what_could_go_wrong": payload.what_could_go_wrong,
            "failure_guidance": payload.failure_guidance,
        },
        owner_name=actor.full_name,
        team_name=actor.team.name if actor.team else None,
    )
    db.add(
        AutomationVersion(
            automation_id=automation.id,
            version="1.0.0",
            manifest=manifest,
            checksum=security_service.package_checksum(manifest),
            changelog="Initial registration through JUNE.",
            package_path=package_path,
            status="PUBLISHED",
            created_by=actor.id,
        )
    )
    await workflow_service.create_default_workflow(
        db, automation, actor, include_production="production" in payload.supported_environments
    )
    await audit_service.record(
        db,
        actor=actor,
        action="automation.created",
        resource_type="automation",
        resource_id=automation.id,
        details={"slug": automation.slug, "runner": automation.runner_key, "environments": payload.supported_environments},
    )
    await db.commit()
    await db.refresh(automation)

    # Initial evidence so the automation can be inspected immediately.
    await security_service.run_security_scans(
        db, automation=automation, version=automation.versions[0], triggered_by=actor.id
    )
    await db.commit()
    return automation


def _icon_for(runner_key: str) -> str:
    return {
        "health_check": "heart-pulse",
        "log_audit": "file-search",
        "db_integrity": "database",
        "cache_warmup": "zap",
        "artifact_export": "package",
        "secret_sweep": "shield-check",
        "config_rollout": "sliders-horizontal",
    }.get(runner_key, "workflow")


async def get_automation(db: AsyncSession, automation_id: str) -> Automation:
    automation = await db.get(Automation, automation_id)
    if not automation:
        automation = await get_automation_by_slug(db, automation_id)
    if not automation:
        raise not_found("Automation")
    return automation


async def get_automation_by_slug(db: AsyncSession, slug: str) -> Automation | None:
    return (await db.execute(select(Automation).where(Automation.slug == slug))).scalar_one_or_none()


async def stats_for(db: AsyncSession, automation_ids: list[str]) -> dict[str, dict]:
    if not automation_ids:
        return {}
    result = await db.execute(
        select(Execution.automation_id, Execution.status, Execution.created_at)
        .where(Execution.automation_id.in_(automation_ids))
        .order_by(Execution.created_at.desc())
    )
    grouped: dict[str, list[tuple[str, None, datetime]]] = {}
    for automation_id, status, created_at in result.all():
        grouped.setdefault(automation_id, []).append((status, None, created_at))
    return {automation_id: execution_stats(rows) for automation_id, rows in grouped.items()}


async def list_automations(
    db: AsyncSession,
    *,
    q: str | None = None,
    category: str | None = None,
    environment: str | None = None,
    tag: str | None = None,
    status: str = "ACTIVE",
    owner: str | None = None,
    page: int = 1,
    page_size: int = 24,
) -> tuple[list[dict], int]:
    query = select(Automation)
    if status != "ALL":
        query = query.where(Automation.status == status)
    if q:
        pattern = f"%{q.lower()}%"
        query = query.where(
            or_(
                func.lower(Automation.name).like(pattern),
                func.lower(Automation.summary).like(pattern),
                func.lower(Automation.category).like(pattern),
            )
        )
    if category:
        query = query.where(Automation.category == category)
    if owner:
        query = query.where(Automation.owner_id == owner)
    if environment:
        query = query.where(cast(Automation.supported_environments, String).like(f'%"{environment}"%'))
    if tag:
        query = query.where(cast(Automation.tags, String).like(f'%"{tag}"%'))

    total = int((await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one())
    query = query.order_by(Automation.updated_at.desc()).offset((page - 1) * page_size).limit(page_size)
    automations = list((await db.execute(query)).scalars().all())
    stats = await stats_for(db, [automation.id for automation in automations])
    return [automation_summary(automation, stats.get(automation.id)) for automation in automations], total


async def detail(db: AsyncSession, automation_id: str) -> dict:
    automation = await get_automation(db, automation_id)
    workflow = await workflow_service.get_default_workflow(db, automation.id)
    data = automation_detail(automation, workflow)
    data.update((await stats_for(db, [automation.id])).get(automation.id, {}))
    return data


async def update_automation(db: AsyncSession, actor: User, automation_id: str, payload) -> Automation:
    automation = await get_automation(db, automation_id)
    changes = payload.model_dump(exclude_unset=True)
    if "supported_environments" in changes and not changes["supported_environments"]:
        raise invalid("Select at least one supported environment.")
    for field, value in changes.items():
        if value is not None and hasattr(automation, field):
            setattr(automation, field, value)
    automation.updated_at = utcnow()
    await audit_service.record(
        db,
        actor=actor,
        action="automation.updated",
        resource_type="automation",
        resource_id=automation.id,
        details={"changed": list(changes.keys())},
    )
    await db.commit()
    await db.refresh(automation)
    return automation


async def archive_automation(db: AsyncSession, actor: User, automation_id: str) -> Automation:
    automation = await get_automation(db, automation_id)
    automation.status = "ARCHIVED"
    automation.updated_at = utcnow()
    await audit_service.record(
        db,
        actor=actor,
        action="automation.archived",
        resource_type="automation",
        resource_id=automation.id,
        details={"slug": automation.slug},
    )
    await db.commit()
    await db.refresh(automation)
    return automation


async def publish_version(
    db: AsyncSession,
    actor: User,
    automation_id: str,
    *,
    version: str,
    changelog: str,
    manifest_overrides: dict | None = None,
) -> AutomationVersion:
    automation = await get_automation(db, automation_id)
    if not re.match(r"^\d+\.\d+\.\d+$", version):
        raise invalid("Version must use semantic versioning, for example 1.2.0.")
    existing = (
        await db.execute(
            select(AutomationVersion).where(
                AutomationVersion.automation_id == automation.id, AutomationVersion.version == version
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise conflict("This version already exists.")
    manifest = build_manifest(
        automation,
        version,
        owner_email=automation.owner.email if automation.owner else None,
        team_slug=automation.team.slug if automation.team else None,
    )
    if manifest_overrides:
        manifest.update(manifest_overrides)
    db.add(
        AutomationVersion(
            automation_id=automation.id,
            version=version,
            manifest=manifest,
            checksum=security_service.package_checksum(manifest),
            changelog=changelog or "Version published through JUNE.",
            package_path=automation.versions[0].package_path if automation.versions else "",
            status="PUBLISHED",
            created_by=actor.id,
        )
    )
    automation.current_version = version
    automation.updated_at = utcnow()
    pending = list(
        (
            await db.execute(
                select(Approval).where(Approval.automation_id == automation.id, Approval.status == "PENDING")
            )
        )
        .scalars()
        .all()
    )
    for approval in pending:
        approval.status = "INVALIDATED"
        approval.decision_reason = f"A newer automation version ({version}) was published; the approval no longer applies."
    await audit_service.record(
        db,
        actor=actor,
        action="automation.version_published",
        resource_type="automation",
        resource_id=automation.id,
        details={"version": version, "changelog": changelog},
    )
    await db.commit()
    await db.refresh(automation)
    new_version = next(v for v in automation.versions if v.version == version)
    await security_service.run_security_scans(db, automation=automation, version=new_version, triggered_by=actor.id)
    await db.commit()
    return new_version


async def versions(db: AsyncSession, automation_id: str) -> list[dict]:
    automation = await get_automation(db, automation_id)
    return [version_out(version) for version in automation.versions]


def validate_manifest_payload(payload: dict) -> list[dict]:
    """Validate an externally supplied declarative manifest without trusting it."""
    issues: list[dict] = []
    required = ["name", "summary", "runner", "what_it_does", "supported_environments"]
    for key in required:
        if not payload.get(key):
            issues.append({"field": key, "message": f"'{key}' is required."})
    if payload.get("runner") not in RUNNER_TEMPLATES:
        issues.append({"field": "runner", "message": "Runner is not in the execution allowlist."})
    if payload.get("input_schema"):
        try:
            Draft202012Validator.check_schema(payload["input_schema"])
        except Exception as exc:
            issues.append({"field": "input_schema", "message": f"Invalid JSON Schema: {exc}"})
    environments = payload.get("supported_environments", [])
    if not isinstance(environments, list) or not environments:
        issues.append({"field": "supported_environments", "message": "At least one environment is required."})
    if payload.get("timeout_seconds", 300) > 3600:
        issues.append({"field": "timeout_seconds", "message": "Timeout cannot exceed 3600 seconds."})
    return issues


async def assignable_teams(db: AsyncSession) -> list[Team]:
    return list((await db.execute(select(Team).order_by(Team.name))).scalars().all())


def manifest_preview(payload: dict) -> dict:
    return {
        "accepted": not validate_manifest_payload(payload),
        "issues": validate_manifest_payload(payload),
        "allowlisted_runner": payload.get("runner") in RUNNER_TEMPLATES,
        "default_stages": [
            node["stage_key"] for node in build_default_definition(True, payload.get("runner"))["nodes"]
        ],
        "checksum": definition_checksum(build_default_definition(True, payload.get("runner"))),
        "security_note": "Registration triggers real secret and dependency scans. Uploaded files are never executed directly.",
        "severity_scale": [severity.value for severity in Severity],
    }
