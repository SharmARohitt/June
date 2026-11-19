from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.schemas.auth import UserTiny
from app.schemas.common import APIModel


class EnvironmentMini(APIModel):
    id: str
    key: str
    name: str
    kind: str
    execution_mode: str
    approval_required: bool
    color: str


class ServerGroupMini(APIModel):
    id: str
    name: str
    slug: str
    check_protocol: str


class AutomationMini(APIModel):
    id: str
    slug: str
    name: str
    icon: str
    category: str
    risk_level: str
    current_version: str


class PolicyCheckOut(BaseModel):
    key: str
    name: str
    status: str  # PASS | WARN | FAIL
    severity: str
    message: str
    blocking: bool = False


class PreflightOut(BaseModel):
    checks: list[PolicyCheckOut]
    can_submit: bool
    requires_approval: bool
    blocking_issues: list[str]
    evaluated_by: str


class ExecutionCreate(BaseModel):
    automation_id: str
    environment_id: str
    server_group_id: str | None = None
    params: dict = Field(default_factory=dict)
    reason: str = Field(min_length=8, max_length=1000)
    idempotency_key: str | None = Field(default=None, min_length=8, max_length=120)

    @field_validator("reason")
    @classmethod
    def reason_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("A reason for execution is required")
        return value.strip()


class ExecutionPreflightRequest(BaseModel):
    automation_id: str
    environment_id: str
    server_group_id: str | None = None
    params: dict = Field(default_factory=dict)


class StageOut(APIModel):
    id: str
    key: str
    name: str
    description: str
    order_index: int
    status: str
    attempt: int
    started_at: datetime | None
    finished_at: datetime | None
    duration_ms: int | None
    output: dict
    error_message: str | None


class ApprovalMini(APIModel):
    id: str
    status: str
    requested_by: str
    decided_by: str | None
    candidate_hash: str
    comment: str
    created_at: datetime
    decided_at: datetime | None


class ExecutionSummary(APIModel):
    id: str
    display_id: str
    automation: AutomationMini
    automation_version: str
    requested_by_user: UserTiny
    environment: EnvironmentMini
    server_group: ServerGroupMini | None
    status: str
    execution_mode: str
    adapter: str
    reason: str
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    duration_ms: int | None
    current_stage: str | None = None
    progress: int = 0
    error_code: str | None
    error_message: str | None


class ExecutionDetail(ExecutionSummary):
    workflow_version_id: str
    params: dict
    candidate_hash: str
    timeout_seconds: int
    cancel_requested: bool
    result_summary: dict
    stages: list[StageOut]
    approval: ApprovalMini | None


class ExecutionLogOut(APIModel):
    id: int
    execution_id: str
    stage_key: str | None
    level: str
    source: str
    message: str
    created_at: datetime


class InsightOut(BaseModel):
    category: str
    title: str
    explanation: str
    likely_causes: list[str]
    suggested_steps: list[str]
    deterministic: bool = True


class ExecutionInsight(BaseModel):
    execution_id: str
    status: str
    insight: InsightOut | None


class CancelRequest(BaseModel):
    reason: str = Field(default="", max_length=500)


class ArtifactOut(APIModel):
    id: str
    name: str
    kind: str
    size_bytes: int
    checksum: str
    created_at: datetime
