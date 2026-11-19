"""Versioned API surface: /api/v1."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import (
    admin,
    approvals,
    audit,
    auth,
    automations,
    dashboard,
    executions,
    infrastructure,
    integrations,
    notifications,
    security,
    system,
    workflows,
)

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(auth.router)
api_router.include_router(dashboard.router)
api_router.include_router(automations.router)
api_router.include_router(workflows.router)
api_router.include_router(executions.router)
api_router.include_router(approvals.router)
api_router.include_router(security.router)
api_router.include_router(audit.router)
api_router.include_router(infrastructure.router)
api_router.include_router(infrastructure.server_group_router)
api_router.include_router(infrastructure.infrastructure_router)
api_router.include_router(infrastructure.agents_router)
api_router.include_router(integrations.router)
api_router.include_router(notifications.router)
api_router.include_router(admin.router)
api_router.include_router(system.router)
