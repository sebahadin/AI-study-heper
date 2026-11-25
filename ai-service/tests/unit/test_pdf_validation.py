"""Use actual PDF bytes to exercise policy and the authenticated HTTP boundary."""

from hashlib import sha256
from io import BytesIO
from uuid import UUID

from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from pypdf import PdfWriter
from pypdf.generic import NameObject, NumberObject, TextStringObject
import pytest
from starlette.requests import Request

from app.api.documents import read_pdf_body
from app.core.config import Settings
from app.core.constants import DEFAULT_MAX_PDF_BYTES, MAX_PDF_PAGES
from app.core.errors import APIError
from app.main import create_app
from app.rag.ingestion.pdf_validation import inspect_pdf

TOKEN = "pdf-test-credential-" + "x" * 32
AUTH = {"Authorization": f"Bearer {TOKEN}"}
PDF_HEADERS = {**AUTH, "Content-Type": "application/pdf"}
pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture(autouse=True)
def isolate_pdf_environment(monkeypatch):
    monkeypatch.delenv("AI_MAX_PDF_BYTES", raising=False)


def pdf_bytes(pages=1, *, encrypted=False, claimed_pages=None):
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=200, height=300)
    if claimed_pages is not None:
        writer.root_object["/Pages"].get_object()[NameObject("/Count")] = NumberObject(claimed_pages)
    if encrypted:
        writer.encrypt("fixture-password")
    with BytesIO() as stream:
        writer.write(stream)
        return stream.getvalue()


@pytest.fixture
async def client():
    app = create_app(Settings(_env_file=None, service_token=TOKEN))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://ai.test") as client:
        yield client


def assert_error(response, status, code):
    assert response.status_code == status
    body = response.json()
    assert body["error"]["code"] == code
    assert body["request_id"] == response.headers["x-request-id"]
    assert response.headers["cache-control"] == "no-store"
    assert TOKEN not in response.text


@pytest.mark.parametrize("pages", [1, MAX_PDF_PAGES])
def test_inspection_uses_real_pdf_pages_and_hashes_exact_bytes(pages):
    data = pdf_bytes(pages)
    inspection = inspect_pdf(data, max_bytes=len(data))
    assert inspection.page_count == pages
    assert inspection.byte_count == len(data)
    assert inspection.sha256 == sha256(data).hexdigest()


def test_pdf_does_not_need_a_book_or_any_application_record():
    result = inspect_pdf(pdf_bytes(), max_bytes=DEFAULT_MAX_PDF_BYTES)
    assert set(result.model_dump()) == {"page_count", "byte_count", "sha256"}


@pytest.mark.parametrize("data,code", [
    (b"", "invalid_pdf"), (b"This filename could be lecture.pdf", "invalid_pdf"),
    (b"%PDF-1.7\nprivate-document-text-without-trailer", "invalid_pdf"),
    (pdf_bytes(0), "empty_pdf"),
    (pdf_bytes(MAX_PDF_PAGES + 1), "pdf_page_limit_exceeded"),
    (pdf_bytes(encrypted=True), "encrypted_pdf"),
])
def test_invalid_empty_encrypted_and_over_page_limit_documents_are_rejected(data, code):
    with pytest.raises(APIError) as error:
        inspect_pdf(data, max_bytes=DEFAULT_MAX_PDF_BYTES)
    assert error.value.status_code == 422
    assert error.value.code == code
    assert "private-document-text" not in str(error.value)


def test_untrusted_pdf_page_count_metadata_cannot_bypass_the_page_limit():
    data = pdf_bytes(MAX_PDF_PAGES + 1, claimed_pages=1)
    with pytest.raises(APIError) as error:
        inspect_pdf(data, max_bytes=DEFAULT_MAX_PDF_BYTES)
    assert error.value.code == "pdf_page_limit_exceeded"


def test_actual_file_size_is_enforced_at_parser_boundary_too():
    data = pdf_bytes()
    with pytest.raises(APIError) as error:
        inspect_pdf(data, max_bytes=len(data) - 1)
    assert error.value.status_code == 413


async def test_both_pdf_endpoints_require_service_auth(client):
    assert_error(await client.get("/internal/pdfs/policy"), 401, "unauthorized")
    response = await client.post(
        "/internal/pdfs/inspect", headers={"Content-Type": "application/pdf"}, content=pdf_bytes(),
    )
    assert_error(response, 401, "unauthorized")


async def test_policy_exposes_effective_server_limits(client):
    response = await client.get("/internal/pdfs/policy", headers=AUTH)
    assert response.status_code == 200
    assert response.json() == {"max_pages": MAX_PDF_PAGES, "max_bytes": DEFAULT_MAX_PDF_BYTES}


async def test_authenticated_raw_pdf_request_returns_only_inspection_metadata(client):
    data = pdf_bytes(MAX_PDF_PAGES)
    response = await client.post(
        "/internal/pdfs/inspect", content=data,
        headers={**PDF_HEADERS, "X-Request-ID": "express-pdf-42"},
    )
    assert response.status_code == 200
    assert response.json() == {
        "page_count": MAX_PDF_PAGES, "byte_count": len(data), "sha256": sha256(data).hexdigest(),
    }
    assert response.headers["x-request-id"] == "express-pdf-42"


async def test_client_claims_cannot_increase_server_policy(client):
    response = await client.post(
        "/internal/pdfs/inspect?max_pages=999&max_bytes=999999999",
        headers={**PDF_HEADERS, "X-Max-Pages": "999"}, content=pdf_bytes(MAX_PDF_PAGES + 1),
    )
    assert_error(response, 422, "pdf_page_limit_exceeded")


async def test_actual_mime_type_does_not_make_fake_pdf_bytes_valid(client):
    response = await client.post(
        "/internal/pdfs/inspect", content=b"private-note-text", headers=PDF_HEADERS,
    )
    assert_error(response, 422, "invalid_pdf")
    assert "private-note-text" not in response.text


async def test_parser_diagnostics_do_not_log_private_pdf_objects(client, caplog):
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=300)
    writer.root_object["/Pages"]["/Kids"].append(TextStringObject("private-pdf-log-marker"))
    with BytesIO() as stream:
        writer.write(stream)
        data = stream.getvalue()
    response = await client.post("/internal/pdfs/inspect", headers=PDF_HEADERS, content=data)
    assert response.status_code == 200
    assert "private-pdf-log-marker" not in response.text
    assert "private-pdf-log-marker" not in caplog.text


@pytest.mark.parametrize("media_type", [None, "application/json", "image/png", "multipart/form-data"])
async def test_inspection_accepts_only_raw_pdf_media_type(client, media_type):
    headers = {**AUTH, **({"Content-Type": media_type} if media_type else {})}
    response = await client.post("/internal/pdfs/inspect", content=pdf_bytes(), headers=headers)
    assert_error(response, 415, "unsupported_media_type")


async def test_media_type_parameters_are_allowed(client):
    response = await client.post(
        "/internal/pdfs/inspect", content=pdf_bytes(),
        headers={**AUTH, "Content-Type": "application/pdf; version=1.7"},
    )
    assert response.status_code == 200


async def test_compressed_request_bodies_are_not_silently_accepted(client):
    response = await client.post(
        "/internal/pdfs/inspect", content=pdf_bytes(),
        headers={**PDF_HEADERS, "Content-Encoding": "gzip"},
    )
    assert_error(response, 415, "unsupported_content_encoding")


@pytest.mark.parametrize("value", ["-1", "not-a-number", "1.5", "9" * 100])
async def test_invalid_content_lengths_get_safe_errors(client, value):
    response = await client.post(
        "/internal/pdfs/inspect", content=pdf_bytes(),
        headers={**PDF_HEADERS, "Content-Length": value},
    )
    assert_error(response, 400, "invalid_content_length")


async def test_incorrect_content_length_is_rejected_after_counting_actual_bytes(client):
    response = await client.post(
        "/internal/pdfs/inspect", content=pdf_bytes(),
        headers={**PDF_HEADERS, "Content-Length": "1"},
    )
    assert_error(response, 400, "invalid_content_length")


async def test_declared_over_limit_size_is_rejected_without_consuming_request_body(client):
    async def forbidden_body():
        raise AssertionError("Must reject headers before reading the body")
        yield b""

    response = await client.post(
        "/internal/pdfs/inspect", content=forbidden_body(),
        headers={**PDF_HEADERS, "Content-Length": str(DEFAULT_MAX_PDF_BYTES + 1)},
    )
    assert_error(response, 413, "pdf_too_large")


async def test_unauthorized_request_is_rejected_before_consuming_body(client):
    async def forbidden_body():
        raise AssertionError("Must authenticate before reading the body")
        yield b""

    response = await client.post(
        "/internal/pdfs/inspect", content=forbidden_body(), headers={"Content-Type": "application/pdf"},
    )
    assert_error(response, 401, "unauthorized")


async def test_chunked_body_without_content_length_is_supported(client):
    data = pdf_bytes()

    async def chunks():
        yield data[:20]
        yield data[20:]

    response = await client.post("/internal/pdfs/inspect", content=chunks(), headers=PDF_HEADERS)
    assert response.status_code == 200
    assert response.json()["sha256"] == sha256(data).hexdigest()


@pytest.mark.parametrize("declared", [None, "1"])
async def test_streamed_size_enforcement_does_not_trust_content_length(declared):
    calls = 0

    async def receive():
        nonlocal calls
        calls += 1
        if calls == 1:
            return {"type": "http.request", "body": b"%PDF-" + b"x" * 5, "more_body": True}
        if calls == 2:
            return {"type": "http.request", "body": b"x" * 6, "more_body": True}
        raise AssertionError("Must stop consuming as soon as the cap is exceeded")

    headers = [(b"content-type", b"application/pdf")]
    if declared is not None:
        headers.append((b"content-length", declared.encode()))
    request = Request({"type": "http", "headers": headers}, receive=receive)
    with pytest.raises(APIError) as error:
        await read_pdf_body(request, max_bytes=15)
    assert error.value.status_code == 413
    assert calls == 2


async def test_effective_configured_byte_cap_is_reported_and_enforced():
    data = pdf_bytes()
    max_bytes = len(data) - 1
    app = create_app(Settings(_env_file=None, service_token=TOKEN, max_pdf_bytes=max_bytes))
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://ai.test") as client:
        policy = await client.get("/internal/pdfs/policy", headers=AUTH)
        assert policy.json()["max_bytes"] == max_bytes
        response = await client.post("/internal/pdfs/inspect", headers=PDF_HEADERS, content=data)
    assert_error(response, 413, "pdf_too_large")
    UUID(response.headers["x-request-id"])


@pytest.mark.parametrize("value", [0, -1])
def test_invalid_server_byte_limits_fail_configuration(value):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, service_token=TOKEN, max_pdf_bytes=value)
