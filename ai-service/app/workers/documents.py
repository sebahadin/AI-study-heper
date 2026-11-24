"""The document worker reports results to Express rather than writing app records."""

from app.integrations.classmate_client import ClassmateClient
from app.rag.ingestion.pipeline import DocumentIndexer
from app.schemas.context import ExecutionContext
from app.schemas.jobs import CompletionAcknowledgement, IngestionJob


class DocumentIngestionWorker:
    async def run(
        self,
        job: IngestionJob,
        *,
        context: ExecutionContext,
        indexer: DocumentIndexer,
        classmate: ClassmateClient,
    ) -> CompletionAcknowledgement:
        """Index, then send a versioned ready/failed report to authenticated Express.

        Retry indexing failures according to job policy. Retry callback delivery
        with the same report independently; do not relabel a delivery outage as
        indexing failure. Respect stale/duplicate acknowledgements. A worker crash
        requires timeout/recovery handling outside this method.
        """
        raise NotImplementedError("The ingestion worker and result delivery are not implemented.")
