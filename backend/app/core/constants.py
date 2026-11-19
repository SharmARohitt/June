"""Shared domain vocabulary. Stored as strings in the database, validated here."""

from __future__ import annotations

from enum import StrEnum


class RoleKey(StrEnum):
    SUPER_ADMIN = "SUPER_ADMIN"
    PLATFORM_ADMIN = "PLATFORM_ADMIN"
    AUTOMATION_DEVELOPER = "AUTOMATION_DEVELOPER"
    OPERATIONS_ENGINEER = "OPERATIONS_ENGINEER"
    SECURITY_REVIEWER = "SECURITY_REVIEWER"
    APPROVER = "APPROVER"
    VIEWER = "VIEWER"


class Permission(StrEnum):
    AUTOMATIONS_READ = "automations:read"
    AUTOMATIONS_WRITE = "automations:write"
    AUTOMATIONS_ARCHIVE = "automations:archive"
    PIPELINES_READ = "pipelines:read"
    PIPELINES_WRITE = "pipelines:write"
    EXECUTIONS_READ = "executions:read"
    EXECUTIONS_CREATE = "executions:create"
    EXECUTIONS_CREATE_PRODUCTION = "executions:create:production"
    EXECUTIONS_CANCEL = "executions:cancel"
    APPROVALS_READ = "approvals:read"
    APPROVALS_DECIDE = "approvals:decide"
    SECURITY_READ = "security:read"
    SECURITY_RUN = "security:run"
    INFRASTRUCTURE_READ = "infrastructure:read"
    INFRASTRUCTURE_WRITE = "infrastructure:write"
    ANALYTICS_READ = "analytics:read"
    AUDIT_READ = "audit:read"
    INTEGRATIONS_READ = "integrations:read"
    INTEGRATIONS_WRITE = "integrations:write"
    ADMIN_USERS = "admin:users"
    ADMIN_ROLES = "admin:roles"
    ADMIN_ENVIRONMENTS = "admin:environments"
    ADMIN_SETTINGS = "admin:settings"


class ExecutionStatus(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    WAITING_FOR_APPROVAL = "WAITING_FOR_APPROVAL"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    TIMED_OUT = "TIMED_OUT"
    BLOCKED = "BLOCKED"


TERMINAL_EXECUTION_STATUSES = {
    ExecutionStatus.SUCCEEDED,
    ExecutionStatus.FAILED,
    ExecutionStatus.CANCELLED,
    ExecutionStatus.TIMED_OUT,
    ExecutionStatus.BLOCKED,
}


class StageStatus(StrEnum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"
    WAITING_FOR_APPROVAL = "WAITING_FOR_APPROVAL"
    CANCELLED = "CANCELLED"


class ApprovalStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    INVALIDATED = "INVALIDATED"
    EXPIRED = "EXPIRED"


class EnvironmentKind(StrEnum):
    DEVELOPMENT = "DEVELOPMENT"
    UAT = "UAT"
    PRODUCTION = "PRODUCTION"


class ExecutionMode(StrEnum):
    LOCAL_SANDBOX = "LOCAL_SANDBOX"
    SIMULATION = "SIMULATION"
    REMOTE_AGENT = "REMOTE_AGENT"


class ScanKind(StrEnum):
    SECRETS = "SECRETS"
    DEPENDENCIES = "DEPENDENCIES"
    VULNERABILITIES = "VULNERABILITIES"
    SBOM = "SBOM"
    POLICY = "POLICY"


class ScanStatus(StrEnum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    PASSED = "PASSED"
    FAILED = "FAILED"
    ERROR = "ERROR"


class Severity(StrEnum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    INFO = "INFO"


class FindingStatus(StrEnum):
    OPEN = "OPEN"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    RESOLVED = "RESOLVED"
    FALSE_POSITIVE = "FALSE_POSITIVE"


class IntegrationStatus(StrEnum):
    CONFIGURED = "CONFIGURED"
    NOT_CONFIGURED = "NOT_CONFIGURED"
    ERROR = "ERROR"


class AgentStatus(StrEnum):
    ONLINE = "ONLINE"
    STALE = "STALE"
    OFFLINE = "OFFLINE"


class AutomationStatus(StrEnum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"


class WorkflowStatus(StrEnum):
    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"
    ARCHIVED = "ARCHIVED"


class NotificationKind(StrEnum):
    APPROVAL_REQUESTED = "APPROVAL_REQUESTED"
    APPROVAL_DECIDED = "APPROVAL_DECIDED"
    EXECUTION_FINISHED = "EXECUTION_FINISHED"
    EXECUTION_FAILED = "EXECUTION_FAILED"
    SECURITY_FINDING = "SECURITY_FINDING"
    SYSTEM = "SYSTEM"


class RunnerKey(StrEnum):
    HEALTH_CHECK = "health_check"
    LOG_AUDIT = "log_audit"
    DB_INTEGRITY = "db_integrity"
    CACHE_WARMUP = "cache_warmup"
    ARTIFACT_EXPORT = "artifact_export"
    SECRET_SWEEP = "secret_sweep"
    CONFIG_ROLLOUT = "config_rollout"


class PolicyMode(StrEnum):
    RULE_ENGINE = "RULE_ENGINE"
    OPA = "OPA"


ROLE_PERMISSIONS: dict[str, set[str]] = {
    RoleKey.SUPER_ADMIN: {p.value for p in Permission},
    RoleKey.PLATFORM_ADMIN: {
        Permission.AUTOMATIONS_READ,
        Permission.AUTOMATIONS_WRITE,
        Permission.AUTOMATIONS_ARCHIVE,
        Permission.PIPELINES_READ,
        Permission.PIPELINES_WRITE,
        Permission.EXECUTIONS_READ,
        Permission.EXECUTIONS_CREATE,
        Permission.EXECUTIONS_CREATE_PRODUCTION,
        Permission.EXECUTIONS_CANCEL,
        Permission.APPROVALS_READ,
        Permission.SECURITY_READ,
        Permission.SECURITY_RUN,
        Permission.INFRASTRUCTURE_READ,
        Permission.INFRASTRUCTURE_WRITE,
        Permission.ANALYTICS_READ,
        Permission.AUDIT_READ,
        Permission.INTEGRATIONS_READ,
        Permission.INTEGRATIONS_WRITE,
        Permission.ADMIN_USERS,
        Permission.ADMIN_ROLES,
        Permission.ADMIN_ENVIRONMENTS,
        Permission.ADMIN_SETTINGS,
    },
    RoleKey.AUTOMATION_DEVELOPER: {
        Permission.AUTOMATIONS_READ,
        Permission.AUTOMATIONS_WRITE,
        Permission.AUTOMATIONS_ARCHIVE,
        Permission.PIPELINES_READ,
        Permission.PIPELINES_WRITE,
        Permission.EXECUTIONS_READ,
        Permission.EXECUTIONS_CREATE,
        Permission.EXECUTIONS_CANCEL,
        Permission.SECURITY_READ,
        Permission.SECURITY_RUN,
        Permission.INFRASTRUCTURE_READ,
        Permission.ANALYTICS_READ,
        Permission.AUDIT_READ,
        Permission.APPROVALS_READ,
    },
    RoleKey.OPERATIONS_ENGINEER: {
        Permission.AUTOMATIONS_READ,
        Permission.PIPELINES_READ,
        Permission.EXECUTIONS_READ,
        Permission.EXECUTIONS_CREATE,
        Permission.EXECUTIONS_CREATE_PRODUCTION,
        Permission.EXECUTIONS_CANCEL,
        Permission.APPROVALS_READ,
        Permission.SECURITY_READ,
        Permission.INFRASTRUCTURE_READ,
        Permission.ANALYTICS_READ,
        Permission.AUDIT_READ,
    },
    RoleKey.SECURITY_REVIEWER: {
        Permission.AUTOMATIONS_READ,
        Permission.PIPELINES_READ,
        Permission.EXECUTIONS_READ,
        Permission.SECURITY_READ,
        Permission.SECURITY_RUN,
        Permission.INFRASTRUCTURE_READ,
        Permission.ANALYTICS_READ,
        Permission.AUDIT_READ,
        Permission.APPROVALS_READ,
    },
    RoleKey.APPROVER: {
        Permission.AUTOMATIONS_READ,
        Permission.PIPELINES_READ,
        Permission.EXECUTIONS_READ,
        Permission.APPROVALS_READ,
        Permission.APPROVALS_DECIDE,
        Permission.SECURITY_READ,
        Permission.INFRASTRUCTURE_READ,
        Permission.ANALYTICS_READ,
        Permission.AUDIT_READ,
    },
    RoleKey.VIEWER: {
        Permission.AUTOMATIONS_READ,
        Permission.PIPELINES_READ,
        Permission.EXECUTIONS_READ,
        Permission.SECURITY_READ,
        Permission.INFRASTRUCTURE_READ,
        Permission.ANALYTICS_READ,
        Permission.APPROVALS_READ,
    },
}

ROLE_DEFINITIONS: dict[str, tuple[str, str]] = {
    RoleKey.SUPER_ADMIN: ("Super Administrator", "Unrestricted platform administration with full audit trail."),
    RoleKey.PLATFORM_ADMIN: ("Platform Administrator", "Runs the platform: registry, pipelines, environments and integrations."),
    RoleKey.AUTOMATION_DEVELOPER: ("Automation Developer", "Builds and validates automations; requests UAT executions."),
    RoleKey.OPERATIONS_ENGINEER: ("Operations Engineer", "Operates approved automations and requests governed production runs."),
    RoleKey.SECURITY_REVIEWER: ("Security Reviewer", "Reviews scan evidence, policies and security posture."),
    RoleKey.APPROVER: ("Approver", "Reviews evidence and decides production approvals. Cannot approve their own requests."),
    RoleKey.VIEWER: ("Viewer", "Read-only visibility across the platform."),
}

RUNNER_TEMPLATES: dict[str, dict] = {
    RunnerKey.HEALTH_CHECK: {
        "name": "Server Health Check",
        "category": "Reliability",
        "summary": "Checks whether the servers in a target group are reachable and responding.",
        "params_schema": {
            "type": "object",
            "properties": {
                "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 30, "default": 5},
                "http_path": {"type": "string", "maxLength": 120, "default": "/health"},
                "include_agent_heartbeat": {"type": "boolean", "default": True},
            },
            "additionalProperties": False,
        },
    },
    RunnerKey.LOG_AUDIT: {
        "name": "Log Retention Audit",
        "category": "Operations",
        "summary": "Audits an approved sandbox log directory for size and retention problems.",
        "params_schema": {
            "type": "object",
            "properties": {
                "max_file_mb": {"type": "integer", "minimum": 1, "maximum": 2048, "default": 50},
                "older_than_days": {"type": "integer", "minimum": 1, "maximum": 365, "default": 30},
            },
            "additionalProperties": False,
        },
    },
    RunnerKey.DB_INTEGRITY: {
        "name": "Database Integrity Check",
        "category": "Data",
        "summary": "Runs integrity and row-count checks against the JUNE control-plane database.",
        "params_schema": {
            "type": "object",
            "properties": {
                "include_row_counts": {"type": "boolean", "default": True},
            },
            "additionalProperties": False,
        },
    },
    RunnerKey.CACHE_WARMUP: {
        "name": "Cache Warmup",
        "category": "Performance",
        "summary": "Calls approved HTTP endpoints in a target group to warm caches before traffic.",
        "params_schema": {
            "type": "object",
            "properties": {
                "http_paths": {
                    "type": "array",
                    "items": {"type": "string", "maxLength": 120},
                    "minItems": 1,
                    "maxItems": 5,
                    "default": ["/health"],
                },
                "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 30, "default": 5},
            },
            "additionalProperties": False,
        },
    },
    RunnerKey.ARTIFACT_EXPORT: {
        "name": "Release Evidence Bundle",
        "category": "Compliance",
        "summary": "Packages hashes of deployed files into a signed evidence artifact for release records.",
        "params_schema": {
            "type": "object",
            "properties": {"label": {"type": "string", "maxLength": 80, "default": "release-evidence"}},
            "additionalProperties": False,
        },
    },
    RunnerKey.SECRET_SWEEP: {
        "name": "Secret Hygiene Sweep",
        "category": "Security",
        "summary": "Scans the automation package for accidentally committed credentials and risky patterns.",
        "params_schema": {
            "type": "object",
            "properties": {
                "fail_on_high": {"type": "boolean", "default": True},
            },
            "additionalProperties": False,
        },
    },
    RunnerKey.CONFIG_ROLLOUT: {
        "name": "Configuration Rollout",
        "category": "Change Management",
        "summary": "Writes a validated configuration bundle into an isolated sandbox deployment directory.",
        "params_schema": {
            "type": "object",
            "properties": {
                "config_key": {"type": "string", "enum": ["LOG_LEVEL", "RATE_LIMIT", "FEATURE_FLAGS"], "default": "LOG_LEVEL"},
                "config_value": {"type": "string", "minLength": 1, "maxLength": 200, "default": "INFO"},
            },
            "additionalProperties": False,
        },
    },
}

STAGE_LIBRARY: dict[str, dict] = {
    "source_checkout": {"name": "Source Checkout", "description": "Verifies the approved automation package and checksum."},
    "input_validation": {"name": "Input Validation", "description": "Validates parameters against the published input schema."},
    "security_scan": {"name": "Security Scan", "description": "Runs secret and package policy checks."},
    "uat_deploy": {"name": "UAT Deployment", "description": "Deploys the candidate to the isolated UAT sandbox."},
    "automated_test": {"name": "Automated Test", "description": "Runs deterministic smoke checks against the candidate."},
    "approval_gate": {"name": "Approval Gate", "description": "Waits for a bound, separation-of-duties approval."},
    "production_deploy": {"name": "Production Deployment", "description": "Promotes the exact approved candidate."},
    "verification": {"name": "Verification", "description": "Verifies the deployed files and live service responses."},
}
