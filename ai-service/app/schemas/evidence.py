"""Versioned evidence, with PDF pages and non-paginated note locators."""

from typing import Self

from pydantic import Field, FiniteFloat, model_validator

from app.schemas.base import Contract, PositiveCount, Text
from app.schemas.context import SourceReference


class Citation(Contract):
    chunk_id: Text
    source: SourceReference
    locator: Text
    page_start: PositiveCount | None = None
    page_end: PositiveCount | None = None

    @model_validator(mode="after")
    def validate_pages(self) -> Self:
        if self.source.source_type == "document" and self.page_start is None:
            raise ValueError("PDF citations require a page_start.")
        if self.source.source_type == "note" and (self.page_start is not None or self.page_end is not None):
            raise ValueError("Notes use section/paragraph locators, not PDF pages.")
        if self.page_end is not None and (self.page_start is None or self.page_end < self.page_start):
            raise ValueError("page_end must not precede page_start.")
        return self


class Passage(Contract):
    citation: Citation
    text: Text


class EvidenceBundle(Contract):
    query: Text
    passages: tuple[Passage, ...] = ()


class EmbeddedChunk(Contract):
    passage: Passage
    embedding_model: Text
    embedding: tuple[FiniteFloat, ...] = Field(min_length=1)
