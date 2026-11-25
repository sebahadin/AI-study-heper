"""PDF validation metadata, independent of books, storage, and retrieval state."""

from typing import Annotated

from pydantic import Field

from app.schemas.base import Contract, PositiveCount


class PdfPolicy(Contract):
    max_pages: PositiveCount
    max_bytes: PositiveCount


class PdfInspection(Contract):
    page_count: PositiveCount
    byte_count: PositiveCount
    sha256: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
