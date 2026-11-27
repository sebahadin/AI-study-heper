"""Local model boundaries and actual persistent Chroma authorization tests."""

from hashlib import sha256
import re

from pydantic import ValidationError
import pytest
import numpy as np
from langchain_huggingface import HuggingFaceEmbeddings
from transformers import PreTrainedTokenizerBase

from app.core.errors import APIError
from app.core.retrieval_config import RetrievalSettings
from app.integrations.chroma_client import ChromaIndex
from app.providers.local_embeddings import LocalHuggingFaceEmbeddings
from app.rag.ingestion.pipeline import DocumentIndexer
from app.schemas.context import AuthorizedScope, ExecutionContext, SourceReference
from app.schemas.documents import PdfInspection
from app.schemas.evidence import Citation, EmbeddedChunk, Passage
from app.schemas.indexing import PdfIndexReceipt
from app.schemas.preparation import (
    PdfChunkingPolicy, PdfSourceSnapshot, PdfTextPage, PreparedPdf, PreparedPdfChunk,
)

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


def source(name="doc-1", version="v1", kind="document"):
    return SourceReference(source_id=name, source_type=kind, source_version=version)


def context(user="owner-1", sources=None):
    return ExecutionContext(user_id=user, run_id="run-1", scope=AuthorizedScope(
        scope_id="scope-1", sources=tuple(sources if sources is not None else [source()]),
    ))


def embedded(ref=None, *, chunk_id="chunk-1", model="model-v1", vector=(1., 0., 0.), text="Cells need energy."):
    ref = ref or source()
    return EmbeddedChunk(
        passage=Passage(text=text, citation=Citation(
            chunk_id=chunk_id, source=ref,
            locator="page 1" if ref.source_type == "document" else "paragraph 1",
            page_start=1 if ref.source_type == "document" else None,
        )), embedding_model=model, embedding=vector,
    )


def prepared(text="Long examples demonstrate how token limits work. " * 8):
    ref = source()
    return PreparedPdf(
        snapshot=PdfSourceSnapshot(source=ref, sha256=sha256(text.encode()).hexdigest()),
        user_id="owner-1", inspection=PdfInspection(page_count=1, byte_count=100, sha256=sha256(text.encode()).hexdigest()),
        preparation_version="test-preparation", chunking=PdfChunkingPolicy(),
        pages=(PdfTextPage(page_number=1, text=text),),
        chunks=(PreparedPdfChunk(user_id="owner-1", passage=Passage(text=text, citation=Citation(
            chunk_id="prepared-1", source=ref, locator="page 1", page_start=1,
        )), start_char=0, end_char=len(text.strip())),),
    )


class FakeTokenizer(PreTrainedTokenizerBase):
    special_count = 2

    def tokenize(self, text, **_options):
        return list(text)

    def num_special_tokens_to_add(self, pair=False):
        assert pair is False
        return self.special_count

    def encode(self, text, **options):
        assert options == {"add_special_tokens": True, "truncation": False}
        return list(range(len(text) + self.special_count))


class FakeModel:
    tokenizer = FakeTokenizer()
    max_seq_length = 40

    def __init__(self):
        self.seen = []

    def get_sentence_embedding_dimension(self):
        return 3

    def encode(self, texts, **options):
        assert options["normalize_embeddings"] is True
        assert options["prompt"] == ""
        self.seen.extend(texts)
        return np.asarray([(1., 0., 0.) for _ in texts])


def fake_embedder():
    model = LocalHuggingFaceEmbeddings(RetrievalSettings(_env_file=None))
    model._model = FakeModel()
    model._embeddings = HuggingFaceEmbeddings.model_construct(
        encode_kwargs={"normalize_embeddings": True, "prompt": ""},
    )
    model._embeddings._client = model._model
    return model


async def test_embedding_fits_complete_passages_without_losing_text_and_is_retry_stable():
    model = fake_embedder()
    document = prepared()
    first = await model.embed_prepared_pdf(document, context=context())
    retry = await model.embed_prepared_pdf(document, context=context())
    assert len(first) > len(document.chunks)
    assert first == retry
    assert len({chunk.passage.citation.chunk_id for chunk in first}) == len(first)
    assert re.sub(r"\s", "", "".join(chunk.passage.text for chunk in first)) == re.sub(r"\s", "", document.chunks[0].passage.text)
    assert all(len(text) + 2 <= model._model.max_seq_length for text in model._model.seen)
    assert all(chunk.passage.citation.source == source() and chunk.passage.citation.page_start == 1 for chunk in first)


@pytest.mark.parametrize("text", ["x" * 400, "def code():\n    return value\n" * 10, "é" * 100])
async def test_token_fitting_handles_long_words_code_and_unicode(text):
    chunks = await fake_embedder().embed_prepared_pdf(prepared(text), context=context())
    assert re.sub(r"\s", "", "".join(chunk.passage.text for chunk in chunks)) == re.sub(r"\s", "", text)


async def test_oversized_queries_are_rejected_instead_of_silently_truncated():
    model = fake_embedder()
    with pytest.raises(APIError) as error:
        await model.embed(["x" * 100])
    assert error.value.code == "embedding_input_too_long"
    assert model._model.seen == []


@pytest.mark.parametrize("ctx", [context("other-owner"), context(sources=[]), context(sources=[source(version="stale")])])
async def test_prepared_embedding_checks_authorization_before_model_loading(ctx, monkeypatch):
    model = fake_embedder()
    monkeypatch.setattr(model, "_load_model", lambda: pytest.fail("Must authorize before loading a model"))
    with pytest.raises(APIError) as error:
        await model.embed_prepared_pdf(prepared(), context=ctx)
    assert error.value.code == "source_outside_scope"


@pytest.mark.parametrize("rows,code", [([], "embedding_incomplete"), ([(float("nan"), 0., 1.)], "invalid_embedding_output"),
                                       ([(1., 0.)], "invalid_embedding_output"), ([(0., 0., 0.)], "invalid_embedding_output")])
async def test_bad_or_missing_model_outputs_cannot_be_indexed(rows, code, monkeypatch):
    model = fake_embedder()
    monkeypatch.setattr(model._model, "encode", lambda *_args, **_kwargs: np.asarray(rows))
    with pytest.raises(APIError) as error:
        await model.embed(["Small text"])
    assert error.value.code == code


async def test_model_failures_do_not_expose_private_inputs(monkeypatch):
    def fail(*_args, **_kwargs):
        raise RuntimeError("private-text-and-provider-details")
    model = fake_embedder()
    monkeypatch.setattr(model, "_load_model", fail)
    with pytest.raises(APIError) as error:
        await model.embed(["private-text-and-provider-details"])
    assert error.value.code == "embedding_unavailable"
    assert "private-text" not in str(error.value)


async def test_chroma_retries_are_idempotent_and_verify_exact_stored_content(tmp_path):
    index = ChromaIndex(path=tmp_path, embedding_model="model-v1", dimension=3)
    chunks = [embedded(chunk_id=f"chunk-{number}", text=f"Passage {number}") for number in range(3)]
    assert await index.upsert_chunks(chunks, context=context()) == 3
    assert await index.upsert_chunks(chunks, context=context()) == 3
    assert index._get_collection().count() == 3
    assert len(await index.search((1., 0., 0.), context=context(), limit=10)) == 3


async def test_same_public_chunk_id_cannot_overwrite_another_users_vectors(tmp_path):
    index = ChromaIndex(path=tmp_path, embedding_model="model-v1", dimension=3)
    await index.upsert_chunks([embedded(text="First user's material")], context=context())
    await index.upsert_chunks([embedded(text="Second user's material")], context=context("owner-2"))
    assert index._get_collection().count() == 2
    rows = index._get_collection().get(include=["documents", "metadatas"])
    assert set(rows["documents"]) == {"First user's material", "Second user's material"}
    assert len(await index.search((1., 0., 0.), context=context(), limit=10)) == 1


async def test_chroma_scopes_exact_source_version_pairs_instead_of_cross_matching(tmp_path):
    index = ChromaIndex(path=tmp_path, embedding_model="model-v1", dimension=3)
    refs = [source("A", "v1"), source("A", "v2"), source("B", "v1"), source("B", "v2")]
    for ref in refs:
        await index.upsert_chunks([embedded(ref)], context=context(sources=[ref]))
    selected = context(sources=[source("A", "v2"), source("B", "v1")])
    citations = await index.search((1., 0., 0.), context=selected, limit=10)
    assert {(item.source.source_id, item.source.source_version) for item in citations} == {("A", "v2"), ("B", "v1")}
    assert await index.search((1., 0., 0.), context=context("no-materials", refs), limit=10) == ()


async def test_notes_and_documents_remain_distinct_sources(tmp_path):
    index = ChromaIndex(path=tmp_path, embedding_model="model-v1", dimension=3)
    note = source("same-id", kind="note")
    document = source("same-id")
    await index.upsert_chunks([embedded(note), embedded(document)], context=context(sources=[note, document]))
    citations = await index.search((1., 0., 0.), context=context(sources=[note]), limit=10)
    assert len(citations) == 1 and citations[0].page_start is None
    assert citations[0].locator == "paragraph 1"


async def test_empty_scope_does_not_open_chroma_or_broaden_search(tmp_path):
    index = ChromaIndex(path=tmp_path / "unused", embedding_model="model-v1", dimension=3)
    assert await index.search((), context=context(sources=[]), limit=10) == ()
    assert not index.path.exists()


async def test_foreign_sources_and_duplicate_ids_reject_before_any_write(tmp_path):
    index = ChromaIndex(path=tmp_path / "unused", embedding_model="model-v1", dimension=3)
    for chunks, code in [([embedded(), embedded(source("foreign"))], "source_outside_scope"),
                         ([embedded(), embedded()], "duplicate_chunk_ids"),
                         ([embedded(model="different-model")], "index_model_mismatch")]:
        with pytest.raises(APIError) as error:
            await index.upsert_chunks(chunks, context=context())
        assert error.value.code == code
    assert not index.path.exists()


@pytest.mark.parametrize("vector", [(), (1., 2.), (float("nan"), 0., 1.), (0., 0., 0.), ("not-a-number", 0., 1.)])
async def test_invalid_query_vectors_do_not_open_the_index(tmp_path, vector):
    index = ChromaIndex(path=tmp_path / "unused", embedding_model="model-v1", dimension=3)
    with pytest.raises(APIError) as error:
        await index.search(vector, context=context(), limit=1)
    assert error.value.code == "invalid_index_vector"
    assert not index.path.exists()


@pytest.mark.parametrize("corruption", ["missing", "text", "vector", "metadata"])
async def test_incomplete_or_changed_readback_is_a_failure_not_a_success_count(tmp_path, monkeypatch, corruption):
    index = ChromaIndex(path=tmp_path, embedding_model="model-v1", dimension=3)
    collection = index._get_collection()
    original = collection.get
    def partial(*args, **kwargs):
        result = original(*args, **kwargs)
        if corruption == "missing":
            result["ids"] = []
        elif corruption == "text":
            result["documents"][0] = "Changed text"
        elif corruption == "vector":
            result["embeddings"][0] = [0., 1., 0.]
        else:
            result["metadatas"][0] = {**result["metadatas"][0], "user_id": "other-owner"}
        return result
    monkeypatch.setattr(collection, "get", partial)
    with pytest.raises(APIError) as error:
        await index.upsert_chunks([embedded()], context=context())
    assert error.value.code == "index_incomplete"


async def test_index_errors_hide_private_database_details(tmp_path, monkeypatch):
    index = ChromaIndex(path=tmp_path, embedding_model="model-v1", dimension=3)
    def fail():
        raise RuntimeError("private-source-contents-and-path")
    monkeypatch.setattr(index, "_get_collection", fail)
    with pytest.raises(APIError) as error:
        await index.upsert_chunks([embedded()], context=context())
    assert error.value.code == "index_unavailable"
    assert "private-source" not in str(error.value)


async def test_candidates_cannot_forge_an_unscoped_citation(tmp_path):
    index = ChromaIndex(path=tmp_path, embedding_model="model-v1", dimension=3)
    await index.upsert_chunks([embedded()], context=context())
    collection = index._get_collection()
    rows = collection.get(include=["metadatas"])
    metadata = dict(rows["metadatas"][0])
    metadata["citation"] = embedded(source("unauthorized")).passage.citation.model_dump_json()
    collection.update(ids=rows["ids"], metadatas=[metadata])
    with pytest.raises(APIError) as error:
        await index.search((1., 0., 0.), context=context(), limit=1)
    assert error.value.code == "invalid_index_candidate"


async def test_prepared_indexing_only_returns_receipt_after_full_verification(tmp_path):
    model = fake_embedder()
    index = ChromaIndex(path=tmp_path, embedding_model=model.model_id, dimension=3)
    indexer = DocumentIndexer(embeddings=model, index=index)
    receipt = await indexer.index_prepared_document(prepared(), context=context())
    assert receipt.expected_chunks == receipt.indexed_chunks == index._get_collection().count()
    assert "status" not in receipt.model_dump()
    assert "job_id" not in receipt.model_dump()


def test_receipt_cannot_claim_partial_indexing_completed():
    with pytest.raises(ValidationError):
        PdfIndexReceipt(source=source(), embedding_model="model", index_version="index", expected_chunks=2, indexed_chunks=1)


def test_model_revision_is_pinned_and_retrieval_paths_do_not_depend_on_working_directory(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    settings = RetrievalSettings(_env_file=None)
    assert len(settings.embedding_revision) == 40
    assert settings.chroma_path.is_absolute()
    assert settings.embedding_cache_path.is_absolute()
    assert settings.chroma_path.parts[-2:] == (".cache", "chroma")
    with pytest.raises(ValidationError):
        RetrievalSettings(_env_file=None, embedding_revision="main")


async def test_verified_writes_work_across_sdk_batch_boundaries(tmp_path):
    index = ChromaIndex(path=tmp_path, embedding_model="model-v1", dimension=3)
    chunks = [embedded(chunk_id=f"chunk-{number}") for number in range(101)]
    assert await index.upsert_chunks(chunks, context=context()) == 101
    assert index._get_collection().count() == 101


async def test_pipeline_rejects_model_mismatch_before_inference(tmp_path, monkeypatch):
    model = fake_embedder()
    index = ChromaIndex(path=tmp_path / "unused", embedding_model="other-model", dimension=3)
    def forbidden(*_args, **_kwargs):
        pytest.fail("Must check model compatibility before inference")
    monkeypatch.setattr(model, "embed_prepared_pdf", forbidden)
    with pytest.raises(APIError) as error:
        await DocumentIndexer(embeddings=model, index=index).index_prepared_document(prepared(), context=context())
    assert error.value.code == "index_model_mismatch"
    assert not index.path.exists()


@pytest.mark.parametrize("special_tokens", [2, 6])
async def test_token_splitter_reserves_special_tokens_and_preserves_source_coverage(special_tokens):
    model = fake_embedder()
    model._model.tokenizer = FakeTokenizer()
    model._model.tokenizer.special_count = special_tokens
    text = "repeat " * 20 + "final words"
    chunks = await model.embed_prepared_pdf(prepared(text), context=context())
    assert len(chunks) > 1
    assert re.sub(r"\s", "", "".join(chunk.passage.text for chunk in chunks)) == re.sub(r"\s", "", text)
    assert all(len(chunk.passage.text) + special_tokens <= model._model.max_seq_length for chunk in chunks)


async def test_passage_at_exact_model_limit_keeps_its_citation_id():
    model = fake_embedder()
    document = prepared("x" * (model._model.max_seq_length - 2))
    chunks = await model.embed_prepared_pdf(document, context=context())
    assert len(chunks) == 1
    assert chunks[0].passage.citation == document.chunks[0].passage.citation
    assert chunks[0].passage.text == document.chunks[0].passage.text


@pytest.mark.parametrize("failure", ["missing", "invented", "oversized"])
async def test_bad_splitter_results_fail_before_any_embedding(failure, monkeypatch):
    model = fake_embedder()
    document = prepared("Beginning repeated source material. " * 5 + "The end.")
    text = document.chunks[0].passage.text
    class BrokenSplitter:
        def split_text(self, _text):
            if failure == "missing":
                return [text[:20], text[-20:]]
            if failure == "invented":
                return ["invented-private-source-text"]
            return [text]
    monkeypatch.setattr("app.providers.local_embeddings.RecursiveCharacterTextSplitter.from_huggingface_tokenizer",
                        lambda *_args, **_kwargs: BrokenSplitter())
    with pytest.raises(APIError) as error:
        await model.embed_prepared_pdf(document, context=context())
    expected = "embedding_input_too_long" if failure == "oversized" else "embedding_chunking_failed"
    assert error.value.code == expected
    assert model._model.seen == []
    assert "invented-private" not in str(error.value)


async def test_token_splitter_version_changes_subpassage_ids_without_changing_text(monkeypatch):
    model = fake_embedder()
    document = prepared()
    first = await model.embed_prepared_pdf(document, context=context())
    monkeypatch.setattr("app.providers.local_embeddings.PDF_TOKEN_SPLITTING_VERSION", "next-split-version")
    second = await model.embed_prepared_pdf(document, context=context())
    assert [chunk.passage.text for chunk in first] == [chunk.passage.text for chunk in second]
    assert {chunk.passage.citation.chunk_id for chunk in first}.isdisjoint(chunk.passage.citation.chunk_id for chunk in second)


async def test_langchain_huggingface_constructor_loads_only_on_first_use_and_keeps_local_settings(monkeypatch):
    calls = []
    def load(model_name, **kwargs):
        calls.append((model_name, kwargs))
        return FakeModel()
    monkeypatch.setattr("sentence_transformers.SentenceTransformer", load)
    settings = RetrievalSettings(_env_file=None, embedding_local_files_only=True)
    model = LocalHuggingFaceEmbeddings(settings)
    assert model._model is None and model._embeddings is None and calls == []
    vectors = await model.embed(["Small text"])
    assert len(vectors) == 1
    assert isinstance(model._embeddings, HuggingFaceEmbeddings)
    assert len(calls) == 1
    name, options = calls[0]
    assert name == settings.embedding_model
    assert options["revision"] == settings.embedding_revision
    assert options["device"] == settings.embedding_device
    assert options["local_files_only"] is True
    assert options["trust_remote_code"] is False and options["token"] is False
    assert options["model_kwargs"]["use_safetensors"] is True
    await model.embed(["Another small text"])
    assert len(calls) == 1


async def test_langchain_embedding_normalization_keeps_original_passage_text_and_citations():
    model = fake_embedder()
    document = prepared("First line.\nSecond line.")
    chunks = await model.embed_prepared_pdf(document, context=context())
    assert model._model.seen == ["First line. Second line."]
    assert chunks[0].passage.text == "First line.\nSecond line."
    assert chunks[0].passage.citation == document.chunks[0].passage.citation


async def test_background_audit_detects_missing_or_changed_canonical_passages(tmp_path):
    from app.workers.documents import manifest_digest
    ref = source().model_copy(update={"index_generation": "generation-1"})
    ctx = context(sources=[ref])
    chunk = embedded(ref)
    index = ChromaIndex(path=tmp_path, embedding_model="model-v1", dimension=3)
    await index.upsert_chunks([chunk], context=ctx)
    candidate = {"source_id": ref.source_id, "source_type": ref.source_type, "user_id": ctx.user_id,
                 "source_version": ref.source_version, "generation_id": ref.index_generation,
                 "chunk_ids": [chunk.passage.citation.chunk_id], "manifest_digest": manifest_digest([chunk.passage.model_dump(mode="json")])}
    assert await index.audit_source(candidate) is True
    collection = index._get_collection()
    physical = collection.get()["ids"][0]
    collection.update(ids=[physical], documents=["Corrupt stored text"], embeddings=[list(chunk.embedding)])
    assert await index.audit_source(candidate) is False
    await index.upsert_chunks([chunk], context=ctx)
    assert await index.audit_source(candidate) is True
    collection.delete(ids=[physical])
    assert await index.audit_source(candidate) is False


async def test_audit_outage_is_not_misreported_as_missing_data(tmp_path, monkeypatch):
    index = ChromaIndex(path=tmp_path, embedding_model="model-v1", dimension=3)
    def unavailable(): raise ConnectionError("private-server-details")
    monkeypatch.setattr(index, "_get_collection", unavailable)
    with pytest.raises(APIError) as error:
        await index.audit_source({"user_id": "owner", "source_id": "id", "source_type": "document", "source_version": "v1", "generation_id": "g1"})
    assert error.value.code == "index_unavailable"
    assert "private-server-details" not in str(error.value)
