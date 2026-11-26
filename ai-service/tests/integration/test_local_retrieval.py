"""Opt-in real CPU model + persistent Chroma test. Download the model once first."""

from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import subprocess
import sys

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
import pytest

from app.core.retrieval_config import RetrievalSettings
from app.integrations.chroma_client import ChromaIndex
from app.providers.local_embeddings import LocalHuggingFaceEmbeddings
from app.rag.ingestion.pipeline import DocumentIndexer
from app.rag.ingestion.preparation import prepare_pdf
from app.schemas.context import AuthorizedScope, ExecutionContext, SourceReference
from app.schemas.jobs import PdfLimits
from app.schemas.preparation import PdfChunkingPolicy, PdfSourceSnapshot

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


def pdf(text):
    writer = PdfWriter()
    page = writer.add_blank_page(width=500, height=500)
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({
        NameObject('/F1'): DictionaryObject({NameObject('/Type'): NameObject('/Font'),
            NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')}),
    })})
    stream = DecodedStreamObject()
    stream.set_data(b'BT /F1 12 Tf 20 450 Td (' + text.encode('ascii') + b') Tj ET')
    page[NameObject('/Contents')] = writer._add_object(stream)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def context(source, user="integration-owner"):
    return ExecutionContext(user_id=user, run_id="integration-run", scope=AuthorizedScope(scope_id="selected", sources=(source,)))


async def test_real_model_pdf_indexing_search_and_fresh_process_persistence(tmp_path):
    # _env_file=None avoids reading real credentials; all inference is offline.
    settings = RetrievalSettings(_env_file=None, embedding_local_files_only=True)
    embeddings = LocalHuggingFaceEmbeddings(settings)
    query = (await embeddings.embed(["Which organelle supplies energy to cells?"]))[0]
    assert len(query) == 384
    index = ChromaIndex(path=tmp_path / "chroma", embedding_model=embeddings.model_id, dimension=len(query))
    indexer = DocumentIndexer(embeddings=embeddings, index=index)

    biology = SourceReference(source_id="biology", source_type="document", source_version="v1")
    algorithms = SourceReference(source_id="algorithms", source_type="document", source_version="v1")
    prepared_biology = None
    for ref, text in [(biology, "Mitochondria convert nutrients into ATP, supplying energy for cells."),
                      (algorithms, "A stack removes the most recently added item first. A queue removes the earliest item.")]:
        data = pdf(text)
        prepared = prepare_pdf(data, snapshot=PdfSourceSnapshot(source=ref, sha256=sha256(data).hexdigest()),
                               context=context(ref), limits=PdfLimits(max_bytes=len(data)))
        if ref == biology:
            prepared_biology = prepared
        receipt = await indexer.index_prepared_document(prepared, context=context(ref))
        assert receipt.expected_chunks == receipt.indexed_chunks == 1

    selected = context(biology).model_copy(update={"scope": AuthorizedScope(scope_id="both", sources=(biology, algorithms))})
    candidates = await index.search(query, context=selected, limit=1)
    assert len(candidates) == 1 and candidates[0].source == biology and candidates[0].page_start == 1
    # A different user with the same source IDs still has no matching vectors.
    assert await index.search(query, context=context(biology, "another-user"), limit=5) == ()
    retry_receipt = await indexer.index_prepared_document(prepared_biology, context=context(biology))
    assert retry_receipt.indexed_chunks == retry_receipt.expected_chunks == 1
    assert index._get_collection().count() == 2

    # A real source whose character-sized chunk exceeds this model's token limit.
    long_data = pdf("x " * 600)
    long_ref = SourceReference(source_id="long-example", source_type="document", source_version="v1")
    prepared = prepare_pdf(long_data, snapshot=PdfSourceSnapshot(source=long_ref, sha256=sha256(long_data).hexdigest()),
                           context=context(long_ref), limits=PdfLimits(max_bytes=len(long_data)),
                           chunking=PdfChunkingPolicy(chunk_size=2000, chunk_overlap=150))
    receipt = await indexer.index_prepared_document(prepared, context=context(long_ref))
    assert receipt.expected_chunks > len(prepared.chunks)
    assert receipt.indexed_chunks == receipt.expected_chunks

    state = {"path": str(index.path), "model": embeddings.model_id, "query": query, "context": context(biology).model_dump()}
    probe = '''
import asyncio, json, sys
from pathlib import Path
from app.integrations.chroma_client import ChromaIndex
from app.schemas.context import ExecutionContext
state = json.loads(sys.stdin.read())
index = ChromaIndex(path=Path(state['path']), embedding_model=state['model'], dimension=len(state['query']))
result = asyncio.run(index.search(state['query'], context=ExecutionContext.model_validate(state['context']), limit=1))
print(json.dumps([item.source.source_id for item in result]))
'''
    result = subprocess.run([sys.executable, "-c", probe], input=json.dumps(state), text=True, capture_output=True,
                            cwd=Path(__file__).resolve().parents[2], check=True, timeout=30)
    assert json.loads(result.stdout) == ["biology"]
