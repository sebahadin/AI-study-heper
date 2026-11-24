"""Small HTTP responses; errors never echo request bodies or credentials."""

from typing import Literal

from app.schemas.base import Contract, Text


class HealthResponse(Contract):
    status: Literal["ok"] = "ok"
    service: Literal["classmate-ai"] = "classmate-ai"


class ErrorDetail(Contract):
    code: Text
    message: Text


class ErrorResponse(Contract):
    error: ErrorDetail
    request_id: Text
