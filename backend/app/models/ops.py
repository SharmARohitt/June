"""Operational topology, integrations, policies, audit and notifications."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import (
    Base,
    BigIntColumn,
    JSONColumn,
    TZDateTime,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class Environment(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "environments"

    key: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(20), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    execution_mode: Mapped[str] = mapped_column(String(30), default="LOCAL_SANDBOX")
    approval_required: Mapped[bool] = mapped_column(Boolean, default=False)
    color: Mapped[str] = mapped_column(String(20), default="#67D9E8")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    server_groups: Mapped[list["ServerGroup"]] = relationship(back_populates="environment", lazy="selectin")


class ServerGroup(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "server_groups"

    environment_id: Mapped[str] = mapped_column(ForeignKey("environments.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(140))
    slug: Mapped[str] = mapped_column(String(80), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    check_protocol: Mapped[str] = mapped_column(String(20), default="HTTP")

    environment: Mapped[Environment] = relationship(back_populates="server_groups")
    servers: Mapped[list["Server"]] = relationship(back_populates="group", lazy="selectin")


class Server(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "servers"

    group_id: Mapped[str] = mapped_column(ForeignKey("server_groups.id", ondelete="CASCADE"), index=True)
    hostname: Mapped[str] = mapped_column(String(160))
    display_name: Mapped[str] = mapped_column(String(160), default="")
    address: Mapped[str] = mapped_column(String(200))
    port: Mapped[int] = mapped_column(Integer, default=443)
    role: Mapped[str] = mapped_column(String(80), default="application")
    is_simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="UNKNOWN")
    last_checked_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)
    details: Mapped[dict] = mapped_column(JSONColumn, default=dict)

    group: Mapped[ServerGroup] = relationship(back_populates="servers")


class ExecutionAgent(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "execution_agents"

    name: Mapped[str] = mapped_column(String(140), unique=True)
    kind: Mapped[str] = mapped_column(String(40), default="LOCAL_SANDBOX")
    environment_id: Mapped[str | None] = mapped_column(ForeignKey("environments.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="OFFLINE")
    endpoint: Mapped[str] = mapped_column(String(300), default="")
    version: Mapped[str] = mapped_column(String(30), default="1.0.0")
    capabilities: Mapped[list] = mapped_column(JSONColumn, default=list)
    labels: Mapped[dict] = mapped_column(JSONColumn, default=dict)
    token_hash: Mapped[str] = mapped_column(String(64), default="")
    last_heartbeat_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)

    environment = relationship("Environment", lazy="selectin")


class Integration(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "integrations"

    key: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    category: Mapped[str] = mapped_column(String(60))
    description: Mapped[str] = mapped_column(Text, default="")
    setup_hint: Mapped[str] = mapped_column(Text, default="")
    docs_url: Mapped[str] = mapped_column(String(400), default="")
    status: Mapped[str] = mapped_column(String(20), default="NOT_CONFIGURED")
    config: Mapped[dict] = mapped_column(JSONColumn, default=dict)
    message: Mapped[str] = mapped_column(Text, default="")
    last_checked_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)


class Policy(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "policies"

    key: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, default="")
    severity: Mapped[str] = mapped_column(String(20), default="BLOCK")
    mode: Mapped[str] = mapped_column(String(20), default="RULE_ENGINE")
    applies_to: Mapped[str] = mapped_column(String(40), default="EXECUTION")
    rules: Mapped[dict] = mapped_column(JSONColumn, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    version: Mapped[int] = mapped_column(Integer, default=1)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(BigIntColumn, primary_key=True, autoincrement=True)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    actor_label: Mapped[str] = mapped_column(String(160), default="system")
    action: Mapped[str] = mapped_column(String(100), index=True)
    resource_type: Mapped[str] = mapped_column(String(60), index=True)
    resource_id: Mapped[str | None] = mapped_column(String(60), nullable=True, index=True)
    outcome: Mapped[str] = mapped_column(String(30), default="SUCCESS")
    details: Mapped[dict] = mapped_column(JSONColumn, default=dict)
    ip_address: Mapped[str] = mapped_column(String(60), default="")
    prev_hash: Mapped[str] = mapped_column(String(64), default="0" * 64)
    hash: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(TZDateTime, index=True)


class Notification(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "notifications"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(40), default="SYSTEM")
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    resource_type: Mapped[str | None] = mapped_column(String(60), nullable=True)
    resource_id: Mapped[str | None] = mapped_column(String(60), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, index=True)

    user = relationship("User", lazy="selectin")
