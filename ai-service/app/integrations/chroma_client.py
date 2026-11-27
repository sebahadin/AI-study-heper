"""Private, model-bound local Chroma index; MongoDB remains authoritative."""

import asyncio
from collections.abc import Sequence
from hashlib import sha256
import json
from math import isclose, isfinite
from pathlib import Path
from threading import RLock

from app.core.constants import MAX_PDF_PREPARED_CHUNKS
from app.core.errors import APIError
from app.schemas.context import ExecutionContext
from app.schemas.evidence import Citation, EmbeddedChunk

INDEX_SCHEMA_VERSION = "study-vectors-v1"
WRITE_BATCH_SIZE = 100
MAX_SEARCH_RESULTS = 50


class ChromaIndex:
    def __init__(self, *, path: Path | None = None, embedding_model: str, dimension: int, host: str | None = None, port: int = 8002, ssl: bool = False, token: str | None = None):
        if not isinstance(embedding_model, str) or not embedding_model or not isinstance(dimension, int) or isinstance(dimension, bool) or dimension < 1:
            raise ValueError("Specify the embedding model and its vector dimension.")
        self.path, self.embedding_model, self.dimension = Path(path) if path else None, embedding_model, dimension
        self.host, self.port, self.ssl, self.token = host, port, ssl, token
        self._client = None
        self._gc_offsets = {}
        self.index_version = INDEX_SCHEMA_VERSION + "-" + sha256(embedding_model.encode()).hexdigest()[:24]
        self.collection_name = "classmate-" + self.index_version
        self._collection = None
        self._lock = RLock()

    def _get_collection(self):
        if self._collection is None:
            import chromadb
            from chromadb.config import Settings

            client = chromadb.HttpClient(host=self.host, port=self.port, ssl=self.ssl,
                headers={"Authorization": f"Bearer {self.token}"} if self.token else None,
                settings=Settings(anonymized_telemetry=False)) if self.host else chromadb.PersistentClient(
                    path=str(self.path), settings=Settings(anonymized_telemetry=False))
            self._client = client
            metadata = {"embedding_model": self.embedding_model, "dimension": self.dimension, "index_version": self.index_version}
            collection = client.get_or_create_collection(
                self.collection_name, embedding_function=None, metadata=metadata,
                configuration={"hnsw": {"space": "cosine"}},
            )
            if collection.metadata != metadata or collection.configuration_json["hnsw"]["space"] != "cosine":
                raise APIError(409, "index_model_mismatch", "This index uses a different embedding configuration.")
            self._collection = collection
        return self._collection

    def _vector(self, vector):
        try:
            result = [float(value) for value in vector]
        except (ValueError, TypeError, OverflowError):
            raise APIError(422, "invalid_index_vector", "Provide a finite vector with the configured dimension.") from None
        if len(result) != self.dimension or not all(isfinite(value) for value in result) or not any(result):
            raise APIError(422, "invalid_index_vector", "Provide a finite vector with the configured dimension.")
        return result

    def _record(self, chunk: EmbeddedChunk, context: ExecutionContext):
        citation = chunk.passage.citation
        if citation.source not in context.scope.sources:
            raise APIError(403, "source_outside_scope", "This source version is not authorized for this operation.")
        if chunk.embedding_model != self.embedding_model:
            raise APIError(409, "index_model_mismatch", "Use the same embedding model for indexing and search.")
        identity = json.dumps([context.user_id, citation.source.source_type, citation.source.source_id,
                               citation.source.source_version, citation.source.index_generation or "legacy", citation.chunk_id], ensure_ascii=True)
        record_id = "vector-" + sha256(identity.encode()).hexdigest()
        metadata = {
            "user_id": context.user_id, "source_id": citation.source.source_id,
            "source_type": citation.source.source_type, "source_version": citation.source.source_version,
            "embedding_model": self.embedding_model, "index_version": self.index_version,
            "citation": citation.model_dump_json(), "generation_id": citation.source.index_generation or "legacy",
        }
        return record_id, metadata, self._vector(chunk.embedding)

    def _upsert(self, records, chunks):
        with self._lock:
            collection = self._get_collection()
            for start in range(0, len(chunks), WRITE_BATCH_SIZE):
                batch = records[start:start + WRITE_BATCH_SIZE]
                documents = [chunk.passage.text for chunk in chunks[start:start + WRITE_BATCH_SIZE]]
                collection.upsert(ids=[row[0] for row in batch], metadatas=[row[1] for row in batch],
                                  embeddings=[row[2] for row in batch], documents=documents)
                stored = collection.get(ids=[row[0] for row in batch], include=["documents", "metadatas", "embeddings"])
                actual = {key: index for index, key in enumerate(stored["ids"])}
                if set(actual) != {row[0] for row in batch}:
                    raise APIError(503, "index_incomplete", "Not every expected passage was stored.")
                for (key, metadata, vector), text in zip(batch, documents, strict=True):
                    offset = actual[key]
                    saved_vector = stored["embeddings"][offset]
                    if (stored["documents"][offset] != text or stored["metadatas"][offset] != metadata
                            or len(saved_vector) != self.dimension
                            or not all(isclose(expected, float(saved), rel_tol=1e-5, abs_tol=1e-6)
                                       for expected, saved in zip(vector, saved_vector, strict=True))):
                        raise APIError(503, "index_incomplete", "The stored passages could not be verified.")
            return len(chunks)

    async def upsert_chunks(self, chunks: Sequence[EmbeddedChunk], *, context: ExecutionContext) -> int:
        """Validate the whole batch before writing; return only a verified count.

        A failed/partial write never becomes an application-ready record. The
        worker controls readiness through authenticated Express reports.
        Deterministic physical IDs also prevent cross-user ID collisions.
        """
        chunks = tuple(chunks)
        if not chunks or len(chunks) > MAX_PDF_PREPARED_CHUNKS:
            raise APIError(422, "invalid_index_batch", "Provide a bounded, nonempty set of passages.")
        records = [self._record(chunk, context) for chunk in chunks]
        if len({row[0] for row in records}) != len(records):
            raise APIError(422, "duplicate_chunk_ids", "Each source passage must have a distinct ID.")
        try:
            return await asyncio.to_thread(self._upsert, records, chunks)
        except APIError:
            raise
        except Exception:
            raise APIError(503, "index_unavailable", "The local retrieval index is temporarily unavailable.") from None

    def _search(self, vector, context, limit):
        sources = [{"$and": [{"source_id": source.source_id}, {"source_type": source.source_type},
                             {"source_version": source.source_version},
                             *([{"generation_id": source.index_generation}] if source.index_generation else [])]}
                   for source in context.scope.sources]
        source_filter = sources[0] if len(sources) == 1 else {"$or": sources}
        where = {"$and": [{"user_id": context.user_id}, {"embedding_model": self.embedding_model},
                          {"index_version": self.index_version}, source_filter]}
        with self._lock:
            result = self._get_collection().query(query_embeddings=[vector], where=where, n_results=limit,
                                                  include=["metadatas", "distances"])
        citations = []
        for metadata in result["metadatas"][0]:
            citation = Citation.model_validate_json(metadata["citation"])
            source = next((source for source in context.scope.sources
                           if (source.source_id, source.source_type, source.source_version)
                           == (citation.source.source_id, citation.source.source_type, citation.source.source_version)), None)
            if (metadata["user_id"] != context.user_id or source is None
                    or metadata["source_id"] != source.source_id or metadata["source_type"] != source.source_type
                    or metadata["source_version"] != source.source_version
                    or (source.index_generation and metadata.get("generation_id") != source.index_generation)):
                raise APIError(503, "invalid_index_candidate", "A retrieval candidate could not be verified.")
            citations.append(citation.model_copy(update={"source": source}))
        return tuple(citations)

    async def search(self, query_embedding: Sequence[float], *, context: ExecutionContext, limit: int) -> tuple[Citation, ...]:
        """Return candidate references only, with owner AND exact source versions.

        Express must resolve only ready sources and revalidate canonical
        passages before any retrieved content enters an LLM context.
        """
        if not context.scope.sources:
            return ()
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= MAX_SEARCH_RESULTS:
            raise APIError(422, "invalid_search_limit", "Choose a supported search result limit.")
        vector = self._vector(query_embedding)
        try:
            return await asyncio.to_thread(self._search, vector, context, limit)
        except APIError:
            raise
        except Exception:
            raise APIError(503, "index_unavailable", "The local retrieval index is temporarily unavailable.") from None

    @classmethod
    def shared(cls, settings, embedding_model: str, dimension: int):
        return cls(embedding_model=embedding_model, dimension=dimension, host=settings.chroma_host,
                   port=settings.chroma_port, ssl=settings.chroma_ssl,
                   token=settings.chroma_token.get_secret_value() if settings.chroma_token else None)

    async def audit_source(self, source: dict) -> bool:
        """Check the published manifest against a bounded read of shared Chroma."""
        def check():
            with self._lock:
                rows = self._get_collection().get(where={"$and": [
                    {"user_id": source["user_id"]}, {"source_id": source["source_id"]},
                    {"source_type": source["source_type"]}, {"source_version": source["source_version"]},
                    {"generation_id": source["generation_id"]}, {"embedding_model": self.embedding_model},
                ]}, limit=MAX_PDF_PREPARED_CHUNKS + 1, include=["documents", "metadatas"])
            found = {}
            try:
                for metadata, text in zip(rows["metadatas"], rows["documents"], strict=True):
                    citation = Citation.model_validate_json(metadata["citation"])
                    ref = citation.source
                    if (ref.source_id != source["source_id"] or ref.source_type != source["source_type"]
                            or ref.source_version != source["source_version"] or ref.index_generation != source["generation_id"]
                            or citation.chunk_id in found):
                        return False
                    found[citation.chunk_id] = [citation.chunk_id, text, citation.locator, citation.page_start, citation.page_end]
                if not source["chunk_ids"] or set(found) != set(source["chunk_ids"]):
                    return False
                encoded = json.dumps([found[key] for key in source["chunk_ids"]], ensure_ascii=False, separators=(',', ':')).encode()
                return sha256(encoded).hexdigest() == source["manifest_digest"]
            except (KeyError, ValueError, TypeError):
                return False
        try:
            return await asyncio.to_thread(check)
        except APIError:
            raise
        except Exception:
            # An unavailable server is not proof of lost data.
            raise APIError(503, "index_unavailable", "The local retrieval index is temporarily unavailable.") from None

    async def delete_source(self, source_id: str, source_type: str, user_id: str):
        def remove():
            self._get_collection()
            for collection in self._client.list_collections():
                if not collection.name.startswith("classmate-study-vectors-"):
                    continue
                handle = self._client.get_collection(collection.name, embedding_function=None)
                handle.delete(where={"$and": [{"user_id": user_id}, {"source_id": source_id}, {"source_type": source_type}]})
        await asyncio.to_thread(remove)

    async def reconcile(self, classmate, *, limit: int = 1000):
        await asyncio.to_thread(self._get_collection)
        removed = 0
        for collection in await asyncio.to_thread(self._client.list_collections):
            if not collection.name.startswith("classmate-study-vectors-"):
                continue
            handle = await asyncio.to_thread(self._client.get_collection, collection.name, embedding_function=None)
            offset = self._gc_offsets.get(collection.name, 0)
            inspected = 0
            while inspected < limit:
                rows = await asyncio.to_thread(handle.get, limit=100, offset=offset, include=["metadatas"])
                if not rows["ids"]:
                    offset = 0
                    break
                records = [{key: meta.get(key) for key in ["user_id", "source_id", "source_type", "source_version", "generation_id", "embedding_model"]}
                           for meta in rows["metadatas"]]
                stale = (await classmate.request("/reconcile", {"records": records}))["stale"]
                ids = [rows["ids"][number] for number in stale]
                if ids:
                    await asyncio.to_thread(handle.delete, ids=ids)
                    removed += len(ids)
                inspected += len(rows["ids"])
                offset += len(rows["ids"]) - len(ids)
                if len(rows["ids"]) < 100:
                    offset = 0
                    break
            self._gc_offsets[collection.name] = offset
        return removed
