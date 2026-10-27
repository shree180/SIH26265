"""Consistent API error responses.

Never leak stack traces, SQL, or storage paths to the client.
"""

from __future__ import annotations

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        *,
        fields: list[dict] | None = None,
        hint: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.fields = fields or []
        self.hint = hint


def not_found(entity: str = "Record") -> ApiError:
    return ApiError(404, "NOT_FOUND", f"{entity} not found.")


def forbidden(message: str = "You don't have permission to perform this action.") -> ApiError:
    return ApiError(403, "FORBIDDEN", message)


def validation_error(message: str, fields: list[dict] | None = None) -> ApiError:
    return ApiError(422, "VALIDATION_ERROR", message, fields=fields)


def conflict(message: str, code: str = "CONFLICT") -> ApiError:
    return ApiError(409, code, message)


async def api_error_handler(_request: Request, exc: ApiError) -> JSONResponse:
    payload: dict = {"code": exc.code, "message": exc.message}
    if exc.fields:
        payload["fields"] = exc.fields
    if exc.hint:
        payload["hint"] = exc.hint
    response = JSONResponse(status_code=exc.status_code, content={"error": payload})
    if exc.fields:
        response.headers["X-Error-Count"] = str(len(exc.fields))
    return response


async def validation_exception_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    fields = []
    for error in exc.errors():
        location = [str(part) for part in error.get("loc", []) if part not in {"body", "query", "path"}]
        fields.append(
            {
                "field": ".".join(location) or "request",
                "message": error.get("msg", "Invalid value."),
            }
        )
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Some fields need attention.",
                "fields": fields,
            }
        },
    )


def register_error_handlers(app) -> None:
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
