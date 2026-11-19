"""Model registry: import every model so SQLAlchemy can configure mappers."""

from app.models.automation import (
    Automation,
    AutomationVersion,
    RepositoryConnection,
    Workflow,
    WorkflowVersion,
)
from app.models.execution import (
    Approval,
    Artifact,
    Execution,
    ExecutionLog,
    ExecutionStage,
    SecurityFinding,
    SecurityScan,
)
from app.models.identity import AuthSession, Permission, Role, Team, User, role_permissions
from app.models.ops import (
    AuditEvent,
    Environment,
    ExecutionAgent,
    Integration,
    Notification,
    Policy,
    Server,
    ServerGroup,
)

__all__ = [
    "Approval",
    "Artifact",
    "AuditEvent",
    "AuthSession",
    "Automation",
    "AutomationVersion",
    "Environment",
    "Execution",
    "ExecutionAgent",
    "ExecutionLog",
    "ExecutionStage",
    "Integration",
    "Notification",
    "Permission",
    "Policy",
    "RepositoryConnection",
    "Role",
    "SecurityFinding",
    "SecurityScan",
    "Server",
    "ServerGroup",
    "Team",
    "User",
    "Workflow",
    "WorkflowVersion",
    "role_permissions",
]
