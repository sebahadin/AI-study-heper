"""Exercise the real HTTP boundary without providers, storage, or databases."""

import logging
from uuid import UUID

from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient
import pytest

from app.api.dependencies import TrustedContext
from app.core.config import Settings
from app.core.errors import APIError
from app.main import create_app

# Test-only credential, never a development/production default.
TOKEN = "test-only-credential-" + "x" * 32
AUTH = {"Authorization": f"Bearer {TOKEN}"}
pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def app():
    application = create_app(Settings(_env_file=None, service_token=TOKEN))

    @application.post("/internal/_test/context")
    async def context_probe(context: TrustedContext):
        return context

    @application.get("/internal/_test/failure")
    async def failure_probe():
        raise RuntimeError("private-provider-payload-and-secret")

    @application.get("/internal/_test/http-error")
    async def http_error_probe():
        raise HTTPException(403, detail="private-upstream-detail")

    @application.get("/internal/_test/unavailable")
    async def unavailable_probe():
        raise APIError(503, "dependency_unavailable", "Service temporarily unavailable.")

    return application


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://ai.test") as client:
        yield client


@pytest.fixture
def context_body():
    return {"context": {
        "user_id": "owner-1", "run_id": "run-1", "conversation_id": "chat-1",
        "scope": {"scope_id": "selected-materials", "sources": [{
            "source_id": "pdf-1", "source_type": "document", "source_version": "v2",
        }]},
    }}


def assert_error(response, status, code):
    assert response.status_code == status
    body = response.json()
    assert set(body) == {"error", "request_id"}
    assert set(body["error"]) == {"code", "message"}
    assert body["error"]["code"] == code
    assert body["request_id"] == response.headers["x-request-id"]
    assert response.headers["cache-control"] == "no-store"
    return body


async def test_public_liveness_does_not_require_credentials_or_claim_integration_readiness(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "classmate-ai"}
    UUID(response.headers["x-request-id"])


@pytest.mark.parametrize("headers", [
    {}, {"Authorization": "Bearer incorrect"}, {"Authorization": "Basic credentials"},
    {"Authorization": "Bearer"}, {"Authorization": "Bearer "},
    {"Authorization": "Bearer " + TOKEN + " extra"},
    {"X-User-ID": "owner-1", "X-Service-Token": TOKEN},
    [("Authorization", f"Bearer {TOKEN}"), ("Authorization", "Bearer other")],
])
async def test_internal_health_rejects_missing_wrong_malformed_or_duplicate_credentials(client, headers):
    response = await client.get("/internal/health", headers=headers)
    assert_error(response, 401, "unauthorized")
    assert response.headers["www-authenticate"] == "Bearer"
    assert TOKEN not in response.text


async def test_internal_health_accepts_the_dedicated_service_credential(client):
    assert (await client.get("/internal/health", headers=AUTH)).status_code == 200


async def test_bearer_scheme_is_case_insensitive(client):
    assert (await client.get("/internal/health", headers={"Authorization": f"bearer {TOKEN}"})).status_code == 200


async def test_body_identity_cannot_bypass_service_authentication(client, context_body):
    assert_error(await client.post("/internal/_test/context", json=context_body), 401, "unauthorized")


async def test_authenticated_express_context_round_trips_without_identity_header_overrides(client, context_body):
    response = await client.post(
        "/internal/_test/context", json=context_body,
        headers={**AUTH, "X-User-ID": "forged-owner"},
    )
    assert response.status_code == 200
    assert response.json()["user_id"] == "owner-1"
    assert response.json()["scope"]["sources"][0]["source_version"] == "v2"


async def test_empty_scope_remains_empty_at_the_http_boundary(client, context_body):
    context_body["context"]["scope"]["sources"] = []
    response = await client.post("/internal/_test/context", json=context_body, headers=AUTH)
    assert response.status_code == 200
    assert response.json()["scope"]["sources"] == []


@pytest.mark.parametrize("field", ["user_id", "run_id", "scope"])
async def test_context_requires_explicit_identity_run_and_scope(client, context_body, field):
    del context_body["context"][field]
    assert_error(
        await client.post("/internal/_test/context", json=context_body, headers=AUTH),
        422, "validation_error",
    )


async def test_context_validation_does_not_echo_private_inputs(client, context_body):
    context_body["context"]["unknown"] = "private-note-text"
    context_body["context"]["user_id"] = {"password": "private-password"}
    response = await client.post("/internal/_test/context", json=context_body, headers=AUTH)
    assert_error(response, 422, "validation_error")
    assert "private-" not in response.text
    assert TOKEN not in response.text


async def test_malformed_json_has_the_same_safe_error_shape(client):
    response = await client.post(
        "/internal/_test/context", content='{"private-content":',
        headers={**AUTH, "Content-Type": "application/json"},
    )
    assert_error(response, 422, "validation_error")
    assert "private-content" not in response.text


@pytest.mark.parametrize("path,headers,status", [
    ("/health", {}, 200), ("/internal/health", {}, 401), ("/missing", {}, 404),
    ("/internal/_test/failure", AUTH, 500),
])
async def test_express_request_id_survives_success_and_error_paths(client, path, headers, status):
    response = await client.get(path, headers={**headers, "X-Request-ID": "express.run-42:attempt_1"})
    assert response.status_code == status
    assert response.headers["x-request-id"] == "express.run-42:attempt_1"
    if status >= 400:
        assert response.json()["request_id"] == "express.run-42:attempt_1"


@pytest.mark.parametrize("request_id", ["", "has spaces", "x" * 129, "line\nbreak", "<script>"])
async def test_unsafe_or_unbounded_request_ids_are_replaced(client, request_id):
    response = await client.get("/health", headers={"X-Request-ID": request_id})
    generated = response.headers["x-request-id"]
    UUID(generated)
    assert generated != request_id


async def test_duplicate_request_ids_are_replaced(client):
    response = await client.get("/health", headers=[("X-Request-ID", "first"), ("X-Request-ID", "second")])
    UUID(response.headers["x-request-id"])


async def test_unexpected_errors_hide_details_in_response_and_application_log(client, caplog):
    with caplog.at_level(logging.ERROR, logger="classmate.ai"):
        response = await client.get("/internal/_test/failure", headers={**AUTH, "X-Request-ID": "failure-42"})
    assert_error(response, 500, "internal_error")
    assert "private-provider" not in response.text
    assert "private-provider" not in caplog.text
    assert TOKEN not in caplog.text
    assert "failure-42" in caplog.text


async def test_http_errors_hide_upstream_details(client):
    response = await client.get("/internal/_test/http-error", headers=AUTH)
    assert_error(response, 403, "forbidden")
    assert "private-upstream" not in response.text


async def test_service_errors_and_framework_errors_share_the_envelope(client):
    assert_error(await client.get("/internal/_test/unavailable", headers=AUTH), 503, "dependency_unavailable")
    assert_error(await client.get("/missing"), 404, "not_found")
    response = await client.post("/health")
    assert_error(response, 405, "method_not_allowed")
    assert response.headers["allow"] == "GET"


async def test_api_docs_and_future_workflows_are_not_exposed(client):
    for path in ("/docs", "/redoc", "/openapi.json", "/internal/chat", "/internal/documents"):
        assert_error(await client.get(path, headers=AUTH), 404, "not_found")
