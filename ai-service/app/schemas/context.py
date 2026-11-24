"""Trusted runtime context is separate from user messages and model outputs."""

from typing import Literal

from app.schemas.base import Contract, Text


class SourceReference(Contract):
    source_id: Text
    source_type: Literal["document", "note"]
    source_version: Text
    book_id: Text | None = None


class AuthorizedScope(Contract):
    """An Express-resolved scope; empty sources never mean search everything."""

    scope_id: Text
    sources: tuple[SourceReference, ...] = ()
    topics: tuple[Text, ...] = ()


class ExecutionContext(Contract):
    """Construct only after service authentication and current ownership checks.

    Parsing this model does not establish identity or authorize any source.
    Pass it out of band; never let an LLM or browser supply trusted context.
    """

    user_id: Text
    run_id: Text
    scope: AuthorizedScope
    conversation_id: Text | None = None
