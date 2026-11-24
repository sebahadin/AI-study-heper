"""Request correlation and sanitized failures without buffering response bodies."""

import re
from uuid import uuid4

from starlette.datastructures import Headers, MutableHeaders
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.errors import unexpected_error_response

REQUEST_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")


class RequestIdMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        supplied = Headers(scope=scope).getlist("x-request-id")
        request_id = (
            supplied[0]
            if len(supplied) == 1 and REQUEST_ID_PATTERN.fullmatch(supplied[0])
            else str(uuid4())
        )
        scope.setdefault("state", {})["request_id"] = request_id
        response_started = False

        async def send_with_request_id(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
                headers = MutableHeaders(scope=message)
                headers["X-Request-ID"] = request_id
                headers["Cache-Control"] = "no-store"
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        except Exception as error:
            response = unexpected_error_response(Request(scope), error)
            if response_started:
                # Headers already sent cannot become a JSON error. Terminate
                # with a sanitized exception, keeping private text out of server logs.
                raise RuntimeError(f"Response interrupted; request_id={request_id}") from None
            # Handle before the server's error middleware can log the raw exception.
            await response(scope, receive, send_with_request_id)
