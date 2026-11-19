"""Execution, approvals, security evidence and artifacts."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import (
    Base,
    BigIntColumn,
    JSONColumn,
    TZDateTime,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class Execution(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "executions"
    __table_args__ = (
        UniqueConstraint("requested_by", "idempotency_key", name="uq_execution_idempotency"),
        Index("ix_executions_status_created", "status", "created_at"),
        Index("ix_executions_automation_created", "automation_id", "created_at"),
        Index("ix_executions_environment_created", "environment_id", "created_at"),
    )

    display_id: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    automation_id: Mapped[str] = mapped_column(ForeignKey("automations.id"), index=True)
    automation_version: Mapped[str] = mapped_column(String(30))
    workflow_version_id: Mapped[str] = mapped_column(ForeignKey("workflow_versions.id"))
    requested_by: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    environment_id: Mapped[str] = mapped_column(ForeignKey("environments.id"), index=True)
    server_group_id: Mapped[str | None] = mapped_column(ForeignKey("server_groups.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="QUEUED", index=True)
    params: Mapped[dict] = mapped_column(JSONColumn, default=dict)
    reason: Mapped[str] = mapped_column(Text, default="")
    idempotency_key: Mapped[str | None] = mapped_column(String(120), nullable=True)
    candidate_hash: Mapped[str] = mapped_column(String(64), index=True)
    adapter: Mapped[str] = mapped_column(String(60), default="local_sandbox")
    execution_mode: Mapped[str] = mapped_column(String(30), default="LOCAL_SANDBOX")
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=300)
    started_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_summary: Mapped[dict] = mapped_column(JSONColumn, default=dict)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    security_scan_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    automation = relationship("Automation", lazy="selectin")
    requested_by_user = relationship("User", lazy="selectin")
    environment = relationship("Environment", lazy="selectin")
    server_group = relationship("ServerGroup", lazy="selectin")
    stages: Mapped[list["ExecutionStage"]] = relationship(
        back_populates="execution", order_by="ExecutionStage.order_index", lazy="selectin"
    )
    approval: Mapped["Approval | None"] = relationship(
        back_populates="execution", uselist=False, lazy="selectin"
    )


class ExecutionStage(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "execution_stages"
    __table_args__ = (UniqueConstraint("execution_id", "key", name="uq_execution_stage_key"),)

    execution_id: Mapped[str] = mapped_column(ForeignKey("executions.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(60))
    name: Mapped[str] = mapped_column(String(140))
    description: Mapped[str] = mapped_column(Text, default="")
    order_index: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(30), default="PENDING")
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    started_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output: Mapped[dict] = mapped_column(JSONColumn, default=dict)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    execution: Mapped[Execution] = relationship(back_populates="stages")


class ExecutionLog(Base):
    __tablename__ = "execution_logs"
    __table_args__ = (Index("ix_execution_logs_execution_created", "execution_id", "created_at"),)

    id: Mapped[int] = mapped_column(BigIntColumn, primary_key=True, autoincrement=True)
    execution_id: Mapped[str] = mapped_column(ForeignKey("executions.id", ondelete="CASCADE"), index=True)
    stage_key: Mapped[str | None] = mapped_column(String(60), nullable=True)
    level: Mapped[str] = mapped_column(String(12), default="INFO")
    source: Mapped[str] = mapped_column(String(60), default="june")
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, index=True)


class Approval(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "approvals"
    __table_args__ = (
        Index("ix_approvals_status_created", "status", "created_at"),
        Index("ix_approvals_environment_status", "environment_id", "status"),
    )

    execution_id: Mapped[str] = mapped_column(ForeignKey("executions.id", ondelete="CASCADE"), unique=True, index=True)
    automation_id: Mapped[str] = mapped_column(ForeignKey("automations.id"), index=True)
    requested_by: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    candidate_hash: Mapped[str] = mapped_column(String(64), index=True)
    automation_version: Mapped[str] = mapped_column(String(30))
    workflow_version_id: Mapped[str] = mapped_column(ForeignKey("workflow_versions.id"))
    environment_id: Mapped[str] = mapped_column(ForeignKey("environments.id"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="PENDING", index=True)
    decided_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)
    comment: Mapped[str] = mapped_column(Text, default="")
    decision_reason: Mapped[str] = mapped_column(Text, default="")
    evidence: Mapped[dict] = mapped_column(JSONColumn, default=dict)
    expires_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)

    execution: Mapped[Execution] = relationship(back_populates="approval")
    automation = relationship("Automation", lazy="selectin")
    requester = relationship("User", foreign_keys=[requested_by], lazy="selectin")
    decider = relationship("User", foreign_keys=[decided_by], lazy="selectin")
    environment = relationship("Environment", lazy="selectin")
    workflow_version = relationship("WorkflowVersion", lazy="selectin")


class SecurityScan(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "security_scans"

    automation_id: Mapped[str] = mapped_column(ForeignKey("automations.id", ondelete="CASCADE"), index=True)
    automation_version: Mapped[str] = mapped_column(String(30))
    execution_id: Mapped[str | None] = mapped_column(ForeignKey("executions.id"), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(30), index=True)
    status: Mapped[str] = mapped_column(String(20), default="PENDING", index=True)
    triggered_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    scanner: Mapped[str] = mapped_column(String(80), default="june-builtin")
    summary: Mapped[dict] = mapped_column(JSONColumn, default=dict)
    artifact_path: Mapped[str | None] = mapped_column(String(400), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TZDateTime)

    findings: Mapped[list["SecurityFinding"]] = relationship(
        back_populates="scan", cascade="all, delete-orphan", lazy="selectin"
    )
    automation = relationship("Automation", lazy="selectin")
    triggerer = relationship("User", lazy="selectin")


class SecurityFinding(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "security_findings"

    scan_id: Mapped[str] = mapped_column(ForeignKey("security_scans.id", ondelete="CASCADE"), index=True)
    severity: Mapped[str] = mapped_column(String(20), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    file_path: Mapped[str | None] = mapped_column(String(300), nullable=True)
    line_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rule_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    remediation: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="OPEN")

    scan: Mapped[SecurityScan] = relationship(back_populates="findings")


class Artifact(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "artifacts"

    execution_id: Mapped[str | None] = mapped_column(ForeignKey("executions.id", ondelete="CASCADE"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(40), default="REPORT")
    path: Mapped[str] = mapped_column(String(400))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    checksum: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(TZDateTime)
