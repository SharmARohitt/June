"""JUNE API — modular monolith entry point.

Control plane: FastAPI domain modules.
Orchestration plane: in-process execution engine with approval gates.
Execution plane: allowlisted runners in isolated local sandboxes (simulation is
explicitly labelled; live production requires a configured remote agent).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.database import SessionLocal, get_db, init_models, utcnow
from app.core.errors import JuneError, june_error_handler
from app.core.events import event_bus  # noqa: F401 - imported so the bus is initialised
from app.core.logging import configure_logging, request_id_ctx
from app.core.metrics import record_http, render_prometheus
from app.core.security import ACCESS_COOKIE, CSRF_COOKIE, tokens_match
from app.engine.executor import reconcile_interrupted_executions
from app.models import ExecutionAgent
from app.services import approval_service, integration_service, system_service

CSRF_EXEMPT_PATHS = {
    "/api/v1/auth/login",
    "/api/v1/auth/refresh",
}
CSRF_EXEMPT_SUFFIXES = ("/agents/heartbeat",)

logger = logging.getLogger("june.maintenance")


def _allowed_origins() -> set[str]:
    origins = {settings.frontend_origin.rstrip("/")}
    if not settings.is_production:
        origins.update({"http://localhost:3000", "http://127.0.0.1:3000"})
    return origins


async def _local_agent_heartbeat_loop() -> None:
    """The embedded sandbox adapter reports its own liveness — no invented status."""
    while True:
        try:
            async with SessionLocal() as db:
                agent = (
                    await db.execute(
                        select(ExecutionAgent).where(ExecutionAgent.kind == "LOCAL_SANDBOX")
                    )
                ).scalars().first()
                if agent is not None:
                    agent.last_heartbeat_at = utcnow()
                    agent.status = "ONLINE"
                    await db.commit()
        except Exception:  # pragma: no cover - background resilience
            logger.warning("local_agent_heartbeat_failed", exc_info=True)
        await asyncio.sleep(30)


async def _maintenance_loop() -> None:
    while True:
        try:
            async with SessionLocal() as db:
                await approval_service.expire_approvals(db)
        except Exception:  # pragma: no cover - background resilience
            # Never crash the loop: the next tick retries the expiry sweep.
            logger.warning("approval_expiry_sweep_failed", exc_info=True)
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    configure_logging()
    if settings.auto_create_tables:
        await init_models()
    async with SessionLocal() as db:
        await integration_service.ensure_integrations(db)
        if settings.seed_on_start:
            from app.seed import seed_if_empty

            if settings.seed_password is None:
                raise RuntimeError("JUNE_SEED_PASSWORD is required when JUNE_SEED_ON_START is enabled")
            await seed_if_empty(db, settings.seed_password)
    interrupted = await reconcile_interrupted_executions()
    tasks = [
        asyncio.create_task(_local_agent_heartbeat_loop()),
        asyncio.create_task(_maintenance_loop()),
    ]
    if interrupted:
        logger.warning("Recovered from restart: %s interrupted execution(s) marked failed.", interrupted)
    yield
    for task in tasks:
        task.cancel()
    for task in tasks:
        with contextlib.suppress(asyncio.CancelledError):
            await task


app = FastAPI(
    title="JUNE API",
    description=(
        "Job Unification & Network Execution — automation registry, governed execution, "
        "approvals, security evidence and tamper-evident audit."
    ),
    version=system_service.APP_VERSION,
    lifespan=lifespan,
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(_allowed_origins()),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-CSRF-Token", "X-Agent-Token", "Authorization"],
    expose_headers=["X-Request-Id"],
    max_age=600,
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
    request_id_ctx.set(request_id)
    started = time.perf_counter()
    response = await call_next(request)
    elapsed = time.perf_counter() - started
    response.headers["X-Request-Id"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if settings.is_production:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    route = request.scope.get("route")
    path = getattr(route, "path", request.url.path)
    if path not in {"/metrics", "/health"} and not path.endswith("/stream"):
        record_http(request.method, path, response.status_code, elapsed)
    return response


@app.middleware("http")
async def csrf_protection(request: Request, call_next):
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return await call_next(request)
    path = request.url.path
    has_cookie_session = ACCESS_COOKIE in request.cookies
    exempt = path in CSRF_EXEMPT_PATHS or any(path.endswith(suffix) for suffix in CSRF_EXEMPT_SUFFIXES)
    if has_cookie_session and not exempt:
        cookie_token = request.cookies.get(CSRF_COOKIE)
        header_token = request.headers.get("x-csrf-token")
        if not tokens_match(header_token, cookie_token):
            return JSONResponse(
                status_code=403,
                content={
                    "error": {
                        "code": "csrf_failed",
                        "message": "This request was blocked because the CSRF token is missing or invalid. Refresh the page and try again.",
                        "details": None,
                    }
                },
            )
        origin = request.headers.get("origin")
        if origin and origin.rstrip("/") not in _allowed_origins():
            return JSONResponse(
                status_code=403,
                content={
                    "error": {
                        "code": "origin_not_allowed",
                        "message": "This origin is not allowed to modify JUNE state.",
                        "details": {"origin": origin},
                    }
                },
            )
    return await call_next(request)


app.add_exception_handler(JuneError, june_error_handler)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "validation_error",
                "message": "One or more fields need attention.",
                "details": jsonable_encoder(exc.errors()),
            }
        },
    )


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_request: Request, exc: StarletteHTTPException):
    message = exc.detail if isinstance(exc.detail, str) else "The request could not be completed."
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": "http_error", "message": message, "details": None}},
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception):
    import logging

    logging.getLogger("june.error").exception(
        "Unhandled API error on %s %s", request.method, request.url.path
    )
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "internal_error",
                "message": "JUNE could not complete this request. The incident was logged for the platform team.",
                "details": None,
            }
        },
    )


app.include_router(api_router)


@app.get("/health", tags=["System"])
async def health(db: AsyncSession = Depends(get_db)) -> dict:
    database_ok = True
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        database_ok = False
    return {
        "status": "ok" if database_ok else "degraded",
        "service": "june-api",
        "version": system_service.APP_VERSION,
        "environment": settings.env,
        "database": "reachable" if database_ok else "unreachable",
        "time": utcnow().isoformat(),
    }


@app.get("/metrics", include_in_schema=False)
async def metrics() -> PlainTextResponse:
    return PlainTextResponse(render_prometheus(), media_type="text/plain; version=0.0.4")


@app.get("/", include_in_schema=False)
async def root() -> dict:
    return {
        "service": "JUNE — Job Unification & Network Execution",
        "version": system_service.APP_VERSION,
        "api": "/api/v1",
        "docs": "/docs",
    }
