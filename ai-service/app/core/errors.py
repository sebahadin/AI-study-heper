"""Consistent, sanitized errors for internal clients."""

from http import HTTPStatus
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse

from app.schemas.http import ErrorDetail, ErrorResponse

logger = logging.getLogger("classmate.ai")


class APIError(Exception):
    """Only pass fixed, public-safe messages here, never upstream error text."""

    def __init__(
        self, status_code: int, code: str, message: str,
        *, headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.headers = headers


def error_response(
    request: Request, status_code: int, code: str, message: str,
    *, headers: dict[str, str] | None = None,
) -> JSONResponse:
    request_id = request.state.request_id
    body = ErrorResponse(error=ErrorDetail(code=code, message=message), request_id=request_id)
    return JSONResponse(
        status_code=status_code,
        content=body.model_dump(mode="json"),
        headers={**(headers or {}), "X-Request-ID": request_id, "Cache-Control": "no-store"},
    )


def unexpected_error_response(request: Request, error: Exception) -> JSONResponse:
    # Tracebacks/messages can contain passages, secrets, or provider payloads.
    logger.error(
        "internal_error request_id=%s exception_type=%s",
        request.state.request_id, type(error).__name__,
    )
    return error_response(request, 500, "internal_error", "An internal error occurred.")


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(APIError)
    async def handle_api_error(request: Request, error: APIError) -> JSONResponse:
        return error_response(
            request, error.status_code, error.code, error.message, headers=error.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, _: RequestValidationError) -> JSONResponse:
        return error_response(request, 422, "validation_error", "Request validation failed.")

    @app.exception_handler(HTTPException)
    async def handle_http_error(request: Request, error: HTTPException) -> JSONResponse:
        codes = {401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "method_not_allowed"}
        # HTTPException.detail may contain upstream/private data; never return it.
        message = HTTPStatus(error.status_code).phrase
        return error_response(
            request, error.status_code, codes.get(error.status_code, "http_error"),
            message, headers=error.headers,
        )

