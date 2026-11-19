"""Structured API errors with a stable envelope used by every endpoint."""

from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse


class JuneError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: Any | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


def not_found(resource: str) -> JuneError:
    return JuneError(404, "not_found", f"{resource} was not found.")


def forbidden(message: str = "You do not have permission to perform this action.", details: Any | None = None) -> JuneError:
    return JuneError(403, "forbidden", message, details)


def invalid(message: str, details: Any | None = None) -> JuneError:
    return JuneError(422, "validation_error", message, details)


def conflict(message: str, details: Any | None = None) -> JuneError:
    return JuneError(409, "conflict", message, details)


def unauthorized(message: str = "Authentication is required.", code: str = "unauthenticated") -> JuneError:
    return JuneError(401, code, message)


async def june_error_handler(_request: Request, exc: JuneError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.message, "details": exc.details}},
    )


async def unhandled_error_handler(_request: Request, exc: Exception) -> JSONResponse:
    # Never leak stack traces or internals to clients.
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
