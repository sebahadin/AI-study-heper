"""Planned extraction -> chunking -> embedding -> verified indexing workflow."""

from app.schemas.context import ExecutionContext
from app.schemas.jobs import IngestionJob, IndexingSucceeded


class DocumentIndexer:
    async def index_document(
        self, job: IngestionJob, *, context: ExecutionContext
    ) -> IndexingSucceeded:
        """Validate limits and ownership, index a source version, verify all chunks.

        PDFs do not require a book. Preserve page locators and canonical passages.
        Report success only after indexing verification; surface real failures to
        the worker. This pipeline never updates application MongoDB status.
        """
        raise NotImplementedError("The document indexing pipeline is not implemented.")
