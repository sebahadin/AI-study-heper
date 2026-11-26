"""Prepared-PDF vector indexing; upload-job orchestration follows in the worker slice."""

from app.core.errors import APIError
from app.integrations.chroma_client import ChromaIndex
from app.providers.local_embeddings import LocalHuggingFaceEmbeddings
from app.schemas.context import ExecutionContext
from app.schemas.indexing import PdfIndexReceipt
from app.schemas.preparation import PreparedPdf
from app.schemas.jobs import IngestionJob, IndexingSucceeded


class DocumentIndexer:
    def __init__(self, *, embeddings: LocalHuggingFaceEmbeddings, index: ChromaIndex):
        self.embeddings = embeddings
        self.index = index

    async def index_prepared_document(self, prepared: PreparedPdf, *, context: ExecutionContext) -> PdfIndexReceipt:
        """Embed all token-safe passages and verify their complete Chroma write.

        A receipt is not a MongoDB readiness update or a callback. The future
        worker obtains the exact authorized R2 snapshot and reports to Express.
        """
        if self.embeddings.model_id != self.index.embedding_model:
            raise APIError(409, "index_model_mismatch", "Use the same embedding model for indexing and search.")
        chunks = await self.embeddings.embed_prepared_pdf(prepared, context=context)
        verified = await self.index.upsert_chunks(chunks, context=context)
        return PdfIndexReceipt(
            source=prepared.snapshot.source, embedding_model=self.embeddings.model_id,
            index_version=self.index.index_version, expected_chunks=len(chunks), indexed_chunks=verified,
            pages_without_text=prepared.pages_without_text,
        )

    async def index_document(
        self, job: IngestionJob, *, context: ExecutionContext
    ) -> IndexingSucceeded:
        """Validate limits and ownership, index a source version, verify all chunks.

        PDFs do not require a book. Preserve page locators and canonical passages.
        Report success only after indexing verification; surface real failures to
        the worker. This pipeline never updates application MongoDB status.
        """
        raise NotImplementedError("R2 upload-job orchestration is not implemented.")
