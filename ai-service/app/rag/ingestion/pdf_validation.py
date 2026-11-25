"""Inspect PDF structure without extraction, persistence, indexing, or model calls."""

from hashlib import sha256
from io import BytesIO
import logging

from pypdf import PdfReader
from pypdf.errors import PyPdfError

from app.core.constants import MAX_PDF_PAGES
from app.core.errors import APIError
from app.schemas.documents import PdfInspection


def configure_pdf_logging() -> None:
    """Keep third-party parser diagnostics, which can contain PDF text, private."""
    logging.getLogger("pypdf").setLevel(logging.CRITICAL)


def inspect_pdf(data: bytes, *, max_bytes: int) -> PdfInspection:
    """Server-owned policy applies to actual bytes and parsed pages, not claims.

    This is structural validation, not a guarantee of extractable text, safe
    embedded content, or an index ready for retrieval. No document is executed.
    """
    if len(data) > max_bytes:
        raise APIError(413, "pdf_too_large", "The PDF exceeds the file-size limit.")
    if not data.startswith(b"%PDF-"):
        raise APIError(422, "invalid_pdf", "Upload a valid PDF file.")

    try:
        with BytesIO(data) as stream:
            reader = PdfReader(stream, strict=True)
            try:
                if reader.is_encrypted:
                    raise APIError(422, "encrypted_pdf", "Upload an unencrypted PDF file.")
                page_count = len(reader.pages)
            finally:
                reader.close()
    except (PyPdfError, ValueError, TypeError, KeyError, IndexError, RecursionError, OverflowError):
        # Parser errors may include document content. Never expose their text.
        raise APIError(422, "invalid_pdf", "Upload a valid PDF file.") from None

    if page_count == 0:
        raise APIError(422, "empty_pdf", "The PDF must contain at least one page.")
    if page_count > MAX_PDF_PAGES:
        raise APIError(
            422, "pdf_page_limit_exceeded", f"PDFs must have at most {MAX_PDF_PAGES} pages.",
        )
    return PdfInspection(page_count=page_count, byte_count=len(data), sha256=sha256(data).hexdigest())
