"""Bounded text extraction from PDF bytes, without OCR or external services."""

from io import BytesIO

from pypdf import PdfReader, apply_configuration
from pypdf.errors import LimitReachedError, PyPdfError

from app.core.constants import MAX_PDF_CONTENT_STREAM_BYTES, MAX_PDF_TEXT_CHARACTERS
from app.core.errors import APIError
from app.rag.ingestion.pdf_validation import configure_pdf_logging, inspect_pdf
from app.schemas.jobs import PdfLimits
from app.schemas.preparation import ExtractedPdf, PdfTextPage


def extract_pdf_text(data: bytes, *, limits: PdfLimits) -> ExtractedPdf:
    """Revalidate actual bytes/pages; retain physical, one-based page numbers.

    No layout, table, or reading-order guarantees are made. Empty pages remain
    in the result so later passages cannot acquire invented page numbers.
    Run in a worker/thread, never directly on an async server's event loop.
    """
    configure_pdf_logging()
    visited_characters = 0
    extracted_characters = 0

    def check_text_budget(text, *_):
        nonlocal visited_characters
        visited_characters += len(text)
        if visited_characters > MAX_PDF_TEXT_CHARACTERS:
            raise APIError(422, "pdf_text_limit_exceeded", "The PDF contains too much text to process.")

    # Context-local parser limits do not change other requests' configuration.
    with apply_configuration(
        zlib_maximum_output_length=MAX_PDF_CONTENT_STREAM_BYTES,
        lzw_maximum_output_length=MAX_PDF_CONTENT_STREAM_BYTES,
        run_length_maximum_output_length=MAX_PDF_CONTENT_STREAM_BYTES,
        array_based_stream_maximum_output_length=MAX_PDF_CONTENT_STREAM_BYTES,
        stream_decoding_work_maximum_length=MAX_PDF_CONTENT_STREAM_BYTES * 4,
    ):
        inspection = inspect_pdf(data, max_bytes=limits.max_bytes)
        if inspection.page_count > limits.max_pages:
            raise APIError(422, "pdf_page_limit_exceeded", "The PDF exceeds the allowed page limit.")
        try:
            with BytesIO(data) as stream:
                reader = PdfReader(stream, strict=True)
                try:
                    pages = []
                    for number, page in enumerate(reader.pages, start=1):
                        content = page.get_contents()
                        if content is not None and len(content.get_data()) > MAX_PDF_CONTENT_STREAM_BYTES:
                            raise APIError(422, "pdf_content_limit_exceeded", "The PDF is too complex to process.")
                        raw_text = page.extract_text(visitor_text=check_text_budget) or ""
                        extracted_characters += len(raw_text)
                        if extracted_characters > MAX_PDF_TEXT_CHARACTERS:
                            raise APIError(422, "pdf_text_limit_exceeded", "The PDF contains too much text to process.")
                        text = raw_text.replace("\r\n", "\n").replace("\r", "\n")
                        pages.append(PdfTextPage(page_number=number, text=text))
                finally:
                    reader.close()
        except APIError:
            raise
        except LimitReachedError:
            raise APIError(422, "pdf_content_limit_exceeded", "The PDF is too complex to process.") from None
        except (PyPdfError, ValueError, TypeError, KeyError, IndexError, AttributeError,
                RecursionError, OverflowError, NotImplementedError, UnicodeError):
            # Parser exceptions can contain private PDF objects or text.
            raise APIError(422, "pdf_text_extraction_failed", "Text could not be extracted from this PDF.") from None
    return ExtractedPdf(inspection=inspection, pages=tuple(pages))
