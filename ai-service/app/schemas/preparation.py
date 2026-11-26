"""In-memory PDF preparation results; these do not claim an index is ready."""

from typing import Annotated, Self

from pydantic import Field, StringConstraints, model_validator

from app.core.constants import DEFAULT_PDF_CHUNK_CHARACTERS, DEFAULT_PDF_CHUNK_OVERLAP
from app.schemas.base import Contract, Count, PositiveCount, Text
from app.schemas.context import SourceReference
from app.schemas.documents import PdfInspection
from app.schemas.evidence import Passage


class PdfSourceSnapshot(Contract):
    """Source/version and digest resolved from Express's validated document record."""

    source: SourceReference
    sha256: Annotated[str, Field(strict=True, pattern=r"^[a-f0-9]{64}$")]

    @model_validator(mode="after")
    def require_pdf_source(self) -> Self:
        if self.source.source_type != "document":
            raise ValueError("PDF preparation requires a document source.")
        return self


class PdfTextPage(Contract):
    page_number: PositiveCount
    # Keep canonical whitespace, including indentation; empty pages are explicit.
    text: Annotated[str, StringConstraints(strict=True)] = Field(repr=False)


class ExtractedPdf(Contract):
    inspection: PdfInspection
    pages: tuple[PdfTextPage, ...] = Field(min_length=1, repr=False)


class PdfChunkingPolicy(Contract):
    """Server-owned character limits; tune for the chosen embedding model later."""

    chunk_size: PositiveCount = DEFAULT_PDF_CHUNK_CHARACTERS
    chunk_overlap: Count = DEFAULT_PDF_CHUNK_OVERLAP

    @model_validator(mode="after")
    def require_smaller_overlap(self) -> Self:
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError("Chunk overlap must be smaller than chunk size.")
        return self


class PreparedPdfChunk(Contract):
    user_id: Text
    passage: Passage = Field(repr=False)
    # Zero-based, end-exclusive offsets within the canonical extracted page.
    start_char: Count
    end_char: PositiveCount

    @model_validator(mode="after")
    def require_exact_span(self) -> Self:
        if self.end_char - self.start_char != len(self.passage.text):
            raise ValueError("The character range must match the passage length.")
        return self


class PreparedPdf(Contract):
    snapshot: PdfSourceSnapshot
    user_id: Text
    inspection: PdfInspection
    preparation_version: Text
    chunking: PdfChunkingPolicy
    pages: tuple[PdfTextPage, ...] = Field(min_length=1, repr=False)
    chunks: tuple[PreparedPdfChunk, ...] = Field(min_length=1, repr=False)
    # No text does not prove that a page is scanned: it might also be blank.
    pages_without_text: tuple[PositiveCount, ...] = ()
