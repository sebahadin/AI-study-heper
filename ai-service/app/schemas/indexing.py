"""Verified vector writes are separate from application readiness and callbacks."""

from typing import Self

from pydantic import model_validator

from app.schemas.base import Contract, PositiveCount, Text
from app.schemas.context import SourceReference


class PdfIndexReceipt(Contract):
    source: SourceReference
    embedding_model: Text
    index_version: Text
    expected_chunks: PositiveCount
    indexed_chunks: PositiveCount
    pages_without_text: tuple[PositiveCount, ...] = ()

    @model_validator(mode="after")
    def require_complete_write(self) -> Self:
        if self.indexed_chunks != self.expected_chunks:
            raise ValueError("Every expected passage must be verified before returning a receipt.")
        return self
