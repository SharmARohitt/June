"""Opt-in first-run sample environment.

Everything here is real JUNE data created through the same services the API uses:
roles, teams, users, environments, sample automations with packages and workflows,
governance policies, and genuine executions run by the real execution engine.

The caller supplies the initial password. Never use sample accounts in production.
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import ROLE_DEFINITIONS, ROLE_PERMISSIONS, Permission
from app.core.database import SessionLocal, utcnow
from app.core.security import generate_agent_token, hash_password, hash_token
from app.models import (
    Automation,
    Execution,
    ExecutionAgent,
    Policy,
    RepositoryConnection,
    Role,
    ServerGroup,
    Team,
    User,
)
from app.models import (
    Permission as PermissionModel,
)
from app.schemas.automation import AutomationCreate
from app.schemas.execution import ExecutionCreate
from app.schemas.governance import EnvironmentCreate, ServerCreate, ServerGroupCreate
from app.services import (
    approval_service,
    audit_service,
    automation_service,
    execution_service,
    infrastructure_service,
    notification_service,
)

logger = logging.getLogger("june.seed")

def _permission_label(key: str) -> str:
    return key.replace(":", " · ").replace("_", " ").title()


async def _seed_identity(db: AsyncSession, password: str) -> dict[str, User]:
    permissions: dict[str, PermissionModel] = {}
    for permission in Permission:
        row = PermissionModel(
            key=permission.value,
            name=_permission_label(permission.value),
            description=f"Grants the {permission.value} capability.",
        )
        db.add(row)
        permissions[permission.value] = row
    await db.flush()

    roles: dict[str, Role] = {}
    for key, (name, description) in ROLE_DEFINITIONS.items():
        role = Role(key=key, name=name, description=description)
        role.permissions = [permissions[value] for value in ROLE_PERMISSIONS[key]]
        db.add(role)
        roles[key] = role
    await db.flush()

    teams = {
        "platform": Team(
            name="Platform Engineering",
            slug="platform-engineering",
            description="Runs the JUNE control plane, integrations and environments.",
        ),
        "sre": Team(
            name="Site Reliability",
            slug="site-reliability",
            description="Operates production services and executes approved automations.",
        ),
        "security": Team(
            name="Security Engineering",
            slug="security-engineering",
            description="Owns scanning policy, findings and release evidence.",
        ),
    }
    db.add_all(teams.values())
    await db.flush()

    password_hash = hash_password(password)
    definitions = [
        ("ava.chen@june.dev", "Ava Chen", "Head of Platform", "SUPER_ADMIN", teams["platform"]),
        ("marcus.reed@june.dev", "Marcus Reed", "Platform Administrator", "PLATFORM_ADMIN", teams["platform"]),
        ("priya.nair@june.dev", "Priya Nair", "Automation Engineer", "AUTOMATION_DEVELOPER", teams["platform"]),
        ("daniel.okafor@june.dev", "Daniel Okafor", "Operations Engineer", "OPERATIONS_ENGINEER", teams["sre"]),
        ("sofia.almeida@june.dev", "Sofia Almeida", "Security Reviewer", "SECURITY_REVIEWER", teams["security"]),
        ("elena.petrova@june.dev", "Elena Petrova", "Release Approver", "APPROVER", teams["sre"]),
        ("jordan.lee@june.dev", "Jordan Lee", "Engineering Analyst", "VIEWER", teams["platform"]),
    ]
    users: dict[str, User] = {}
    for email, full_name, title, role_key, team in definitions:
        user = User(
            email=email,
            full_name=full_name,
            title=title,
            password_hash=password_hash,
            role=roles[role_key],
            team=team,
            is_active=True,
            preferences={
                "beginner_mode": True,
                "reduce_motion": False,
                "density": "comfortable",
                "timezone": "UTC",
            },
        )
        db.add(user)
        users[email.split("@")[0].replace(".", "_")] = user
    await db.flush()
    await db.commit()
    return users


async def _seed_infrastructure(db: AsyncSession, admin: User) -> dict[str, str]:
    environments = {}
    for payload in [
        EnvironmentCreate(
            key="development",
            name="Development",
            kind="DEVELOPMENT",
            description="Individual engineering workspace. Runs are local and never touch shared systems.",
            execution_mode="LOCAL_SANDBOX",
            approval_required=False,
            color="#8F9BA8",
        ),
        EnvironmentCreate(
            key="uat",
            name="UAT",
            kind="UAT",
            description="Pre-production validation on the isolated JUNE sandbox fleet.",
            execution_mode="LOCAL_SANDBOX",
            approval_required=False,
            color="#67D9E8",
        ),
        EnvironmentCreate(
            key="production",
            name="Production",
            kind="PRODUCTION",
            description=(
                "Governed production plane. This installation uses the simulation adapter until a "
                "remote execution agent is connected — every production run is labelled accordingly."
            ),
            execution_mode="SIMULATION",
            approval_required=True,
            color="#FFB86B",
        ),
    ]:
        environment = await infrastructure_service.create_environment(db, admin, payload)
        environments[environment.key] = environment.id

    group_specs = [
        (environments["uat"], "UAT application fleet", "Loopback targets that JUNE can probe for real.", "HTTP"),
        (environments["development"], "Developer sandbox", "Local loopback target for guided runs.", "HTTP"),
        (
            environments["production"],
            "Production API cluster",
            "Simulated production inventory. Connectivity is never claimed for simulated targets.",
            "HTTPS",
        ),
    ]
    groups: dict[str, ServerGroup] = {}
    for environment_id, name, description, protocol in group_specs:
        group = await infrastructure_service.create_group(
            db,
            admin,
            environment_id,
            ServerGroupCreate(name=name, description=description, check_protocol=protocol),
        )
        groups[group.slug] = group

    await infrastructure_service.create_server(
        db,
        admin,
        groups["uat-application-fleet"].id,
        ServerCreate(
            hostname="uat-app-01",
            display_name="UAT application node",
            address="127.0.0.1",
            port=8000,
            role="application",
            is_simulated=False,
        ),
    )
    await infrastructure_service.create_server(
        db,
        admin,
        groups["developer-sandbox"].id,
        ServerCreate(
            hostname="dev-app-01",
            display_name="Developer loopback node",
            address="127.0.0.1",
            port=8000,
            role="application",
            is_simulated=False,
        ),
    )
    for index in range(1, 4):
        await infrastructure_service.create_server(
            db,
            admin,
            groups["production-api-cluster"].id,
            ServerCreate(
                hostname=f"prod-api-0{index}",
                display_name=f"Production API node {index}",
                address=f"10.20.0.1{index}",
                port=443,
                role="application",
                is_simulated=True,
            ),
        )

    db.add_all(
        [
            ExecutionAgent(
                name="june-local-sandbox",
                kind="LOCAL_SANDBOX",
                environment_id=environments["uat"],
                status="ONLINE",
                endpoint="embedded://execution",
                version="1.0.0",
                capabilities=["runner:local_sandbox", "probe:http", "storage:evidence"],
                labels={"fleet": "uat", "isolation": "sandbox"},
                token_hash=hash_token(generate_agent_token()),
                last_heartbeat_at=utcnow(),
            ),
            ExecutionAgent(
                name="prod-kubernetes-runner",
                kind="KUBERNETES",
                environment_id=environments["production"],
                status="OFFLINE",
                endpoint="",
                version="1.0.0",
                capabilities=["runner:isolated_container"],
                labels={"fleet": "production", "status_note": "No remote agent connected yet"},
                token_hash=hash_token(generate_agent_token()),
                last_heartbeat_at=None,
            ),
        ]
    )
    await db.commit()
    return environments


AUTOMATION_BLUEPRINTS: list[dict] = [
    {
        "name": "Server Health Check",
        "runner_key": "health_check",
        "summary": "Checks whether the servers in an approved target group are reachable and responding.",
        "category": "Reliability",
        "risk_level": "LOW",
        "tags": ["reliability", "health", "http"],
        "systems_affected": ["UAT application fleet", "Production API cluster"],
        "supported_environments": ["uat", "production"],
        "timeout_seconds": 120,
        "approval_required": False,
        "repository_path": "automations/server-health-check",
        "what_it_does": (
            "JUNE sends a real HTTP request to every server in the target group and records the status code, "
            "latency and reachability for each one. Simulated targets are listed but never probed."
        ),
        "why_it_exists": (
            "Before a release or after an infrastructure change, the team needs one dependable answer to "
            "'are these servers actually answering?' without opening SSH sessions."
        ),
        "when_to_use": (
            "Use it before deploying, after restarting a service, or when investigating a suspected outage. "
            "It is read-only and safe to run repeatedly."
        ),
        "expected_output": (
            "A per-server table with reachable/unreachable status and latency, plus an overall reachable count."
        ),
        "what_could_go_wrong": (
            "A firewall may block the probe, the health path may return a server error, or the target may be "
            "marked as simulated and therefore intentionally not contacted."
        ),
        "failure_guidance": (
            "Confirm the target group and HTTP path, check the per-server log lines, and verify network reachability "
            "from the execution plane. Do not retry blindly if every server reports unreachable."
        ),
    },
    {
        "name": "Log Retention Audit",
        "runner_key": "log_audit",
        "summary": "Audits the sandbox log directory for oversized or expired log files.",
        "category": "Operations",
        "risk_level": "LOW",
        "tags": ["logs", "retention", "housekeeping"],
        "systems_affected": ["Isolated UAT sandbox"],
        "supported_environments": ["uat"],
        "timeout_seconds": 180,
        "approval_required": False,
        "repository_path": "automations/log-retention-audit",
        "what_it_does": (
            "Walks the approved sandbox log directory and reports files larger than the configured limit or "
            "older than the retention window. It never deletes anything."
        ),
        "why_it_exists": "Log growth silently fills disks and causes outages that are hard to trace afterwards.",
        "when_to_use": "Run weekly, or whenever disk pressure is suspected on an application host.",
        "expected_output": "Counts of oversized and expired files with their paths and sizes.",
        "what_could_go_wrong": "The sandbox may not contain log files yet, so the report will be empty.",
        "failure_guidance": (
            "Check that the sandbox log directory exists. An empty report is a valid result, not a failure."
        ),
    },
    {
        "name": "Database Integrity Check",
        "runner_key": "db_integrity",
        "summary": "Runs read-only integrity and row-count checks against the JUNE control-plane database.",
        "category": "Data",
        "risk_level": "MEDIUM",
        "tags": ["database", "integrity", "read-only"],
        "systems_affected": ["JUNE control-plane database"],
        "supported_environments": ["uat"],
        "timeout_seconds": 180,
        "approval_required": False,
        "repository_path": "automations/database-integrity-check",
        "what_it_does": (
            "Executes database-native integrity checks and counts rows in the core tables. Every statement is "
            "read-only; the runner cannot modify application data."
        ),
        "why_it_exists": (
            "Before enabling production flows, the team wants evidence that the control-plane database is "
            "structurally sound and contains the expected records."
        ),
        "when_to_use": "Run after migrations, after restoring a backup, or as a periodic sanity check.",
        "expected_output": "An integrity verdict plus row counts for the core domain tables.",
        "what_could_go_wrong": "A locked database or a failed integrity check will stop the run with a clear error.",
        "failure_guidance": (
            "Review the failing check, confirm database availability, and involve the platform team before "
            "attempting any repair."
        ),
    },
    {
        "name": "Cache Warmup",
        "runner_key": "cache_warmup",
        "summary": "Calls approved HTTP paths on the target fleet to warm caches before traffic.",
        "category": "Performance",
        "risk_level": "MEDIUM",
        "tags": ["performance", "cache", "http"],
        "systems_affected": ["UAT application fleet", "Production API cluster"],
        "supported_environments": ["uat", "production"],
        "timeout_seconds": 180,
        "approval_required": False,
        "repository_path": "automations/cache-warmup",
        "what_it_does": (
            "Requests each configured path on every target server so caches are populated before users arrive. "
            "Responses are summarised; bodies are not stored."
        ),
        "why_it_exists": "Cold caches cause a slow first wave of traffic after a deployment or restart.",
        "when_to_use": "Immediately after a deployment, or before a known traffic peak.",
        "expected_output": "Per-path and per-server response codes with timings.",
        "what_could_go_wrong": "A path may be protected by authentication, or simulated targets will not be contacted.",
        "failure_guidance": "Verify the paths are publicly readable health or landing endpoints and belong to the fleet.",
    },
    {
        "name": "Release Evidence Bundle",
        "runner_key": "artifact_export",
        "summary": "Packages SHA-256 hashes of the deployed package into a release evidence artifact.",
        "category": "Compliance",
        "risk_level": "LOW",
        "tags": ["compliance", "evidence", "artifacts"],
        "systems_affected": ["JUNE evidence storage"],
        "supported_environments": ["uat"],
        "timeout_seconds": 120,
        "approval_required": False,
        "repository_path": "automations/release-evidence-bundle",
        "what_it_does": (
            "Reads the published automation package, hashes every file and writes a JSON evidence artifact with "
            "the candidate hash and timestamp."
        ),
        "why_it_exists": "Auditors need a verifiable record of exactly which files were part of a release candidate.",
        "when_to_use": "As part of release preparation or whenever a signed evidence bundle is requested.",
        "expected_output": "An evidence artifact stored in JUNE and downloadable from the execution page.",
        "what_could_go_wrong": "Missing package files will stop the run because an incomplete bundle is worthless.",
        "failure_guidance": "Verify the automation package exists and republish the automation version if needed.",
    },
    {
        "name": "Secret Hygiene Sweep",
        "runner_key": "secret_sweep",
        "summary": "Scans the automation package for committed credentials and risky secret patterns.",
        "category": "Security",
        "risk_level": "HIGH",
        "tags": ["security", "secrets", "scanning"],
        "systems_affected": ["Automation package in JUNE storage"],
        "supported_environments": ["uat", "production"],
        "timeout_seconds": 180,
        "approval_required": True,
        "repository_path": "automations/secret-hygiene-sweep",
        "what_it_does": (
            "Applies deterministic secret-detection rules to every text file in the package and records findings "
            "with file and line references. Optional external scanners are used when installed."
        ),
        "why_it_exists": (
            "Credentials committed into scripts are the fastest path from a repository leak to a production "
            "compromise. The sweep keeps that check inside the governed pipeline."
        ),
        "when_to_use": "Before promoting any version, and after changing configuration or scripts.",
        "expected_output": "A scan verdict with findings and remediation advice; high-confidence secrets stop the run.",
        "what_could_go_wrong": (
            "Documentation examples can look like secrets. Placeholders are ignored, but review any finding "
            "rather than assuming it is a false positive."
        ),
        "failure_guidance": (
            "Open the failing finding, remove the credential, rotate it through the secrets provider, and publish "
            "a new automation version before retrying."
        ),
    },
    {
        "name": "Configuration Rollout",
        "runner_key": "config_rollout",
        "summary": "Writes a validated configuration bundle into an isolated deployment directory.",
        "category": "Change Management",
        "risk_level": "HIGH",
        "tags": ["configuration", "deployment", "governed"],
        "systems_affected": ["UAT sandbox deployment", "Production deployment (simulated in this install)"],
        "supported_environments": ["uat", "production"],
        "timeout_seconds": 300,
        "approval_required": True,
        "repository_path": "automations/configuration-rollout",
        "what_it_does": (
            "Validates the requested configuration key and value, deploys the candidate package to a deployment "
            "directory and records the resulting configuration checksum."
        ),
        "why_it_exists": (
            "Configuration changes are one of the most common causes of production incidents. JUNE makes them "
            "reviewable, approved and auditable."
        ),
        "when_to_use": "When a reviewed configuration change needs to move through UAT and production with approval.",
        "expected_output": (
            "A deployment manifest with file hashes and the applied configuration. Simulated production runs are "
            "explicitly labelled and change no live system."
        ),
        "what_could_go_wrong": (
            "An unsupported key, an invalid value, failed security evidence or a missing approval will stop the "
            "promotion before anything is written."
        ),
        "failure_guidance": (
            "Read the blocked policy checks on the execution, correct the configuration or approval, then submit "
            "a new request. Never bypass the gate."
        ),
    },
]


async def _seed_automations(
    db: AsyncSession, developer: User, repository: RepositoryConnection, environments: dict[str, str]
) -> dict[str, Automation]:
    created: dict[str, Automation] = {}
    for blueprint in AUTOMATION_BLUEPRINTS:
        payload = AutomationCreate(
            **blueprint,
            team_id=developer.team_id,
            repository_id=repository.id,
            required_permissions=["executions:create"],
        )
        automation = await automation_service.create_automation(db, developer, payload)
        automation.is_sample = True
        automation.updated_at = utcnow()
        await db.commit()
        created[automation.runner_key] = automation
    return created


async def _seed_policies(db: AsyncSession) -> None:
    definitions = [
        {
            "key": "prod_requires_approval",
            "name": "Production requires approval",
            "severity": "BLOCK",
            "description": "Every production request pauses at an approval gate bound to the exact candidate.",
            "rules": {"environment_kind": "PRODUCTION", "requires": "APPROVAL"},
        },
        {
            "key": "separation_of_duties",
            "name": "Separation of duties",
            "severity": "BLOCK",
            "description": "The requester of a production deployment can never approve it.",
            "rules": {"requester_may_approve": False, "approver_must_differ": True},
        },
        {
            "key": "prod_requires_security",
            "name": "Security evidence before promotion",
            "severity": "BLOCK",
            "description": "Secret and dependency scans must pass for the exact candidate, with no open critical findings.",
            "rules": {"scan_kinds": ["SECRETS", "DEPENDENCIES"], "block_severities": ["CRITICAL", "HIGH"]},
        },
        {
            "key": "prod_requires_uat",
            "name": "UAT evidence before production",
            "severity": "BLOCK",
            "description": "Deployment workflows must pass their UAT deployment and automated test stages in the same execution.",
            "rules": {"required_stages": ["uat_deploy", "automated_test"]},
        },
        {
            "key": "allowlisted_runners",
            "name": "Allowlisted execution runners",
            "severity": "BLOCK",
            "description": "Only registered runner templates can execute. Uploaded code is never executed directly.",
            "rules": {"runner_registry": "app.core.constants.RUNNER_TEMPLATES"},
        },
        {
            "key": "immutable_candidate",
            "name": "Immutable deployment candidate",
            "severity": "BLOCK",
            "description": "An approval stops applying if the automation version, workflow, environment, target group or parameters change.",
            "rules": {"hash_inputs": ["automation_version", "workflow_checksum", "environment", "server_group", "params"]},
        },
        {
            "key": "no_plaintext_secrets",
            "name": "Credentials by reference only",
            "severity": "BLOCK",
            "description": "JUNE stores only references to credentials held in an approved secrets provider.",
            "rules": {"stores_plaintext_credentials": False, "requires_provider_reference": True},
        },
        {
            "key": "audit_append_only",
            "name": "Append-only chronicle",
            "severity": "BLOCK",
            "description": "Audit records are hash-chained and the application exposes no update or delete path.",
            "rules": {"hash_chain": "SHA-256", "mutable": False},
        },
    ]
    for definition in definitions:
        db.add(Policy(mode="RULE_ENGINE", applies_to="EXECUTION", is_active=True, version=1, **definition))
    await db.commit()


async def _wait_for_execution(
    execution_id: str, statuses: set[str], timeout_seconds: float = 45.0
) -> Execution | None:
    deadline = asyncio.get_running_loop().time() + timeout_seconds
    while asyncio.get_running_loop().time() < deadline:
        async with SessionLocal() as db:
            execution = await db.get(Execution, execution_id)
            if execution is not None and execution.status in statuses:
                return execution
        await asyncio.sleep(0.25)
    logger.warning("seed_execution_timeout", extra={"execution_id": execution_id})
    return None


async def _seed_sample_executions(
    db: AsyncSession,
    users: dict[str, User],
    automations: dict[str, Automation],
    environments: dict[str, str],
) -> None:
    uat_id = environments["uat"]
    production_id = environments["production"]

    uat_group = (
        await db.execute(select(ServerGroup).where(ServerGroup.environment_id == uat_id))
    ).scalars().first()
    production_group = (
        await db.execute(select(ServerGroup).where(ServerGroup.environment_id == production_id))
    ).scalars().first()

    ops = users["daniel_okafor"]
    developer = users["priya_nair"]

    db_integrity_run = await execution_service.submit_execution(
        db,
        ops,
        ExecutionCreate(
            automation_id=automations["db_integrity"].id,
            environment_id=uat_id,
            server_group_id=uat_group.id if uat_group else None,
            params={"include_row_counts": True},
            reason="Baseline verification of the JUNE control-plane database during platform setup.",
            idempotency_key=f"seed-db-integrity-{utcnow().date().isoformat()}",
        ),
    )
    await _wait_for_execution(db_integrity_run.id, {"SUCCEEDED", "FAILED", "BLOCKED", "TIMED_OUT"})

    evidence_run = await execution_service.submit_execution(
        db,
        developer,
        ExecutionCreate(
            automation_id=automations["artifact_export"].id,
            environment_id=uat_id,
            server_group_id=uat_group.id if uat_group else None,
            params={"label": "baseline-release-evidence"},
            reason="Produce the initial release evidence bundle for the automation library.",
            idempotency_key=f"seed-evidence-{utcnow().date().isoformat()}",
        ),
    )
    await _wait_for_execution(evidence_run.id, {"SUCCEEDED", "FAILED", "BLOCKED", "TIMED_OUT"})

    production_run = await execution_service.submit_execution(
        db,
        ops,
        ExecutionCreate(
            automation_id=automations["config_rollout"].id,
            environment_id=production_id,
            server_group_id=production_group.id if production_group else None,
            params={"config_key": "LOG_LEVEL", "config_value": "INFO"},
            reason="Scheduled log-level alignment for the production API fleet (simulation adapter).",
            idempotency_key=f"seed-prod-rollout-{utcnow().date().isoformat()}",
        ),
    )
    await _wait_for_execution(
        production_run.id, {"WAITING_FOR_APPROVAL", "FAILED", "BLOCKED", "TIMED_OUT", "SUCCEEDED"}, timeout_seconds=60
    )


async def seed_if_empty(db: AsyncSession, password: str) -> bool:
    existing = int((await db.execute(select(func.count(User.id)))).scalar_one())
    if existing:
        return False

    logger.info("Seeding the JUNE sample environment (database is empty).")
    users = await _seed_identity(db, password)
    admin = users["marcus_reed"]
    environments = await _seed_infrastructure(db, admin)

    repository = RepositoryConnection(
        name="Automation library (not configured)",
        provider="git",
        url="",
        default_branch="main",
        auth_type="ssh",
        credential_ref=None,
        status="NOT_CONFIGURED",
        created_by=admin.id,
    )
    db.add(repository)
    await db.flush()

    automations = await _seed_automations(db, users["priya_nair"], repository, environments)
    await _seed_policies(db)

    await notification_service.notify_many(
        db,
        [user.id for user in users.values()],
        kind="SYSTEM",
        title="Welcome to JUNE",
        body=(
            "The sample automation library is ready. Start with Server Health Check in UAT, or open the "
            "Help Center to learn how governed runs and approvals work."
        ),
        resource_type="automation",
        resource_id=automations["health_check"].id,
    )
    await db.commit()

    await _seed_sample_executions(db, users, automations, environments)
    await approval_service.expire_approvals(db)

    await audit_service.record(
        db,
        actor=None,
        actor_label="JUNE first-run setup",
        action="platform.seeded",
        resource_type="platform",
        details={
            "automations": len(automations),
            "users": len(users),
            "environments": len(environments),
            "note": "Sample automations are labelled as samples. Executions were produced by the real engine.",
        },
    )
    await db.commit()
    logger.info("JUNE sample environment ready.")
    return True
