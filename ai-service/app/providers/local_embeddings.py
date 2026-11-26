"""Lazy, local Hugging Face inference. Model downloads never contain study text."""

import asyncio
from collections.abc import Sequence
from hashlib import sha256
from importlib.metadata import version
import json
from math import isfinite
from threading import RLock

from langchain_huggingface import HuggingFaceEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.core.constants import MAX_PDF_PREPARED_CHUNKS, PDF_TOKEN_SPLITTING_VERSION
from app.core.errors import APIError
from app.core.retrieval_config import RetrievalSettings
from app.schemas.context import ExecutionContext
from app.schemas.evidence import EmbeddedChunk
from app.schemas.preparation import PreparedPdf


class LocalHuggingFaceEmbeddings:
    def __init__(self, settings: RetrievalSettings):
        self.settings = settings
        self._model = None
        self._embeddings = None
        self._lock = RLock()
        self.model_id = (
            f"hf:{settings.embedding_model}@{settings.embedding_revision}"
            f"/sentence-transformers:{version('sentence-transformers')}"
            f"/transformers:{version('transformers')}"
            f"/langchain-huggingface:{version('langchain-huggingface')}/normalized-v2"
        )

    def _load_model(self):
        if self._model is None:
            embeddings = HuggingFaceEmbeddings(
                model_name=self.settings.embedding_model,
                cache_folder=str(self.settings.embedding_cache_path),
                model_kwargs={
                    "revision": self.settings.embedding_revision,
                    "device": self.settings.embedding_device,
                    "local_files_only": self.settings.embedding_local_files_only,
                    "trust_remote_code": False, "token": False,
                    "model_kwargs": {"use_safetensors": True},
                },
                encode_kwargs={
                    "batch_size": self.settings.embedding_batch_size,
                    "normalize_embeddings": True, "convert_to_numpy": True, "prompt": "",
                },
                show_progress=False, multi_process=False,
            )
            # Reuse the encoder owned by LangChain for tokenizer/limit checks.
            self._model = embeddings._client
            self._embeddings = embeddings
        return self._model

    @staticmethod
    def _token_count(model, text: str) -> int:
        # Match HuggingFaceEmbeddings' newline normalization for inference only.
        return len(model.tokenizer.encode(text.replace("\n", " "), add_special_tokens=True, truncation=False))

    def _encode(self, texts: Sequence[str]) -> tuple[tuple[float, ...], ...]:
        if not texts:
            return ()
        if len(texts) > MAX_PDF_PREPARED_CHUNKS or any(not isinstance(text, str) or not text.strip() for text in texts):
            raise APIError(422, "invalid_embedding_input", "Provide a bounded set of nonempty passages.")
        with self._lock:
            model = self._load_model()
            if any(self._token_count(model, text) > model.max_seq_length for text in texts):
                raise APIError(422, "embedding_input_too_long", "Split this passage before embedding it.")
            vectors = self._embeddings.embed_documents(list(texts))
            dimension_method = getattr(model, "get_embedding_dimension", None) or model.get_sentence_embedding_dimension
            dimension = dimension_method()
            if len(vectors) != len(texts):
                raise APIError(503, "embedding_incomplete", "Not every passage was embedded.")
            result = tuple(tuple(float(value) for value in vector) for vector in vectors)
            if any(len(row) != dimension or not all(isfinite(value) for value in row) or not any(row) for row in result):
                raise APIError(503, "invalid_embedding_output", "The embedding model returned invalid vectors.")
            return result

    async def embed(self, texts: Sequence[str]) -> tuple[tuple[float, ...], ...]:
        """Embed complete inputs locally; never silently truncate long queries."""
        try:
            return await asyncio.to_thread(self._encode, tuple(texts))
        except APIError:
            raise
        except Exception:
            raise APIError(503, "embedding_unavailable", "Local embeddings are temporarily unavailable.") from None

    def _fit_spans(self, text: str, model) -> list[tuple[int, int]]:
        """Use LangChain's HF token counting and verify exact source coverage."""
        if self._token_count(model, text) <= model.max_seq_length:
            return [(0, len(text))]
        # LangChain counts text tokens; reserve the encoder's special tokens.
        budget = model.max_seq_length - model.tokenizer.num_special_tokens_to_add(pair=False)
        if budget < 1:
            raise APIError(503, "invalid_embedding_model", "The embedding model has no usable text capacity.")
        splitter = RecursiveCharacterTextSplitter.from_huggingface_tokenizer(
            model.tokenizer, chunk_size=budget, chunk_overlap=0,
            keep_separator=True, strip_whitespace=False,
        )
        spans = []
        cursor = 0
        for raw in splitter.split_text(text):
            raw_start = text.find(raw, cursor)
            if raw_start < 0 or text[cursor:raw_start].strip():
                raise APIError(500, "embedding_chunking_failed", "The split passages could not be verified against the source.")
            cursor = raw_start + len(raw)
            part = raw.strip()
            if not part:
                continue
            start = raw_start + len(raw) - len(raw.lstrip())
            end = start + len(part)
            if self._token_count(model, part) > model.max_seq_length:
                raise APIError(422, "embedding_input_too_long", "A split passage exceeds the embedding model's token limit.")
            spans.append((start, end))
            if len(spans) > MAX_PDF_PREPARED_CHUNKS:
                raise APIError(422, "pdf_chunk_limit_exceeded", "The PDF produces too many passages to process.")
        if text[cursor:].strip():
            raise APIError(500, "embedding_chunking_failed", "The split passages could not be verified against the source.")
        return spans

    def _embed_prepared(self, prepared: PreparedPdf) -> tuple[EmbeddedChunk, ...]:
        with self._lock:
            model = self._load_model()
            passages = []
            for chunk in prepared.chunks:
                for start, end in self._fit_spans(chunk.passage.text, model):
                    text = chunk.passage.text[start:end]
                    citation = chunk.passage.citation
                    if start != 0 or end != len(chunk.passage.text):
                        identity = json.dumps([citation.chunk_id, self.model_id, PDF_TOKEN_SPLITTING_VERSION,
                                               version("langchain-text-splitters"), start, end, text], ensure_ascii=True)
                        citation = citation.model_copy(update={"chunk_id": "token-" + sha256(identity.encode()).hexdigest()})
                    passages.append(chunk.passage.model_copy(update={"citation": citation, "text": text}))
                    if len(passages) > MAX_PDF_PREPARED_CHUNKS:
                        raise APIError(422, "pdf_chunk_limit_exceeded", "The PDF produces too many passages to process.")
            vectors = self._encode([passage.text for passage in passages])
            return tuple(EmbeddedChunk(passage=passage, embedding_model=self.model_id, embedding=vector)
                         for passage, vector in zip(passages, vectors, strict=True))

    async def embed_prepared_pdf(self, prepared: PreparedPdf, *, context: ExecutionContext) -> tuple[EmbeddedChunk, ...]:
        """Fit PDF chunks to the model, preserving their source/version/page cites."""
        if (prepared.user_id != context.user_id or prepared.snapshot.source not in context.scope.sources
                or any(chunk.user_id != context.user_id or chunk.passage.citation.source != prepared.snapshot.source
                       for chunk in prepared.chunks)):
            raise APIError(403, "source_outside_scope", "This document version is not authorized for this operation.")
        try:
            return await asyncio.to_thread(self._embed_prepared, prepared)
        except APIError:
            raise
        except Exception:
            raise APIError(503, "embedding_unavailable", "Local embeddings are temporarily unavailable.") from None
