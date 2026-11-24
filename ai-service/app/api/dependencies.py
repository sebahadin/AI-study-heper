"""Authenticate the service separately from the user context supplied by Express."""

from secrets import compare_digest
from typing import Annotated

from fastapi import Body, Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.errors import APIError
from app.schemas.context import ExecutionContext

service_bearer = HTTPBearer(auto_error=False)


async def require_service_auth(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(service_bearer)],
) -> None:
    """The dedicated server-only token authenticates Express, not a browser user."""
    expected = request.app.state.settings.service_token.get_secret_value().encode("utf-8")
    supplied = credentials.credentials.encode("utf-8") if credentials else b""
    if len(request.headers.getlist("authorization")) != 1 or not compare_digest(supplied, expected):
        raise APIError(
            401, "unauthorized", "Valid service credentials are required.",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_execution_context(
    _service: Annotated[None, Depends(require_service_auth)],
    context: Annotated[ExecutionContext, Body(embed=True)],
) -> ExecutionContext:
    """Accept context only from authenticated Express's internal request envelope.

    Express must derive user_id from Passport and resolve/authorize the selected
    scope before calling Python. This does not prove current source ownership:
    retrieval/tools must recheck it through Express, including on resumed runs.
    Never expose this envelope as a browser payload or an LLM tool schema.
    """
    return context


TrustedContext = Annotated[ExecutionContext, Depends(get_execution_context)]
