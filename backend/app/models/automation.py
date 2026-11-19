"""Automation registry and workflow definitions."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base, JSONColumn, TZDateTime, TimestampMixin, UUIDPrimaryKeyMixin


class RepositoryConnection(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "repository_connections"

    name: Mapped[str] = mapped_column(String(160), unique=True)
    provider: Mapped[str] = mapped_column(String(60), default="git")
    url: Mapped[str] = mapped_column(String(400), default="")
    default_branch: Mapped[str] = mapped_column(String(120), default="main")
    auth_type: Mapped[str] = mapped_column(String(40), default="ssh")
    # A reference into the approved secrets provider — never the credential itself.
    credential_ref: Mapped[str | None] = mapped_column(String(200), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="NOT_CONFIGURED")
    last_synced_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class Automation(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "automations"

    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160), index=True)
    summary: Mapped[str] = mapped_column(String(300))
    category: Mapped[str] = mapped_column(String(80), default="Operations", index=True)
    icon: Mapped[str] = mapped_column(String(60), default="workflow")
    risk_level: Mapped[str] = mapped_column(String(20), default="MEDIUM")
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE", index=True)
    is_sample: Mapped[bool] = mapped_column(Boolean, default=False)

    # Beginner-facing profile — every automation must explain itself.
    what_it_does: Mapped[str] = mapped_column(Text, default="")
    why_it_exists: Mapped[str] = mapped_column(Text, default="")
    when_to_use: Mapped[str] = mapped_column(Text, default="")
    expected_output: Mapped[str] = mapped_column(Text, default="")
    what_could_go_wrong: Mapped[str] = mapped_column(Text, default="")
    failure_guidance: Mapped[str] = mapped_column(Text, default="")
    systems_affected: Mapped[list] = mapped_column(JSONColumn, default=list)
    required_permissions: Mapped[list] = mapped_column(JSONColumn, default=list)
    tags: Mapped[list] = mapped_column(JSONColumn, default=list)
    supported_environments: Mapped[list] = mapped_column(JSONColumn, default=list)

    language: Mapped[str] = mapped_column(String(40), default="python")
    execution_type: Mapped[str] = mapped_column(String(40), default="RUNNER")
    runner_key: Mapped[str] = mapped_column(String(60), index=True)
    input_schema: Mapped[dict] = mapped_column(JSONColumn, default=dict)
    output_schema: Mapped[dict] = mapped_column(JSONColumn, default=dict)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=300)
    approval_required: Mapped[bool] = mapped_column(Boolean, default=True)
    concurrency_limit: Mapped[int] = mapped_column(Integer, default=1)

    current_version: Mapped[str] = mapped_column(String(30), default="1.0.0")
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    team_id: Mapped[str | None] = mapped_column(ForeignKey("teams.id"), nullable=True)
    repository_id: Mapped[str | None] = mapped_column(ForeignKey("repository_connections.id"), nullable=True)
    repository_path: Mapped[str] = mapped_column(String(300), default="")

    owner = relationship("User", lazy="selectin")
    team = relationship("Team", lazy="selectin")
    repository = relationship("RepositoryConnection", lazy="selectin")
    versions: Mapped[list["AutomationVersion"]] = relationship(
        back_populates="automation", order_by="AutomationVersion.created_at.desc()", lazy="selectin"
    )
    workflows: Mapped[list["Workflow"]] = relationship(back_populates="automation", lazy="selectin")


class AutomationVersion(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "automation_versions"
    __table_args__ = (UniqueConstraint("automation_id", "version", name="uq_automation_version"),)

    automation_id: Mapped[str] = mapped_column(ForeignKey("automations.id", ondelete="CASCADE"), index=True)
    version: Mapped[str] = mapped_column(String(30))
    manifest: Mapped[dict] = mapped_column(JSONColumn, default=dict)
    checksum: Mapped[str] = mapped_column(String(64))
    changelog: Mapped[str] = mapped_column(Text, default="")
    package_path: Mapped[str] = mapped_column(String(300), default="")
    status: Mapped[str] = mapped_column(String(20), default="PUBLISHED")
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    automation: Mapped[Automation] = relationship(back_populates="versions")
    creator = relationship("User", lazy="selectin")


class Workflow(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "workflows"

    automation_id: Mapped[str] = mapped_column(ForeignKey("automations.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="PUBLISHED")
    is_default: Mapped[bool] = mapped_column(Boolean, default=True)

    automation: Mapped[Automation] = relationship(back_populates="workflows")
    versions: Mapped[list["WorkflowVersion"]] = relationship(
        back_populates="workflow", order_by="WorkflowVersion.version.desc()", lazy="selectin"
    )


class WorkflowVersion(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "workflow_versions"
    __table_args__ = (UniqueConstraint("workflow_id", "version", name="uq_workflow_version"),)

    workflow_id: Mapped[str] = mapped_column(ForeignKey("workflows.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    definition: Mapped[dict] = mapped_column(JSONColumn, default=dict)
    checksum: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20), default="PUBLISHED")
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)

    workflow: Mapped[Workflow] = relationship(back_populates="versions")
