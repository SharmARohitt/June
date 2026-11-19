"""Allowlisted stage runners for the local sandbox execution plane.

Every runner performs real work in the local environment: HTTP probes, filesystem
deployments with checksum verification, database integrity queries and package
scans. Production targets use the SIMULATION adapter and are always labelled as
such. No runner executes user-supplied code or arbitrary shell commands.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
from jsonschema import Draft202012Validator
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import utcnow
from app.models import (
    Approval,
    Artifact,
    Automation,
    AutomationVersion,
    Environment,
    Execution,
    ExecutionAgent,
    ExecutionStage,
    SecurityFinding,
    SecurityScan,
    ServerGroup,
)
from app.services import security_service


class RunnerFailure(Exception):
    def __init__(self, code: str, message: str, guidance: str = "") -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.guidance = guidance


@dataclass
class StageContext:
    db: AsyncSession
    execution: Execution
    automation: Automation
    environment: Environment
    stage: ExecutionStage
    version: AutomationVersion
    server_group: ServerGroup | None
    params: dict
    log: Callable[[str, str], Awaitable[None]]
    check_cancel: Callable[[], Awaitable[None]]
    scratch: Path

    @property
    def package_root(self) -> Path:
        return security_service.package_dir(self.automation.slug)

    @property
    def uat_dir(self) -> Path:
        return self.scratch / "uat"

    @property
    def production_dir(self) -> Path:
        return self.scratch / "production-sim"


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _approx_size_mb(path: Path) -> float:
    return round(path.stat().st_size / (1024 * 1024), 3)


async def _ensure_not_cancelled(ctx: StageContext) -> None:
    await ctx.check_cancel()


async def _checkout(ctx: StageContext) -> dict:
    root = ctx.package_root
    manifest_path = root / "manifest.json"
    if not manifest_path.exists():
        raise RunnerFailure(
            "PACKAGE_MISSING",
            "The automation package could not be found in the approved package store.",
            "Re-register the automation or contact the platform team to restore the package.",
        )
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        checksum = security_service.package_checksum(manifest)
    except (OSError, ValueError, TypeError, KeyError) as exc:
        raise RunnerFailure(
            "PACKAGE_INVALID",
            "The automation package manifest is unreadable or invalid, so JUNE will not execute it.",
            "Restore the package from the approved repository and publish a new version.",
        ) from exc
    if checksum != ctx.version.checksum:
        raise RunnerFailure(
            "CHECKSUM_MISMATCH",
            "The package checksum does not match the published version. This candidate is not trustworthy.",
            "Publish a new version from the approved repository source.",
        )
    files = security_service.file_hashes(root)
    await ctx.log("INFO", f"Package verified: {len(files)} file(s), checksum {checksum[:12]}…")
    await ctx.log("INFO", f"Source: {ctx.automation.repository_path or 'JUNE managed package store'} @ {ctx.version.version}")
    return {"checksum": checksum, "files": sorted(files), "file_count": len(files), "package_path": str(root)}


async def _validate_inputs(ctx: StageContext) -> dict:
    validator = Draft202012Validator(ctx.automation.input_schema or {})
    errors = sorted(validator.iter_errors(ctx.params), key=lambda error: list(error.path))
    if errors:
        details = "; ".join(
            f"{'/'.join(str(part) for part in error.path) or 'input'}: {error.message}" for error in errors[:5]
        )
        raise RunnerFailure("INVALID_INPUT", f"Execution parameters are invalid. {details}")
    await ctx.log("INFO", f"Inputs validated against the published schema ({len(ctx.params)} field(s)).")
    return {"validated_params": ctx.params, "schema": "Draft 2020-12", "field_count": len(ctx.params)}


async def _security_scan(ctx: StageContext) -> dict:
    scans = await security_service.run_security_scans(
        ctx.db,
        automation=ctx.automation,
        version=ctx.version,
        triggered_by=ctx.execution.requested_by,
        execution_id=ctx.execution.id,
    )
    secrets_scan = next((scan for scan in scans if scan.kind == "SECRETS"), None)
    if secrets_scan:
        ctx.execution.security_scan_id = secrets_scan.id
    blocking: list[SecurityFinding] = []
    payload = []
    for scan in scans:
        counts: dict[str, int] = {}
        for finding in scan.findings:
            counts[finding.severity] = counts.get(finding.severity, 0) + 1
            if finding.severity in {"CRITICAL", "HIGH"}:
                blocking.append(finding)
        payload.append({"kind": scan.kind, "status": scan.status, "findings": len(scan.findings), "severity_counts": counts})
        await ctx.log(
            "WARN" if scan.status == "FAILED" else "INFO",
            f"{scan.kind.title()} scan: {scan.status.lower()} · {len(scan.findings)} finding(s) · {scan.scanner}",
        )
    if blocking:
        names = ", ".join(sorted({finding.title for finding in blocking}))
        raise RunnerFailure(
            "SECURITY_BLOCKED",
            f"Security validation failed. Deployment blocked ({names}).",
            "Resolve the findings under Security & Governance, publish a fixed version, and request a new execution.",
        )
    await ctx.log("INFO", "Security gate passed: no critical or high findings for this candidate.")
    return {"scans": payload, "blocking_findings": 0}


async def _copy_candidate(ctx: StageContext, target: Path, mode: str, simulated: bool) -> dict:
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(ctx.package_root, target, dirs_exist_ok=True)
    files = security_service.file_hashes(target)
    manifest = {
        "execution_id": ctx.execution.display_id,
        "automation": ctx.automation.slug,
        "automation_version": ctx.version.version,
        "candidate_hash": ctx.execution.candidate_hash,
        "deployed_at": utcnow().isoformat(),
        "adapter": "local_sandbox",
        "execution_mode": mode,
        "simulated": simulated,
        "files": files,
    }
    (target / "deployment.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


async def _uat_deploy(ctx: StageContext) -> dict:
    await ctx.check_cancel()
    target = ctx.uat_dir
    await ctx.log("INFO", f"Deploying candidate {ctx.execution.candidate_hash[:12]}… to isolated UAT sandbox.")
    manifest = await _copy_candidate(ctx, target, "LOCAL_SANDBOX", False)
    await ctx.log("SUCCESS", f"UAT deployment complete: {len(manifest['files'])} file(s) written to the local UAT sandbox.")
    await ctx.log("INFO", "This is an isolated sandbox path, not an external or production host.")
    return {
        "deploy_path": str(target),
        "files": len(manifest["files"]),
        "candidate_hash": ctx.execution.candidate_hash,
        "mode": "LOCAL_SANDBOX",
        "simulated": False,
    }


async def _server_targets(ctx: StageContext) -> list:
    if not ctx.server_group:
        return []
    return list(ctx.server_group.servers)


def _probe_url(address: str, port: int, path: str) -> str:
    scheme = "https" if port == 443 else "http"
    if not path.startswith("/"):
        path = "/" + path
    return f"{scheme}://{address}:{port}{path}"


async def _health_check(ctx: StageContext) -> dict:
    targets = await _server_targets(ctx)
    if not targets:
        raise RunnerFailure(
            "NO_TARGET_GROUP",
            "No target server group was selected for this health check.",
            "Select an approved server group when you run the automation.",
        )
    timeout = min(int(ctx.params.get("timeout_seconds", 5)), 30)
    path = str(ctx.params.get("http_path", "/health"))
    results: list[dict] = []
    reachable = 0
    unreachable = 0
    simulated = 0
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        for server in targets:
            await ctx.check_cancel()
            if server.is_simulated:
                simulated += 1
                results.append(
                    {
                        "server": server.hostname,
                        "status": "NOT_PROBED",
                        "detail": "Target is marked as simulated; JUNE makes no connectivity claim.",
                    }
                )
                await ctx.log("INFO", f"{server.hostname}: simulated target — not probed.")
                continue
            url = _probe_url(server.address, server.port, path)
            started = time.perf_counter()
            try:
                response = await client.get(url)
                latency = round((time.perf_counter() - started) * 1000)
                ok = response.status_code < 500
                server.status = "REACHABLE" if ok else "UNREACHABLE"
                server.last_checked_at = utcnow()
                server.details = {
                    **(server.details or {}),
                    "last_status_code": response.status_code,
                    "last_latency_ms": latency,
                    "last_probe_url": url,
                }
                if ok:
                    reachable += 1
                else:
                    unreachable += 1
                results.append(
                    {
                        "server": server.hostname,
                        "status": "REACHABLE" if ok else "UNREACHABLE",
                        "status_code": response.status_code,
                        "latency_ms": latency,
                        "url": url,
                    }
                )
                await ctx.log(
                    "SUCCESS" if ok else "WARN",
                    f"{server.hostname}: HTTP {response.status_code} in {latency} ms ({url}).",
                )
            except (httpx.HTTPError, httpx.InvalidURL, ValueError) as exc:
                latency = round((time.perf_counter() - started) * 1000)
                server.status = "UNREACHABLE"
                server.last_checked_at = utcnow()
                server.details = {**(server.details or {}), "last_error": exc.__class__.__name__}
                unreachable += 1
                results.append(
                    {"server": server.hostname, "status": "UNREACHABLE", "error": exc.__class__.__name__, "url": url}
                )
                await ctx.log("ERROR", f"{server.hostname}: unreachable ({exc.__class__.__name__}).")
    if reachable + unreachable == 0:
        raise RunnerFailure(
            "NO_LIVE_TARGETS",
            "No live targets were available to probe. Every server in this group is marked simulated.",
            "Configure real server endpoints for this environment or select a different server group.",
        )
    agent_summary = {"online": 0, "stale": 0}
    if ctx.params.get("include_agent_heartbeat", True):
        agents = list(
            (
                await ctx.db.execute(
                    select(ExecutionAgent).where(ExecutionAgent.environment_id == ctx.environment.id)
                )
            )
            .scalars()
            .all()
        )
        cutoff = utcnow() - timedelta(seconds=120)
        for agent in agents:
            if agent.last_heartbeat_at and agent.last_heartbeat_at.astimezone(UTC) >= cutoff:
                agent_summary["online"] += 1
            else:
                agent_summary["stale"] += 1
    await ctx.log(
        "INFO",
        f"Result: {reachable} reachable, {unreachable} unreachable, {simulated} simulated target(s) skipped.",
    )
    return {
        "servers_checked": reachable + unreachable,
        "reachable": reachable,
        "unreachable": unreachable,
        "simulated": simulated,
        "results": results,
        "agent_heartbeat": agent_summary,
        "probe_path": path,
    }


async def _log_audit(ctx: StageContext) -> dict:
    group_slug = ctx.server_group.slug if ctx.server_group else "default"
    log_dir = settings.sandbox_path / "logs" / group_slug
    if not log_dir.exists():
        raise RunnerFailure(
            "LOG_PATH_MISSING",
            f"The approved sandbox log directory '{log_dir.name}' does not exist for this target.",
            "Register the log source for this server group or choose the environment that owns it.",
        )
    files = [path for path in log_dir.glob("*.log") if path.is_file()]
    if not files:
        raise RunnerFailure("LOG_DIR_EMPTY", "The log directory contains no .log files.")
    max_mb = int(ctx.params.get("max_file_mb", 50))
    older_days = int(ctx.params.get("older_than_days", 30))
    cutoff = utcnow() - timedelta(days=older_days)
    oversized = []
    old = []
    total_mb = 0.0
    for path in files:
        size = _approx_size_mb(path)
        total_mb += size
        modified = datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)
        if size > max_mb:
            oversized.append({"file": path.name, "size_mb": size})
            await ctx.log("WARN", f"{path.name}: {size} MB exceeds the {max_mb} MB retention limit.")
        if modified < cutoff:
            old.append({"file": path.name, "modified_at": modified.isoformat()})
        else:
            await ctx.log("INFO", f"{path.name}: {size} MB, modified {modified.date().isoformat()}.")
    await ctx.log(
        "INFO",
        f"Audited {len(files)} log file(s), {round(total_mb, 2)} MB total, {len(oversized)} oversized, {len(old)} beyond {older_days} days.",
    )
    return {
        "files_scanned": len(files),
        "total_mb": round(total_mb, 2),
        "oversized": oversized,
        "older_than_policy": old,
        "policy": {"max_file_mb": max_mb, "older_than_days": older_days},
        "source": "local sandbox log directory",
    }


async def _db_integrity(ctx: StageContext) -> dict:
    tables = ["users", "automations", "executions", "approvals", "audit_events", "security_scans"]
    counts: dict[str, int] = {}
    for table in tables:
        try:
            # Savepoint per table so a missing table never discards the rest of the stage's work.
            async with ctx.db.begin_nested():
                counts[table] = int((await ctx.db.execute(text(f"SELECT COUNT(*) FROM {table}"))).scalar_one())
        except Exception:
            counts[table] = -1
    integrity = "unknown"
    if settings.database_url.startswith("sqlite"):
        try:
            result = (await ctx.db.execute(text("PRAGMA quick_check"))).scalar_one()
            integrity = str(result)
            await ctx.log("INFO" if integrity == "ok" else "ERROR", f"SQLite quick_check: {integrity}.")
        except Exception as exc:
            integrity = f"error: {exc.__class__.__name__}"
    else:
        await ctx.db.execute(text("SELECT 1"))
        integrity = "connection ok (PostgreSQL)"
        await ctx.log("INFO", "PostgreSQL connection check passed.")
    for table, count in counts.items():
        await ctx.log("INFO", f"Table {table}: {count} row(s).")
    if integrity not in {"ok", "connection ok (PostgreSQL)"}:
        raise RunnerFailure("DB_INTEGRITY_FAILED", f"Database integrity check reported: {integrity}")
    return {"integrity": integrity, "table_counts": counts, "database": "control plane"}


async def _cache_warmup(ctx: StageContext) -> dict:
    targets = await _server_targets(ctx)
    if not targets:
        raise RunnerFailure("NO_TARGET_GROUP", "No target server group was selected.")
    paths = ctx.params.get("http_paths") or ["/health"]
    timeout = min(int(ctx.params.get("timeout_seconds", 5)), 30)
    hits = 0
    failures = 0
    results = []
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        for server in targets:
            if server.is_simulated:
                await ctx.log("INFO", f"{server.hostname}: simulated target — skipped.")
                continue
            for path in paths:
                await ctx.check_cancel()
                url = _probe_url(server.address, server.port, path)
                started = time.perf_counter()
                try:
                    response = await client.get(url)
                    latency = round((time.perf_counter() - started) * 1000)
                    hits += 1
                    results.append({"url": url, "status_code": response.status_code, "latency_ms": latency})
                    await ctx.log("INFO", f"Warmed {url} → HTTP {response.status_code} in {latency} ms.")
                except (httpx.HTTPError, httpx.InvalidURL, ValueError) as exc:
                    failures += 1
                    results.append({"url": url, "error": exc.__class__.__name__})
                    await ctx.log("ERROR", f"Warmup failed for {url}: {exc.__class__.__name__}.")
    if hits == 0:
        raise RunnerFailure(
            "WARMUP_UNREACHABLE",
            "No cache endpoints could be reached.",
            "Verify the server group endpoints and that the services accept the configured paths.",
        )
    return {"requests": len(results), "succeeded": hits, "failed": failures, "results": results}


async def _artifact_export(ctx: StageContext) -> dict:
    files = security_service.file_hashes(ctx.package_root)
    scans = list(
        (
            await ctx.db.execute(
                select(SecurityScan).where(
                    SecurityScan.automation_id == ctx.automation.id,
                    SecurityScan.automation_version == ctx.version.version,
                )
            )
        )
        .scalars()
        .all()
    )
    bundle = {
        "bundle_type": "june-release-evidence",
        "generated_at": utcnow().isoformat(),
        "execution": {
            "display_id": ctx.execution.display_id,
            "candidate_hash": ctx.execution.candidate_hash,
            "environment": ctx.environment.key,
            "requested_by": ctx.execution.requested_by,
        },
        "automation": {
            "slug": ctx.automation.slug,
            "version": ctx.version.version,
            "manifest_checksum": ctx.version.checksum,
        },
        "package_files": files,
        "security_scans": [
            {"id": scan.id, "kind": scan.kind, "status": scan.status, "summary": scan.summary} for scan in scans
        ],
        "software_bom": {
            "components": [
                {"type": "file", "name": name, "hashes": {"SHA-256": digest}} for name, digest in sorted(files.items())
            ]
        },
    }
    directory = settings.storage_path / "artifacts" / ctx.execution.display_id
    directory.mkdir(parents=True, exist_ok=True)
    filename = f"release-evidence-{ctx.version.version}.json"
    path = directory / filename
    payload = json.dumps(bundle, indent=2, default=str)
    path.write_text(payload, encoding="utf-8")
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    ctx.db.add(
        Artifact(
            execution_id=ctx.execution.id,
            name=filename,
            kind="RELEASE_EVIDENCE",
            path=str(path.relative_to(settings.storage_path)),
            size_bytes=len(payload.encode("utf-8")),
            checksum=digest,
            created_at=utcnow(),
        )
    )
    await ctx.log("SUCCESS", f"Evidence bundle written: {filename} ({len(payload)} bytes, SHA-256 {digest[:12]}…).")
    await ctx.log("INFO", f"Included {len(files)} file hashes and {len(scans)} security scan record(s).")
    return {
        "artifact": filename,
        "checksum": digest,
        "size_bytes": len(payload.encode("utf-8")),
        "components": len(files),
        "scans": len(scans),
    }


async def _secret_sweep(ctx: StageContext) -> dict:
    scans = await security_service.run_security_scans(
        ctx.db,
        automation=ctx.automation,
        version=ctx.version,
        triggered_by=ctx.execution.requested_by,
        execution_id=ctx.execution.id,
    )
    findings = [finding for scan in scans for finding in scan.findings]
    blocking = [finding for finding in findings if finding.severity in {"CRITICAL", "HIGH"}]
    await ctx.log("INFO", f"Sweep complete: {len(findings)} finding(s) across {len(scans)} scanner(s).")
    if blocking:
        raise RunnerFailure(
            "SECURITY_BLOCKED",
            f"Secret sweep found {len(blocking)} critical/high issue(s).",
            "Rotate exposed credentials and remove them from the package before running again.",
        )
    return {"findings": len(findings), "blocking_findings": 0}


DIAGNOSTIC_RUNNERS = {
    "health_check": _health_check,
    "log_audit": _log_audit,
    "db_integrity": _db_integrity,
    "cache_warmup": _cache_warmup,
    "artifact_export": _artifact_export,
    "secret_sweep": _secret_sweep,
}
DEPLOYMENT_RUNNERS = {"config_rollout"}


async def _smoke_test(ctx: StageContext) -> dict:
    if ctx.automation.runner_key in DIAGNOSTIC_RUNNERS:
        await ctx.log("INFO", f"Executing checks for '{ctx.automation.name}' in the {ctx.environment.name} context.")
        result = await DIAGNOSTIC_RUNNERS[ctx.automation.runner_key](ctx)
        return {"mode": "diagnostic", "metrics": result}

    deployment_file = ctx.uat_dir / "deployment.json"
    if not deployment_file.exists():
        raise RunnerFailure("UAT_NOT_DEPLOYED", "The UAT deployment directory is missing.")
    manifest = json.loads(deployment_file.read_text(encoding="utf-8"))
    drift = []
    for name, digest in manifest["files"].items():
        target = ctx.uat_dir / name
        if not target.exists() or _sha256_file(target) != digest:
            drift.append(name)
    if drift:
        raise RunnerFailure("UAT_DRIFT", f"UAT smoke test found drift in {len(drift)} file(s).")
    await ctx.log("INFO", f"UAT smoke test: {len(manifest['files'])} file checksum(s) verified.")
    rollout = None
    if ctx.automation.runner_key == "config_rollout":
        config = {
            "key": ctx.params.get("config_key"),
            "value": ctx.params.get("config_value"),
            "applied_at": utcnow().isoformat(),
            "candidate_hash": ctx.execution.candidate_hash,
            "environment": ctx.environment.key,
        }
        (ctx.uat_dir / "config" / "rollout.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
        rollout = config
        await ctx.log("SUCCESS", f"Applied {config['key']}={config['value']} in the UAT sandbox.")
    return {
        "mode": "deployment",
        "files_verified": len(manifest["files"]),
        "drift": drift,
        "rollout": rollout,
    }


async def _production_deploy(ctx: StageContext) -> dict:
    approval = (
        await ctx.db.execute(select(Approval).where(Approval.execution_id == ctx.execution.id))
    ).scalar_one_or_none()
    if (
        approval is None
        or approval.status != "APPROVED"
        or approval.candidate_hash != ctx.execution.candidate_hash
        or approval.decided_by == ctx.execution.requested_by
    ):
        raise RunnerFailure(
            "APPROVAL_INVALID",
            "Production promotion blocked: the approval is missing, invalid, or bound to a different candidate.",
            "Request a new approval for this exact candidate.",
        )
    if ctx.environment.execution_mode == "REMOTE_AGENT":
        raise RunnerFailure(
            "AGENT_CHANNEL_NOT_CONFIGURED",
            "Remote production execution requires a registered execution agent and a live authenticated channel. None is configured.",
            "Register an execution agent for this environment under Administration → Infrastructure.",
        )
    simulated = ctx.environment.execution_mode == "SIMULATION"
    if not simulated and ctx.environment.execution_mode != "LOCAL_SANDBOX":
        raise RunnerFailure(
            "ADAPTER_NOT_CONFIGURED",
            f"Environment {ctx.environment.name} declares execution mode '{ctx.environment.execution_mode}', which has no certified adapter.",
            "Set the environment mode to SIMULATION or LOCAL_SANDBOX until a certified execution adapter is registered.",
        )
    target = ctx.production_dir
    await ctx.log(
        "WARN" if simulated else "INFO",
        f"Promoting candidate {ctx.execution.candidate_hash[:12]}… using {ctx.environment.execution_mode} adapter.",
    )
    manifest = await _copy_candidate(ctx, target, ctx.environment.execution_mode, simulated)
    if ctx.automation.runner_key == "config_rollout":
        config = {
            "key": ctx.params.get("config_key"),
            "value": ctx.params.get("config_value"),
            "applied_at": utcnow().isoformat(),
            "candidate_hash": ctx.execution.candidate_hash,
            "environment": ctx.environment.key,
            "simulated": simulated,
        }
        (target / "config" / "rollout.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
        await ctx.log("SUCCESS", f"Rollout bundle applied to the {'simulated ' if simulated else ''}production directory.")
    if simulated:
        await ctx.log(
            "WARN",
            "SIMULATION ADAPTER: this run did not modify any live production system. The result is stored for governed rehearsal.",
        )
    else:
        await ctx.log("SUCCESS", "Deployment completed in the local production sandbox.")
    return {
        "deploy_path": str(target),
        "files": len(manifest["files"]),
        "mode": ctx.environment.execution_mode,
        "simulated": simulated,
        "candidate_hash": ctx.execution.candidate_hash,
        "approval_id": approval.id,
        "approver": approval.decided_by,
    }


async def _verification(ctx: StageContext) -> dict:
    verified = 0
    drift: list[str] = []
    mode = None
    simulated = False
    for directory in (ctx.uat_dir, ctx.production_dir):
        deployment_file = directory / "deployment.json"
        if not deployment_file.exists():
            continue
        manifest = json.loads(deployment_file.read_text(encoding="utf-8"))
        mode = manifest.get("execution_mode")
        simulated = simulated or bool(manifest.get("simulated"))
        for name, digest in manifest["files"].items():
            target = directory / name
            if target.exists() and _sha256_file(target) == digest:
                verified += 1
            else:
                drift.append(f"{directory.name}/{name}")
    if drift:
        raise RunnerFailure("VERIFICATION_FAILED", f"Verification found {len(drift)} drifted or missing file(s).")

    agents = list(
        (
            await ctx.db.execute(
                select(ExecutionAgent).where(ExecutionAgent.environment_id == ctx.environment.id)
            )
        )
        .scalars()
        .all()
    )
    cutoff = utcnow() - timedelta(seconds=120)
    online = sum(1 for agent in agents if agent.last_heartbeat_at and agent.last_heartbeat_at.astimezone(UTC) >= cutoff)
    stale = len(agents) - online
    if agents:
        await ctx.log("INFO", f"Execution agents for {ctx.environment.name}: {online} online, {stale} stale.")
    if mode:
        await ctx.log("SUCCESS", f"File integrity verified: {verified} file checksum(s) matched the deployment manifest.")
    else:
        await ctx.log("SUCCESS", "Evidence verified; no deployment path exists for this diagnostic automation.")
    return {
        "files_verified": verified,
        "drift": [],
        "mode": mode,
        "simulated": simulated,
        "agents_online": online,
        "agents_stale": stale,
        "verification_method": "sha256 manifest comparison",
    }


async def run_stage(ctx: StageContext) -> dict:
    await _ensure_not_cancelled(ctx)
    stage = ctx.stage.key
    if stage == "source_checkout":
        return await _checkout(ctx)
    if stage == "input_validation":
        return await _validate_inputs(ctx)
    if stage == "security_scan":
        return await _security_scan(ctx)
    if stage == "uat_deploy":
        return await _uat_deploy(ctx)
    if stage == "automated_test":
        return await _smoke_test(ctx)
    if stage == "production_deploy":
        return await _production_deploy(ctx)
    if stage == "verification":
        return await _verification(ctx)
    raise RunnerFailure("UNKNOWN_STAGE", f"Stage '{stage}' is not implemented by this executor.")


def build_result_summary(execution: Execution) -> dict:
    stages = execution.stages
    diagnostics = None
    deployed = None
    verification = None
    for stage in stages:
        if stage.key == "automated_test" and isinstance(stage.output, dict):
            diagnostics = stage.output.get("metrics")
        if stage.key == "production_deploy":
            deployed = stage.output
        if stage.key == "verification":
            verification = stage.output
    lines: list[str] = []
    counts = {}
    automation = execution.automation
    if automation.runner_key == "health_check" and diagnostics:
        lines.append(
            f"{diagnostics.get('reachable', 0)} server(s) reachable, {diagnostics.get('unreachable', 0)} unreachable, "
            f"{diagnostics.get('simulated', 0)} simulated target(s) not probed."
        )
        counts = {
            "reachable": diagnostics.get("reachable", 0),
            "unreachable": diagnostics.get("unreachable", 0),
            "simulated": diagnostics.get("simulated", 0),
        }
    elif automation.runner_key == "log_audit" and diagnostics:
        lines.append(
            f"Audited {diagnostics.get('files_scanned', 0)} log file(s), {diagnostics.get('total_mb', 0)} MB total."
        )
        counts = {
            "files": diagnostics.get("files_scanned", 0),
            "oversized": len(diagnostics.get("oversized", [])),
        }
    elif automation.runner_key == "db_integrity" and diagnostics:
        lines.append(f"Database integrity: {diagnostics.get('integrity', 'unknown')}. No blocked operations.")
        counts = diagnostics.get("table_counts", {})
    elif automation.runner_key == "cache_warmup" and diagnostics:
        lines.append(f"{diagnostics.get('succeeded', 0)} endpoint(s) warmed, {diagnostics.get('failed', 0)} failed.")
    elif automation.runner_key == "artifact_export" and diagnostics:
        lines.append(f"Evidence bundle '{diagnostics.get('artifact')}' created with {diagnostics.get('components', 0)} components.")
    elif automation.runner_key == "secret_sweep" and diagnostics:
        lines.append(f"Secret sweep completed with {diagnostics.get('findings', 0)} finding(s).")
    if deployed:
        if deployed.get("simulated"):
            lines.append(
                "Candidate promoted through the SIMULATION adapter. No live production system was changed."
            )
        else:
            lines.append(f"Candidate deployed to the isolated production sandbox ({deployed.get('files', 0)} files).")
    if verification:
        lines.append(f"{verification.get('files_verified', 0)} file checksum(s) verified after deployment.")
    if not lines:
        lines.append("All governed execution stages completed.")
    return {
        "headline": f"{automation.name} completed successfully.",
        "details": lines,
        "counts": counts,
        "environment": execution.environment.name,
        "environment_kind": execution.environment.kind,
        "execution_mode": execution.execution_mode,
        "simulated": execution.execution_mode == "SIMULATION",
        "stage_count": len(stages),
        "succeeded_stages": sum(1 for stage in stages if stage.status == "SUCCEEDED"),
        "skipped_stages": sum(1 for stage in stages if stage.status == "SKIPPED"),
        "adapter": execution.adapter,
    }
