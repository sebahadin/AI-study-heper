"""Prepare versioned PDF passages for a future indexer, without persistence."""

from hashlib import sha256
from importlib.metadata import version
import json

from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import __version__ as pypdf_version

from app.core.constants import MAX_PDF_PREPARED_CHUNKS, PDF_PREPARATION_VERSION
from app.core.errors import APIError
from app.rag.ingestion.pdf_extraction import extract_pdf_text
from app.schemas.context import ExecutionContext
from app.schemas.evidence import Citation, Passage
from app.schemas.jobs import PdfLimits
from app.schemas.preparation import (
    PdfChunkingPolicy, PdfSourceSnapshot, PreparedPdf, PreparedPdfChunk,
)


def prepare_pdf(
    data: bytes, *, snapshot: PdfSourceSnapshot, context: ExecutionContext,
    limits: PdfLimits, chunking: PdfChunkingPolicy | None = None,
) -> PreparedPdf:
    """Check scope and exact saved bytes, then extract and split each PDF page.

    The caller must obtain a fresh Express-authorized context and snapshot;
    parsing these contracts does not establish ownership. No browser-provided
    identity, URL, storage key, or model-generated scope is accepted here.
    Empty scopes deny preparation. This never writes MongoDB or Chroma, or
    reports indexing completion. The future worker supplies the R2 bytes.
    """
    if snapshot.source not in context.scope.sources:
        raise APIError(403, "source_outside_scope", "This document version is not authorized for this operation.")
    if len(data) > limits.max_bytes:
        raise APIError(413, "pdf_too_large", "The PDF exceeds the file-size limit.")
    if sha256(data).hexdigest() != snapshot.sha256:
        raise APIError(409, "source_snapshot_mismatch", "The PDF does not match the saved source snapshot.")

    extracted = extract_pdf_text(data, limits=limits)
    policy = chunking if chunking is not None else PdfChunkingPolicy()
    preparation_version = (
        f"{PDF_PREPARATION_VERSION}/pypdf:{pypdf_version}"
        f"/langchain-text-splitters:{version('langchain-text-splitters')}"
    )
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=policy.chunk_size, chunk_overlap=policy.chunk_overlap,
        length_function=len, is_separator_regex=False,
        # Keep separators so source matching does not discard repeated text.
        strip_whitespace=False,
    )
    chunks = []
    pages_without_text = []
    for page in extracted.pages:
        if not page.text.strip():
            pages_without_text.append(page.page_number)
            continue
        covered_until = 0
        previous_start, previous_end = -1, 0
        for raw in splitter.split_text(page.text):
            # LangChain's start_index lookup can repeat an earlier occurrence
            # when overlap exceeds a short chunk. Require forward progress.
            search_from = max(previous_start + 1, previous_end - policy.chunk_overlap)
            raw_start = page.text.find(raw, search_from)
            previous_start, previous_end = raw_start, raw_start + len(raw)
            text = raw.strip()
            if not text:
                continue
            start = raw_start + len(raw) - len(raw.lstrip())
            end = start + len(text)
            if raw_start < 0 or page.text[start:end] != text or page.text[covered_until:start].strip():
                raise APIError(500, "pdf_chunking_failed", "The PDF text could not be split into verifiable passages.")
            covered_until = max(covered_until, end)
            identity = json.dumps([
                preparation_version, policy.model_dump(), context.user_id,
                snapshot.source.source_id, snapshot.source.source_version, snapshot.sha256,
                page.page_number, start, end, text,
            ], ensure_ascii=True, separators=(",", ":"), sort_keys=True)
            chunk_id = "pdf-" + sha256(identity.encode("utf-8")).hexdigest()
            citation = Citation(
                chunk_id=chunk_id, source=snapshot.source, locator=f"page {page.page_number}",
                page_start=page.page_number, page_end=page.page_number,
            )
            chunks.append(PreparedPdfChunk(
                user_id=context.user_id, passage=Passage(citation=citation, text=text),
                start_char=start, end_char=end,
            ))
            if len(chunks) > MAX_PDF_PREPARED_CHUNKS:
                raise APIError(422, "pdf_chunk_limit_exceeded", "The PDF produces too many passages to process.")
        if page.text[covered_until:].strip():
            raise APIError(500, "pdf_chunking_failed", "The PDF text could not be split into verifiable passages.")
    if not chunks:
        raise APIError(
            422, "pdf_text_unavailable",
            "This PDF has no extractable text. It may be scanned, image-only, or blank. OCR is not supported yet.",
        )
    return PreparedPdf(
        snapshot=snapshot, user_id=context.user_id, inspection=extracted.inspection,
        preparation_version=preparation_version, chunking=policy,
        pages=extracted.pages, chunks=tuple(chunks), pages_without_text=tuple(pages_without_text),
    )
