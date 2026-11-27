"""Trusted runtime context is separate from user messages and model outputs."""

from typing import Annotated, Literal, Self

from pydantic import Field, StrictBool, StringConstraints, field_validator, model_validator

from app.schemas.base import Contract, Text


SelectionId = Annotated[str, StringConstraints(strict=True, pattern=r'^[a-fA-F0-9]{24}$')]


class StudySelection(Contract):
    """User selections; Express checks current ownership and expands associations."""
    library: StrictBool = False
    documents: tuple[SelectionId, ...] = Field(default=(), max_length=20)
    notes: tuple[SelectionId, ...] = Field(default=(), max_length=20)
    books: tuple[SelectionId, ...] = Field(default=(), max_length=20)
    courses: tuple[SelectionId, ...] = Field(default=(), max_length=20)

    @field_validator('documents', 'notes', 'books', 'courses')
    @classmethod
    def unique_ids(cls, values):
        return tuple(dict.fromkeys(value.lower() for value in values))

    @model_validator(mode='after')
    def bounded_selection(self) -> Self:
        count = sum(len(getattr(self, name)) for name in ('documents', 'notes', 'books', 'courses'))
        if count > 50 or self.library and count:
            raise ValueError('Choose an explicit library or a bounded material selection.')
        return self


class SourceReference(Contract):
    source_id: Text
    source_type: Literal["document", "note"]
    source_version: Text
    book_id: Text | None = None
    index_generation: Text | None = None


class AuthorizedScope(Contract):
    """An Express-resolved scope; empty sources never mean search everything."""

    scope_id: Text
    sources: tuple[SourceReference, ...] = ()
    topics: tuple[Text, ...] = ()
    selection: StudySelection | None = None


class ExecutionContext(Contract):
    """Construct only after service authentication and current ownership checks.

    Parsing this model does not establish identity or authorize any source.
    Pass it out of band; never let an LLM or browser supply trusted context.
    """

    user_id: Text
    run_id: Text
    scope: AuthorizedScope
    conversation_id: Text | None = None
    proposal_id: Text | None = None
