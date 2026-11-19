from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.auth import UserTiny
from app.schemas.common import APIModel


class RepositoryOut(APIModel):
    id: str
    name: str
    provider: str
    url: str
    default_branch: str
    status: str
    last_synced_at: datetime | None


class VersionOut(APIModel):
    id: str
    version: str
    checksum: str
    changelog: str
    status: str
    created_at: datetime
    created_by: str | None = None
    manifest: dict


class WorkflowVersionOut(APIModel):
    id: str
    version: int
    checksum: str
    status: str
    published_at: datetime | None
    definition: dict


class WorkflowOut(APIModel):
    id: str
    name: str
    description: str
    status: str
    is_default: bool
    automation_id: str
    versions: list[WorkflowVersionOut] = []


class WorkflowListItem(WorkflowOut):
    automation_name: str
    automation_slug: str
    automation_icon: str


class AutomationSummary(APIModel):
    id: str
    slug: str
    name: str
    summary: str
    category: str
    icon: str
    risk_level: str
    status: str
    tags: list[str]
    supported_environments: list[str]
    current_version: str
    approval_required: bool
    timeout_seconds: int
    is_sample: bool
    owner: UserTiny | None = None
    team_name: str | None = None
    created_at: datetime
    updated_at: datetime
    execution_count: int = 0
    success_rate: float | None = None
    last_execution_at: datetime | None = None
    last_execution_status: str | None = None


class AutomationDetail(AutomationSummary):
    what_it_does: str
    why_it_exists: str
    when_to_use: str
    expected_output: str
    what_could_go_wrong: str
    failure_guidance: str
    systems_affected: list[str]
    required_permissions: list[str]
    language: str
    execution_type: str
    runner_key: str
    input_schema: dict
    output_schema: dict
    concurrency_limit: int
    repository_path: str
    repository: RepositoryOut | None
    versions: list[VersionOut]
    workflow: WorkflowOut | None


class AutomationCreate(BaseModel):
    name: str = Field(min_length=3, max_length=160)
    slug: str | None = Field(default=None, max_length=120, pattern=r"^[a-z0-9][a-z0-9-]*$")
    summary: str = Field(min_length=10, max_length=300)
    category: str = Field(default="Operations", max_length=80)
    risk_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] = "MEDIUM"
    runner_key: str
    what_it_does: str = Field(min_length=10)
    why_it_exists: str = Field(min_length=10)
    when_to_use: str = Field(min_length=5)
    expected_output: str = Field(min_length=5)
    what_could_go_wrong: str = Field(min_length=5)
    failure_guidance: str = Field(min_length=5)
    systems_affected: list[str] = []
    required_permissions: list[str] = []
    tags: list[str] = []
    supported_environments: list[str] = ["uat"]
    timeout_seconds: int = Field(default=300, ge=10, le=3600)
    approval_required: bool = True
    repository_path: str = Field(default="", max_length=300)
    repository_id: str | None = None
    team_id: str | None = None
    input_schema: dict | None = None

    @field_validator("tags", "systems_affected", "required_permissions", "supported_environments")
    @classmethod
    def unique_items(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(item.strip() for item in value if item.strip()))


class AutomationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=3, max_length=160)
    summary: str | None = Field(default=None, min_length=10, max_length=300)
    category: str | None = None
    risk_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] | None = None
    what_it_does: str | None = None
    why_it_exists: str | None = None
    when_to_use: str | None = None
    expected_output: str | None = None
    what_could_go_wrong: str | None = None
    failure_guidance: str | None = None
    systems_affected: list[str] | None = None
    required_permissions: list[str] | None = None
    tags: list[str] | None = None
    supported_environments: list[str] | None = None
    timeout_seconds: int | None = Field(default=None, ge=10, le=3600)
    approval_required: bool | None = None
    repository_path: str | None = None


class RunnerTemplateOut(BaseModel):
    key: str
    name: str
    category: str
    summary: str
    params_schema: dict


class WorkflowNode(BaseModel):
    id: str
    type: str
    stage_key: str
    label: str
    description: str = ""
    position: dict[str, float]
    config: dict[str, Any] = {}


class WorkflowEdge(BaseModel):
    id: str
    source: str
    target: str
    condition: str | None = None


class WorkflowDefinition(BaseModel):
    nodes: list[WorkflowNode]
    edges: list[WorkflowEdge]
    version: int = Field(ge=1, le=1000)

    @field_validator("edges")
    @classmethod
    def no_duplicate_edges(cls, value: list[WorkflowEdge]) -> list[WorkflowEdge]:
        seen = set()
        for edge in value:
            if (edge.source, edge.target) in seen:
                raise ValueError("Duplicate workflow edge")
            seen.add((edge.source, edge.target))
        return value


class WorkflowSave(BaseModel):
    name: str = Field(default="Default workflow", max_length=160)
    definition: WorkflowDefinition


class WorkflowValidate(BaseModel):
    definition: WorkflowDefinition


class WorkflowValidationIssue(BaseModel):
    severity: Literal["error", "warning"]
    node_id: str | None = None
    message: str


class WorkflowValidationResult(BaseModel):
    valid: bool
    issues: list[WorkflowValidationIssue]
    checksum: str
