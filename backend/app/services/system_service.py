"""System health from real checks — never a fabricated green status."""

from __future__ import annotations

import time

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache
from app.core.config import settings
from app.core.database import utcnow
from app.models import ExecutionAgent, Integration
from app.services.analytics_service import agent_payload

APP_VERSION = "1.0.0"


async def system_health(db: AsyncSession) -> dict:
    components: list[dict] = []

    started = time.perf_counter()
    try:
        await db.execute(text("SELECT 1"))
        latency = round((time.perf_counter() - started) * 1000, 1)
        components.append(
            {
                "key": "database",
                "name": "Control-plane database",
                "status": "OK",
                "detail": f"Query round-trip {latency} ms.",
                "latency_ms": latency,
            }
        )
    except Exception as exc:
        components.append(
            {
                "key": "database",
                "name": "Control-plane database",
                "status": "DEGRADED",
                "detail": f"Database check failed ({exc.__class__.__name__}).",
                "latency_ms": None,
            }
        )

    cache_ok = await cache.ping()
    components.append(
        {
            "key": "cache",
            "name": "Cache and coordination",
            "status": "OK" if cache_ok else "DEGRADED",
            "detail": (
                f"{cache.kind} adapter responding."
                if cache_ok
                else "Cache adapter did not respond."
            ),
            "latency_ms": None,
        }
    )

    started = time.perf_counter()
    try:
        probe = settings.storage_path / ".june-health-probe"
        probe.write_text(utcnow().isoformat(), encoding="utf-8")
        probe.unlink(missing_ok=True)
        latency = round((time.perf_counter() - started) * 1000, 1)
        components.append(
            {
                "key": "storage",
                "name": "Evidence storage",
                "status": "OK",
                "detail": f"Writable at {settings.storage_path}.",
                "latency_ms": latency,
            }
        )
    except Exception as exc:
        components.append(
            {
                "key": "storage",
                "name": "Evidence storage",
                "status": "DEGRADED",
                "detail": f"Storage path is not writable ({exc.__class__.__name__}).",
                "latency_ms": None,
            }
        )

    agents = list((await db.execute(select(ExecutionAgent))).scalars().all())
    payloads = [agent_payload(agent) for agent in agents]
    online = sum(1 for agent in payloads if agent["status"] == "ONLINE")
    components.append(
        {
            "key": "execution",
            "name": "Execution plane",
            "status": "OK" if online else "DEGRADED",
            "detail": (
                f"{online} of {len(agents)} registered agent(s) reporting heartbeats."
                if agents
                else "No execution agent registered."
            ),
            "latency_ms": None,
        }
    )

    integrations = list((await db.execute(select(Integration))).scalars().all())
    configured = sum(1 for integration in integrations if integration.status == "CONFIGURED")
    errored = sum(1 for integration in integrations if integration.status == "ERROR")
    components.append(
        {
            "key": "integrations",
            "name": "Enterprise integrations",
            "status": "DEGRADED" if errored else "OK",
            "detail": f"{configured} configured · {len(integrations) - configured} awaiting configuration · {errored} reporting errors.",
            "latency_ms": None,
        }
    )

    components.append(
        {
            "key": "policy",
            "name": "Policy enforcement",
            "status": "OK",
            "detail": (
                "Open Policy Agent configured; JUNE still enforces its own safeguards."
                if settings.opa_url
                else "Built-in fail-closed rule engine active. OPA is not configured."
            ),
            "latency_ms": None,
        }
    )

    degraded = [component for component in components if component["status"] == "DEGRADED"]
    return {
        "status": "DEGRADED" if degraded else "HEALTHY",
        "version": APP_VERSION,
        "environment": settings.env,
        "generated_at": utcnow().isoformat(),
        "components": components,
    }


async def system_summary(db: AsyncSession) -> dict:
    from app.models import Approval, AuditEvent, Automation, Execution, SecurityFinding

    counts = {
        "automations": int(
            (await db.execute(select(func.count(Automation.id)).where(Automation.status == "ACTIVE"))).scalar_one()
        ),
        "executions": int((await db.execute(select(func.count(Execution.id)))).scalar_one()),
        "pending_approvals": int(
            (await db.execute(select(func.count(Approval.id)).where(Approval.status == "PENDING"))).scalar_one()
        ),
        "open_findings": int(
            (await db.execute(select(func.count(SecurityFinding.id)).where(SecurityFinding.status == "OPEN"))).scalar_one()
        ),
        "audit_events": int((await db.execute(select(func.count(AuditEvent.id)))).scalar_one()),
    }
    return {
        "version": APP_VERSION,
        "environment": settings.env,
        "database": "postgresql" if settings.database_url.startswith("postgresql") else "sqlite",
        "cache": cache.kind,
        "storage": str(settings.storage_path),
        "sandboxes": str(settings.sandbox_path),
        "integrations": {
            "total": int((await db.execute(select(func.count(Integration.id)))).scalar_one()),
            "configured": int(
                (
                    await db.execute(
                        select(func.count(Integration.id)).where(Integration.status == "CONFIGURED")
                    )
                ).scalar_one()
            ),
        },
        "counts": counts,
    }
