from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.auth import UserTiny
from app.schemas.common import APIModel
from app.schemas.execution import AutomationMini, EnvironmentMini, ExecutionSummary


class ApprovalOut(APIModel):
    id: str
    status: str
    automation: AutomationMini
    automation_version: str
    candidate_hash: str
    requested_by: str
    requester: UserTiny
    decided_by: str | None
    decider: UserTiny | None
    environment: EnvironmentMini
    comment: str
    decision_reason: str
    evidence: dict
    created_at: datetime
    decided_at: datetime | None
    expires_at: datetime | None
    execution: ExecutionSummary | None = None


class ApprovalDecision(BaseModel):
    comment: str = Field(min_length=4, max_length=1000)
    reason: str = Field(default="", max_length=300)


class FindingOut(APIModel):
    id: str
    severity: str
    title: str
    description: str
    file_path: str | None
    line_number: int | None
    rule_id: str | None
    remediation: str
    status: str


class ScanOut(APIModel):
    id: str
    automation: AutomationMini
    automation_version: str
    kind: str
    status: str
    scanner: str
    summary: dict
    artifact_path: str | None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    findings: list[FindingOut] = []


class PolicyOut(APIModel):
    id: str
    key: str
    name: str
    description: str
    severity: str
    mode: str
    applies_to: str
    rules: dict
    is_active: bool
    version: int


class AuditEventOut(APIModel):
    id: int
    actor_id: str | None
    actor_label: str
    action: str
    resource_type: str
    resource_id: str | None
    outcome: str
    details: dict
    ip_address: str
    prev_hash: str
    hash: str
    created_at: datetime


class AuditIntegrityOut(BaseModel):
    valid: bool
    checked_events: int
    first_invalid_event_id: int | None = None
    message: str


class NotificationOut(APIModel):
    id: str
    kind: str
    title: str
    body: str
    resource_type: str | None
    resource_id: str | None
    read_at: datetime | None
    created_at: datetime


class EnvironmentOut(APIModel):
    id: str
    key: str
    name: str
    kind: str
    description: str
    execution_mode: str
    approval_required: bool
    color: str
    sort_order: int
    is_active: bool
    server_count: int = 0
    group_count: int = 0
    last_execution_at: datetime | None = None


class EnvironmentCreate(BaseModel):
    key: str = Field(pattern=r"^[a-z][a-z0-9-]{1,30}$")
    name: str = Field(min_length=2, max_length=120)
    kind: str = Field(pattern="^(DEVELOPMENT|UAT|PRODUCTION)$")
    description: str = ""
    execution_mode: str = Field(default="LOCAL_SANDBOX", pattern="^(LOCAL_SANDBOX|SIMULATION|REMOTE_AGENT)$")
    approval_required: bool = False
    color: str = "#67D9E8"


class ServerOut(APIModel):
    id: str
    hostname: str
    display_name: str
    address: str
    port: int
    role: str
    is_simulated: bool
    status: str
    last_checked_at: datetime | None
    details: dict


class ServerGroupOut(APIModel):
    id: str
    name: str
    slug: str
    description: str
    check_protocol: str
    environment_id: str
    servers: list[ServerOut] = []


class AgentOut(APIModel):
    id: str
    name: str
    kind: str
    environment_id: str | None
    status: str
    endpoint: str
    version: str
    capabilities: list
    labels: dict
    last_heartbeat_at: datetime | None


class IntegrationOut(APIModel):
    id: str
    key: str
    name: str
    category: str
    description: str
    setup_hint: str
    docs_url: str
    status: str
    config: dict
    message: str
    last_checked_at: datetime | None


class IntegrationTestResult(BaseModel):
    key: str
    status: str
    message: str
    checked_at: datetime
    latency_ms: float | None = None


class KpiCard(BaseModel):
    key: str
    label: str
    value: float | int
    unit: str | None = None
    delta: float | None = None
    trend: str | None = None
    help: str
    href: str


class SeriesPoint(BaseModel):
    label: str
    succeeded: int = 0
    failed: int = 0
    blocked: int = 0
    total: int = 0


class DashboardOverview(BaseModel):
    generated_at: datetime
    range_days: int
    kpis: list[KpiCard]
    execution_series: list[SeriesPoint]
    environment_health: list[dict]
    recent_executions: list[ExecutionSummary]
    recent_failures: list[ExecutionSummary]
    pending_approvals: list[ApprovalOut]
    recent_audit: list[AuditEventOut]
    active_alerts: list[dict]
    live_pulse: dict


class AutomationAnalytics(BaseModel):
    automation_id: str
    name: str
    executions: int
    success_rate: float | None
    avg_duration_ms: int | None


class FailureBreakdown(BaseModel):
    code: str
    label: str
    count: int


class AnalyticsOverview(BaseModel):
    range_days: int
    total_executions: int
    success_rate: float | None
    avg_duration_ms: int | None
    by_day: list[SeriesPoint]
    by_automation: list[AutomationAnalytics]
    by_environment: list[dict]
    failures: list[FailureBreakdown]
    approvals: dict


class PulseSnapshot(BaseModel):
    generated_at: datetime
    active_executions: list[ExecutionSummary]
    queue_depth: int
    runner_utilization: float
    agents: list[AgentOut]
    failure_rate_24h: float | None
    recent_events: list[AuditEventOut]
    environment_health: list[dict]
    stale: bool = False


class EnvironmentDetail(EnvironmentOut):
    groups: list[ServerGroupOut] = []
    agents: list[AgentOut] = []


class ServerGroupCreate(BaseModel):
    name: str = Field(min_length=2, max_length=140)
    description: str = Field(default="", max_length=400)
    check_protocol: str = Field(default="HTTP", pattern="^(HTTP|HTTPS|TCP)$")


class ServerCreate(BaseModel):
    hostname: str = Field(min_length=2, max_length=160)
    display_name: str = Field(default="", max_length=160)
    address: str = Field(min_length=1, max_length=200)
    port: int = Field(default=443, ge=1, le=65535)
    role: str = Field(default="application", max_length=80)
    is_simulated: bool = False


class AgentCreate(BaseModel):
    name: str = Field(min_length=2, max_length=140)
    kind: str = Field(default="REMOTE_AGENT", pattern="^(LOCAL_SANDBOX|REMOTE_AGENT|KUBERNETES)$")
    environment_id: str | None = None
    endpoint: str = Field(default="", max_length=300)
    capabilities: list[str] = []
    labels: dict = {}


class AgentHeartbeat(BaseModel):
    version: str = Field(default="1.0.0", max_length=30)
    capabilities: list[str] | None = None
    labels: dict | None = None
    status: str = Field(default="ONLINE", pattern="^(ONLINE|STALE|OFFLINE)$")
