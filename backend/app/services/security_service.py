"""Real, local security scanning of automation packages.

JUNE runs its own deterministic scanners (secret patterns + dependency policy) so
security evidence is never fabricated. External scanners (Trivy, Gitleaks, Syft,
Grype) are detected and reported in Integrations when installed; the local
scanners remain active regardless.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.constants import ScanStatus, Severity
from app.core.database import utcnow
from app.models import Automation, AutomationVersion, SecurityFinding, SecurityScan


@dataclass
class SecretRule:
    rule_id: str
    title: str
    pattern: re.Pattern
    severity: str
    remediation: str


SECRET_RULES = [
    SecretRule(
        "JUNE-SEC-001",
        "AWS access key identifier",
        re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
        Severity.HIGH,
        "Revoke the key in IAM, rotate it, and load the new value from the approved secrets provider.",
    ),
    SecretRule(
        "JUNE-SEC-002",
        "Private key material",
        re.compile(r"-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----"),
        Severity.CRITICAL,
        "Remove the key from the repository immediately, rotate it, and store it in OpenBao or the approved vault.",
    ),
    SecretRule(
        "JUNE-SEC-003",
        "Hard-coded credential assignment",
        re.compile(r"(?i)\b(password|passwd|secret|api[_-]?key|access[_-]?token)\b\s*[:=]\s*['\"]([^'\"]{8,})['\"]"),
        Severity.HIGH,
        "Replace the literal with a reference resolved at runtime from the secrets provider.",
    ),
    SecretRule(
        "JUNE-SEC-004",
        "GitHub token",
        re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"),
        Severity.HIGH,
        "Revoke the token in GitHub and inject a short-lived credential through the execution agent.",
    ),
    SecretRule(
        "JUNE-SEC-005",
        "Slack token",
        re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
        Severity.MEDIUM,
        "Revoke the Slack token and store it in the secrets provider.",
    ),
]

PLACEHOLDER_MARKERS = (
    "example",
    "changeme",
    "change-me",
    "placeholder",
    "redacted",
    "xxxx",
    "your-",
    "your_",
    "${",
    "{{",
    "<",
    "dummy",
    "not-a-real",
)
TEXT_SUFFIXES = {".py", ".md", ".json", ".yaml", ".yml", ".txt", ".cfg", ".ini", ".toml", ".env", ".sh", ".js", ".ts"}


def package_dir(slug: str) -> Path:
    path = Path(__file__).resolve().parent.parent / "engine" / "packages" / slug
    path.mkdir(parents=True, exist_ok=True)
    return path


def _is_placeholder(line: str) -> bool:
    lowered = line.lower()
    return any(marker in lowered for marker in PLACEHOLDER_MARKERS)


def _scan_secrets(automation: Automation) -> tuple[list[dict], dict]:
    findings: list[dict] = []
    root = package_dir(automation.slug)
    files_scanned = 0
    bytes_scanned = 0
    seen: set[tuple[str, int, str]] = set()

    for file_path in sorted(root.rglob("*")):
        if not file_path.is_file() or "__pycache__" in file_path.parts:
            continue
        if file_path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        try:
            raw = file_path.read_bytes()
        except OSError:
            continue
        if len(raw) > 512_000:
            continue
        files_scanned += 1
        bytes_scanned += len(raw)
        text = raw.decode("utf-8", errors="replace")
        relative = file_path.relative_to(root).as_posix()
        for line_number, line in enumerate(text.splitlines(), start=1):
            if _is_placeholder(line):
                continue
            for rule in SECRET_RULES:
                if not rule.pattern.search(line):
                    continue
                marker = (relative, line_number, rule.rule_id)
                if marker in seen:
                    continue
                seen.add(marker)
                findings.append(
                    {
                        "severity": rule.severity,
                        "title": rule.title,
                        "description": f"Potential {rule.title.lower()} detected in {relative}.",
                        "file_path": relative,
                        "line_number": line_number,
                        "rule_id": rule.rule_id,
                        "remediation": rule.remediation,
                    }
                )
    summary = {
        "files_scanned": files_scanned,
        "bytes_scanned": bytes_scanned,
        "scanner": "JUNE built-in secret rules",
        "rules": len(SECRET_RULES),
        "coverage_gaps": [] if _external_available("gitleaks") else [
            "Gitleaks binary not detected. Built-in pattern rules are active; install Gitleaks for Git-history coverage."
        ],
    }
    return findings, summary


def _scan_dependencies(automation: Automation, version: AutomationVersion) -> tuple[list[dict], dict]:
    findings: list[dict] = []
    manifest = version.manifest or {}
    declared = manifest.get("dependencies", []) or []
    resolved = 0
    for dep in declared:
        if isinstance(dep, str):
            name, _, dep_version = dep.partition("@")
        else:
            name = str(dep.get("name", ""))
            dep_version = str(dep.get("version", ""))
        if dep_version:
            resolved += 1
        else:
            findings.append(
                {
                    "severity": Severity.LOW,
                    "title": "Unpinned dependency",
                    "description": f"Dependency '{name}' has no pinned version; builds may not be reproducible.",
                    "file_path": "manifest.json",
                    "line_number": None,
                    "rule_id": "JUNE-DEP-001",
                    "remediation": "Pin the dependency to an exact version and re-publish the automation.",
                }
            )
    summary = {
        "declared_dependencies": len(declared),
        "pinned_dependencies": resolved,
        "scanner": "JUNE dependency policy",
        "coverage_gaps": [
            "No online vulnerability database is configured. Install Trivy/Grype and connect the scanner for CVE coverage."
        ]
        if not _external_available("trivy")
        else [],
        "external_scanner_detected": _external_available("trivy"),
    }
    return findings, summary


def _external_available(binary: str) -> bool:
    import shutil

    return shutil.which(binary) is not None


async def _persist_scan(
    db: AsyncSession,
    *,
    automation: Automation,
    version: AutomationVersion,
    kind: str,
    findings: list[dict],
    summary: dict,
    triggered_by: str | None,
    execution_id: str | None,
    scanner: str,
) -> SecurityScan:
    started = utcnow()
    blocking = [f for f in findings if f["severity"] in {Severity.CRITICAL, Severity.HIGH}]
    scan = SecurityScan(
        automation_id=automation.id,
        automation_version=version.version,
        execution_id=execution_id,
        kind=kind,
        status=ScanStatus.FAILED if blocking else ScanStatus.PASSED,
        triggered_by=triggered_by,
        scanner=scanner,
        summary={**summary, "finding_count": len(findings)},
        started_at=started,
        finished_at=utcnow(),
        created_at=started,
    )
    scan.findings = [SecurityFinding(status="OPEN", **finding) for finding in findings]
    db.add(scan)
    await db.flush()

    storage = settings.storage_path / "scans"
    storage.mkdir(parents=True, exist_ok=True)
    path = storage / f"{scan.id}.json"
    report = {
        "scan_id": scan.id,
        "automation": automation.slug,
        "version": version.version,
        "kind": kind,
        "scanner": scanner,
        "status": scan.status,
        "summary": scan.summary,
        "findings": findings,
        "generated_at": started.isoformat(),
    }
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    scan.artifact_path = str(path.relative_to(settings.storage_path))
    await db.flush()
    return scan


async def run_security_scans(
    db: AsyncSession,
    *,
    automation: Automation,
    version: AutomationVersion,
    triggered_by: str | None,
    execution_id: str | None = None,
) -> list[SecurityScan]:
    scans: list[SecurityScan] = []
    secret_findings, secret_summary = _scan_secrets(automation)
    scans.append(
        await _persist_scan(
            db,
            automation=automation,
            version=version,
            kind="SECRETS",
            findings=secret_findings,
            summary=secret_summary,
            triggered_by=triggered_by,
            execution_id=execution_id,
            scanner="june-secret-rules",
        )
    )
    dep_findings, dep_summary = _scan_dependencies(automation, version)
    scans.append(
        await _persist_scan(
            db,
            automation=automation,
            version=version,
            kind="DEPENDENCIES",
            findings=dep_findings,
            summary=dep_summary,
            triggered_by=triggered_by,
            execution_id=execution_id,
            scanner="june-dependency-policy",
        )
    )
    return scans


def package_checksum(manifest: dict) -> str:
    canonical = json.dumps(manifest, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def file_hashes(root: Path) -> dict[str, str]:
    hashes: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        if path.is_file():
            hashes[path.relative_to(root).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return hashes
