"""Integration configuration truth.

JUNE never reports a connected integration unless it is actually configured, and
connection tests report real results. Missing integrations show setup guidance.
"""

from __future__ import annotations

import shutil
import time

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cache
from app.core.config import settings
from app.core.constants import IntegrationStatus
from app.core.database import utcnow
from app.core.errors import not_found
from app.models import Integration, User
from app.services import audit_service


INTEGRATION_DEFINITIONS = [
    {
        "key": "jenkins",
        "name": "Jenkins",
        "category": "CI / CD",
        "description": "Legacy job execution. JUNE can surface Jenkins job status through an adapter; JUNE itself does not require Jenkins to execute automations.",
        "setup_hint": "Set JUNE_JENKINS_URL, JUNE_JENKINS_USER and JUNE_JENKINS_TOKEN, then test the connection.",
        "docs_url": "https://www.jenkins.io/doc/book/managing/security/",
    },
    {
        "key": "buildpiper",
        "name": "BuildPiper",
        "category": "CI / CD",
        "description": "Enterprise delivery platform adapter (subject to licensing and supported APIs).",
        "setup_hint": "Set JUNE_BUILDPIPER_URL and JUNE_BUILDPIPER_TOKEN. The adapter is built to the provider abstraction; commercial API endpoints are not assumed.",
        "docs_url": "",
    },
    {
        "key": "argo",
        "name": "Argo Workflows",
        "category": "Orchestration",
        "description": "Optional Kubernetes-native workflow provider. The JUNE orchestration adapter keeps workflow business logic provider-neutral.",
        "setup_hint": "Set JUNE_ARGO_URL and JUNE_ARGO_TOKEN for the Argo server.",
        "docs_url": "https://argo-workflows.readthedocs.io/",
    },
    {
        "key": "keycloak",
        "name": "Keycloak SSO",
        "category": "Identity",
        "description": "Enterprise identity federation. Local JUNE accounts remain available until SSO is configured.",
        "setup_hint": "Set JUNE_KEYCLOAK_ISSUER to the realm issuer URL. OIDC discovery must be reachable from the backend.",
        "docs_url": "https://www.keycloak.org/documentation",
    },
    {
        "key": "openbao",
        "name": "OpenBao",
        "category": "Secrets",
        "description": "Secrets provider for execution credentials. JUNE stores only references, never plaintext secrets.",
        "setup_hint": "Set JUNE_OPENBAO_ADDR and a scoped JUNE_OPENBAO_TOKEN. Use least-privilege policies.",
        "docs_url": "https://openbao.org/docs/",
    },
    {
        "key": "opa",
        "name": "Open Policy Agent",
        "category": "Governance",
        "description": "Centralized policy-as-code decisions. When unconfigured, JUNE uses its built-in fail-closed rule engine.",
        "setup_hint": "Set JUNE_OPA_URL to an OPA server exposing /v1/data/june/execution/decision. JUNE fails closed if OPA is configured but unreachable.",
        "docs_url": "https://www.openpolicyagent.org/docs/latest/",
    },
    {
        "key": "s3",
        "name": "S3-compatible storage",
        "category": "Storage",
        "description": "Artifact and evidence storage. JUNE currently writes evidence bundles to local protected storage.",
        "setup_hint": "Set JUNE_S3_ENDPOINT and JUNE_S3_BUCKET. Local storage remains the fallback until the object-storage adapter is connected.",
        "docs_url": "",
    },
    {
        "key": "redis",
        "name": "Redis",
        "category": "Cache / Coordination",
        "description": "Shared cache and coordination. Without Redis, JUNE uses an in-process cache and single-worker event bus.",
        "setup_hint": "Set JUNE_REDIS_URL. Restart JUNE, then run Test connection.",
        "docs_url": "https://redis.io/docs/latest/",
    },
    {
        "key": "grafana",
        "name": "Grafana",
        "category": "Observability",
        "description": "Dashboarding integration. JUNE exposes real Prometheus-format metrics.",
        "setup_hint": "Set JUNE_GRAFANA_URL, then link JUNE metrics from your organization dashboard.",
        "docs_url": "https://grafana.com/docs/",
    },
    {
        "key": "prometheus",
        "name": "Prometheus",
        "category": "Observability",
        "description": "Metrics scraping. JUNE exposes /metrics with real request and execution counters.",
        "setup_hint": "Set JUNE_PROMETHEUS_URL; the JUNE /metrics endpoint is always available for scraping.",
        "docs_url": "https://prometheus.io/docs/",
    },
    {
        "key": "loki",
        "name": "Loki",
        "category": "Observability",
        "description": "Structured log aggregation. JUNE emits JSON logs with request correlation.",
        "setup_hint": "Set JUNE_LOKI_URL and point your collector at the JUNE container logs.",
        "docs_url": "https://grafana.com/docs/loki/latest/",
    },
    {
        "key": "trivy",
        "name": "Trivy",
        "category": "Security scanner",
        "description": "Image and filesystem vulnerability scanner. Detected from the host PATH.",
        "setup_hint": "Install trivy on the execution host. JUNE's built-in secret and dependency scanners stay active regardless.",
        "docs_url": "https://trivy.dev/",
    },
    {
        "key": "gitleaks",
        "name": "Gitleaks",
        "category": "Security scanner",
        "description": "Secret detection across Git history. Detected from the host PATH.",
        "setup_hint": "Install gitleaks on the execution host for repository history coverage.",
        "docs_url": "https://gitleaks.io/",
    },
    {
        "key": "syft",
        "name": "Syft",
        "category": "Security scanner",
        "description": "SBOM generation. Detected from the host PATH.",
        "setup_hint": "Install syft to generate industry-standard SBOMs; JUNE already emits SHA-256 file inventories.",
        "docs_url": "https://github.com/anchore/syft",
    },
    {
        "key": "grype",
        "name": "Grype",
        "category": "Security scanner",
        "description": "Vulnerability matching for SBOMs. Detected from the host PATH.",
        "setup_hint": "Install grype and connect it to the security pipeline.",
        "docs_url": "https://github.com/anchore/grype",
    },
    {
        "key": "blackduck",
        "name": "Black Duck",
        "category": "Security scanner",
        "description": "Existing enterprise license scanning capability. The adapter requires the organization's verified API endpoint.",
        "setup_hint": "Provide the verified Black Duck API endpoint and a scoped credential through the secrets provider. JUNE does not invent commercial API endpoints.",
        "docs_url": "",
    },
    {
        "key": "koverty",
        "name": "Koverty",
        "category": "Security scanner",
        "description": "Existing enterprise integration, subject to verifying its actual API capabilities.",
        "setup_hint": "Provide verified API documentation and a scoped credential. No endpoint is assumed by JUNE.",
        "docs_url": "",
    },
    {
        "key": "otel",
        "name": "OpenTelemetry",
        "category": "Observability",
        "description": "Distributed tracing exporter. Not configured in this deployment.",
        "setup_hint": "Provide an OTLP collector endpoint through the deployment configuration.",
        "docs_url": "https://opentelemetry.io/docs/",
    },
    {
        "key": "local_sandbox",
        "name": "Local sandbox adapter",
        "category": "Execution",
        "description": "Embedded execution adapter that runs approved runners against isolated local sandbox directories. UAT and simulated production runs are clearly labelled.",
        "setup_hint": "Always available. Configure remote execution agents for live production execution.",
        "docs_url": "",
    },
    {
        "key": "metrics",
        "name": "JUNE metrics endpoint",
        "category": "Observability",
        "description": "Built-in Prometheus-format metrics with real uptime, request and execution counters.",
        "setup_hint": "Scrape /metrics from the JUNE backend.",
        "docs_url": "",
    },
    {
        "key": "smtp",
        "name": "Email delivery",
        "category": "Notifications",
        "description": "Outbound email notifications. In-app notifications are always delivered inside JUNE.",
        "setup_hint": "Configure SMTP through your deployment platform. JUNE never reports an email as sent when delivery is not configured.",
        "docs_url": "",
    },
]

HTTP_TEST_PATHS = {
    "jenkins": "/api/json",
    "argo": "/api/v1/version",
    "keycloak": "/.well-known/openid-configuration",
    "opa": "/health",
    "grafana": "/api/health",
    "prometheus": "/-/healthy",
    "loki": "/ready",
    "openbao": "/v1/sys/health",
}
BINARY_KEYS = {"trivy": "trivy", "gitleaks": "gitleaks", "syft": "syft", "grype": "grype"}


def _config_value(key: str) -> dict:
    mapping = {
        "jenkins": {"url": settings.jenkins_url, "user": settings.jenkins_user},
        "buildpiper": {"url": settings.buildpiper_url},
        "argo": {"url": settings.argo_url},
        "keycloak": {"issuer": settings.keycloak_issuer},
        "openbao": {"address": settings.openbao_addr},
        "opa": {"url": settings.opa_url},
        "s3": {"endpoint": settings.s3_endpoint, "bucket": settings.s3_bucket},
        "redis": {"url": settings.redis_url or ""},
        "grafana": {"url": settings.grafana_url},
        "prometheus": {"url": settings.prometheus_url},
        "loki": {"url": settings.loki_url},
        "metrics": {"path": "/metrics"},
        "local_sandbox": {"adapter": "embedded", "sandbox": str(settings.sandbox_path)},
    }
    return {key_name: value for key_name, value in mapping.get(key, {}).items() if value}


def _configured(key: str) -> bool:
    if key in BINARY_KEYS:
        return shutil.which(BINARY_KEYS[key]) is not None
    if key in {"local_sandbox", "metrics"}:
        return True
    if key in {"blackduck", "koverty", "otel", "smtp"}:
        return False
    return settings.integration_configured(key)


def _status_message(key: str, definition: dict) -> tuple[str, str]:
    configured = _configured(key)
    if key in BINARY_KEYS:
        if configured:
            return IntegrationStatus.CONFIGURED, "Binary detected on the JUNE host PATH."
        return IntegrationStatus.NOT_CONFIGURED, "Binary not detected. JUNE's built-in scanner remains active."
    if key == "redis":
        if settings.redis_url:
            return IntegrationStatus.CONFIGURED, "Redis URL configured. Run Test connection to verify reachability."
        return IntegrationStatus.NOT_CONFIGURED, "In-process cache is active. Shared Redis coordination is not configured."
    if key == "local_sandbox":
        return IntegrationStatus.CONFIGURED, "Embedded sandbox adapter is active for UAT and simulation runs."
    if key == "metrics":
        return IntegrationStatus.CONFIGURED, "Prometheus-format metrics are exposed at /metrics."
    if configured:
        return IntegrationStatus.CONFIGURED, "Configuration detected. Run Test connection to verify reachability."
    return IntegrationStatus.NOT_CONFIGURED, definition["setup_hint"]


async def ensure_integrations(db: AsyncSession) -> None:
    existing = {
        row.key: row for row in (await db.execute(select(Integration))).scalars().all()
    }
    for definition in INTEGRATION_DEFINITIONS:
        status, message = _status_message(definition["key"], definition)
        row = existing.get(definition["key"])
        if row is None:
            row = Integration(**definition, status=status, message=message, config=_config_value(definition["key"]))
            db.add(row)
        else:
            row.name = definition["name"]
            row.category = definition["category"]
            row.description = definition["description"]
            row.setup_hint = definition["setup_hint"]
            row.docs_url = definition["docs_url"]
            row.status = status
            row.message = message
            row.config = _config_value(definition["key"])
    await db.commit()


async def list_integrations(db: AsyncSession) -> list[Integration]:
    return list((await db.execute(select(Integration).order_by(Integration.category, Integration.name))).scalars().all())


async def get_integration(db: AsyncSession, key: str) -> Integration:
    row = (await db.execute(select(Integration).where(Integration.key == key))).scalar_one_or_none()
    if not row:
        raise not_found("Integration")
    return row


async def test_integration(db: AsyncSession, actor: User, key: str) -> dict:
    row = await get_integration(db, key)
    started = time.perf_counter()
    latency = None

    if not _configured(key):
        status = IntegrationStatus.NOT_CONFIGURED
        message = row.setup_hint or "This integration is not configured."
    elif key in BINARY_KEYS:
        status = IntegrationStatus.CONFIGURED
        message = f"Binary found at {shutil.which(BINARY_KEYS[key])}."
    elif key == "redis":
        ok = await cache.ping()
        status = IntegrationStatus.CONFIGURED if ok else IntegrationStatus.ERROR
        message = "Redis responded to PING." if ok else "Redis did not respond to PING."
    elif key in HTTP_TEST_PATHS:
        base = {
            "jenkins": settings.jenkins_url,
            "argo": settings.argo_url,
            "keycloak": settings.keycloak_issuer.rstrip("/"),
            "opa": settings.opa_url,
            "grafana": settings.grafana_url,
            "prometheus": settings.prometheus_url,
            "loki": settings.loki_url,
            "openbao": settings.openbao_addr,
        }.get(key, "")
        url = base.rstrip("/") + HTTP_TEST_PATHS[key]
        try:
            async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
                response = await client.get(url)
            latency = round((time.perf_counter() - started) * 1000, 1)
            if response.status_code >= 500:
                status = IntegrationStatus.ERROR
                message = f"Endpoint responded with HTTP {response.status_code}. Check service health and credentials."
            else:
                status = IntegrationStatus.CONFIGURED
                message = (
                    f"Endpoint reachable (HTTP {response.status_code}, {latency} ms). "
                    "Credentials are not validated by this reachability test."
                )
        except httpx.HTTPError as exc:
            status = IntegrationStatus.ERROR
            message = f"Endpoint could not be reached ({exc.__class__.__name__}). Verify the URL and network path."
    elif key == "s3":
        status = IntegrationStatus.CONFIGURED
        message = "Configuration present. This build writes evidence locally; the signed object-storage adapter must be verified by the platform team."
    elif key == "buildpiper":
        status = IntegrationStatus.CONFIGURED
        message = "Endpoint configuration present. BuildPiper API capabilities must be verified against your licensed version before enabling the adapter."
    else:
        status = IntegrationStatus.CONFIGURED
        message = row.message or "Configuration present."

    row.status = status
    row.message = message
    row.last_checked_at = utcnow()
    await audit_service.record(
        db,
        actor=actor,
        action="integration.tested",
        resource_type="integration",
        resource_id=row.id,
        details={"key": key, "status": status, "latency_ms": latency},
    )
    await db.commit()
    return {
        "key": key,
        "status": status,
        "message": message,
        "checked_at": row.last_checked_at,
        "latency_ms": latency,
    }
