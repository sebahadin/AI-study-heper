"""Chroma adapter boundary; the future SDK is isolated here."""

from collections.abc import Sequence

from app.schemas.context import ExecutionContext
from app.schemas.evidence import Citation, EmbeddedChunk


class ChromaIndex:
    async def search(
        self, query_embedding: Sequence[float], *, context: ExecutionContext, limit: int
    ) -> tuple[Citation, ...]:
        """Return ranked candidates with mandatory owner and source filters.

        Candidate citations still require canonical Express revalidation before
        their passages enter an LLM context. Never treat index metadata as permission.
        """
        raise NotImplementedError("Scoped Chroma search is not implemented.")

    async def upsert_chunks(
        self, chunks: Sequence[EmbeddedChunk], *, context: ExecutionContext
    ) -> None:
        """Upsert stable chunk IDs, deriving owner metadata from trusted context."""
        raise NotImplementedError("Versioned Chroma upserts are not implemented.")
