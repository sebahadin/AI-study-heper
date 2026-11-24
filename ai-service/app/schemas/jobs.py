"""Standalone PDF jobs and versioned worker-to-Express completion messages."""

from typing import Annotated, Literal, Self

from pydantic import Field, model_validator

from app.core.constants import MAX_PDF_PAGES
from app.schemas.base import Contract, Count, PositiveCount, Text


class PdfLimits(Contract):
    """Use the server page default; file-size policy still requires an explicit value."""

    max_pages: PositiveCount = MAX_PDF_PAGES
    max_bytes: PositiveCount


class IngestionJob(Contract):
    job_id: Text
    document_id: Text
    source_version: Text
    storage_key: Text
    limits: PdfLimits


class IndexingReportBase(Contract):
    job_id: Text
    document_id: Text
    source_version: Text


class IndexingSucceeded(IndexingReportBase):
    status: Literal["ready"] = "ready"
    expected_chunks: PositiveCount
    indexed_chunks: PositiveCount
    embedding_model: Text
    index_version: Text

    @model_validator(mode="after")
    def require_complete_index(self) -> Self:
        if self.indexed_chunks != self.expected_chunks:
            raise ValueError("A ready report requires every expected chunk to be indexed.")
        return self


class IndexingFailed(IndexingReportBase):
    status: Literal["failed"] = "failed"
    error_code: Text
    message: Text
    indexed_chunks: Count = 0
    retryable: bool = False


IndexingReport = Annotated[IndexingSucceeded | IndexingFailed, Field(discriminator="status")]


class CompletionAcknowledgement(Contract):
    job_id: Text
    document_id: Text
    source_version: Text
    disposition: Literal["applied", "duplicate", "stale"]
