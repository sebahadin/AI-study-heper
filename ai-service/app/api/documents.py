"""Internal raw-PDF inspection; Express will own uploads and document records."""

import re

from fastapi import APIRouter, Depends, Request
from starlette.concurrency import run_in_threadpool

from app.api.dependencies import require_service_auth
from app.core.constants import MAX_PDF_PAGES
from app.core.errors import APIError
from app.rag.ingestion.pdf_validation import inspect_pdf
from app.schemas.documents import PdfInspection, PdfPolicy

router = APIRouter(prefix="/internal/pdfs", dependencies=[Depends(require_service_auth)])


@router.get("/policy", response_model=PdfPolicy)
async def pdf_policy(request: Request) -> PdfPolicy:
    return PdfPolicy(max_pages=MAX_PDF_PAGES, max_bytes=request.app.state.settings.max_pdf_bytes)


async def read_pdf_body(request: Request, *, max_bytes: int) -> bytes:
    """Bound streamed bytes even when Content-Length is absent or inaccurate."""
    media_types = request.headers.getlist("content-type")
    if len(media_types) != 1 or media_types[0].partition(";")[0].strip().lower() != "application/pdf":
        raise APIError(415, "unsupported_media_type", "Send the PDF bytes as application/pdf.")
    if request.headers.get("content-encoding", "identity").lower() != "identity":
        raise APIError(415, "unsupported_content_encoding", "Send the PDF without content encoding.")

    lengths = request.headers.getlist("content-length")
    declared_length = None
    if lengths:
        if len(lengths) != 1 or not re.fullmatch(r"[0-9]{1,20}", lengths[0]):
            raise APIError(400, "invalid_content_length", "Invalid Content-Length header.")
        declared_length = int(lengths[0])
        if declared_length > max_bytes:
            raise APIError(413, "pdf_too_large", "The PDF exceeds the file-size limit.")

    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > max_bytes:
            raise APIError(413, "pdf_too_large", "The PDF exceeds the file-size limit.")
        body.extend(chunk)
    if declared_length is not None and declared_length != len(body):
        raise APIError(400, "invalid_content_length", "Content-Length does not match the PDF bytes.")
    return bytes(body)


@router.post("/inspect", response_model=PdfInspection)
async def inspect_uploaded_pdf(request: Request) -> PdfInspection:
    max_bytes = request.app.state.settings.max_pdf_bytes
    data = await read_pdf_body(request, max_bytes=max_bytes)
    # PDF parsing is synchronous work; keep it off the event-loop thread.
    return await run_in_threadpool(inspect_pdf, data, max_bytes=max_bytes)
