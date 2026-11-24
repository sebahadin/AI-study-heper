"""Planned authenticated internal Express adapter. No network calls exist yet."""

from collections.abc import Sequence

from app.schemas.context import ExecutionContext
from app.schemas.evidence import Passage
from app.schemas.jobs import CompletionAcknowledgement, IndexingReport


class ClassmateClient:
    async def fetch_passages(
        self, chunk_ids: Sequence[str], *, context: ExecutionContext
    ) -> tuple[Passage, ...]:
        """Have Express revalidate source ownership, scope, and current versions."""
        raise NotImplementedError("Authorized Express passage lookup is not implemented.")

    async def report_indexing_completion(
        self, report: IndexingReport, *, context: ExecutionContext
    ) -> CompletionAcknowledgement:
        """Deliver a report with service authentication and stable retry identity.

        Express validates job ownership/version, updates MongoDB, and acknowledges
        applied, duplicate, or stale. A transport error is not indexing failure.
        """
        raise NotImplementedError("The worker completion callback is not implemented.")
