"""Current authorization + local similarity search + canonical MongoDB evidence.

Chroma provides candidate references. Only Express's current canonical passages
may leave this boundary; vector-store document text is never used as evidence.
"""
from app.core.errors import APIError
from app.schemas.context import ExecutionContext
from app.schemas.evidence import EvidenceBundle, Passage
from app.schemas.tools import FetchPassagesArguments, SearchMaterialsArguments

MAX_EVIDENCE_CHARACTERS = 12000
MAX_CANDIDATES = 36


class EvidenceRetriever:
    def __init__(self, *, embeddings, index, classmate):
        self.embeddings, self.index, self.classmate = embeddings, index, classmate

    async def _current_context(self, context: ExecutionContext) -> ExecutionContext:
        current = await self.classmate.resolve_context(context)
        if (current.user_id != context.user_id or current.run_id != context.run_id
                or current.scope.scope_id != context.scope.scope_id or current.scope.selection != context.scope.selection
                or current.conversation_id != context.conversation_id or current.proposal_id != context.proposal_id
                or current.scope.selection is None and any(ref not in context.scope.sources for ref in current.scope.sources)):
            raise APIError(503, 'invalid_scope_response', 'The authorized study scope could not be verified.')
        return current

    async def _canonical(self, ids, *, context, candidates=None) -> tuple[Passage, ...]:
        rows = await self.classmate.fetch_current_passages(ids, context=context)
        seen, result = set(), []
        for passage in rows:
            citation = passage.citation
            if (citation.chunk_id not in ids or citation.chunk_id in seen or citation.source not in context.scope.sources
                    or candidates is not None and citation not in candidates):
                continue
            seen.add(citation.chunk_id)
            result.append(passage)
        by_id = {p.citation.chunk_id: p for p in result}
        return tuple(by_id[key] for key in dict.fromkeys(ids) if key in by_id)

    async def retrieve(self, query: str, *, context: ExecutionContext, limit: int = 6) -> EvidenceBundle:
        arguments = SearchMaterialsArguments(query=query, limit=limit)
        if not context.scope.sources and context.scope.selection is None:
            return EvidenceBundle(query=arguments.query)
        try:
            current = await self._current_context(context)
            if not current.scope.sources:
                return EvidenceBundle(query=arguments.query)
            vector = (await self.embeddings.embed([arguments.query]))[0]
            index = self.index(vector)
            candidates = await index.search(vector, context=current, limit=min(MAX_CANDIDATES, limit * 3))
            candidates = tuple(c for c in candidates if c.source in current.scope.sources and c.source.index_generation)
            ids = tuple(dict.fromkeys(c.chunk_id for c in candidates))
            if not ids:
                return EvidenceBundle(query=arguments.query)
            refs = tuple(dict.fromkeys(c.source for c in candidates))
            fetch_context = current.model_copy(update={'scope': current.scope.model_copy(update={'sources': refs})})
            canonical = await self._canonical(ids, context=fetch_context, candidates=candidates)
            passages, characters = [], 0
            for passage in canonical:
                if len(passages) >= limit:
                    break
                if characters + len(passage.text) > MAX_EVIDENCE_CHARACTERS:
                    continue
                characters += len(passage.text)
                passages.append(passage)
            return EvidenceBundle(query=arguments.query, passages=tuple(passages))
        except APIError as error:
            if error.code == 'scope_changed':
                return EvidenceBundle(query=arguments.query)
            raise

    async def overview(self, *, context):
        current=await self._current_context(context)
        if not current.scope.sources:return ()
        rows=await self.classmate.fetch_overview(context=current)
        rows=tuple(p for p in rows if p.citation.source in current.scope.sources)
        return await self._canonical([p.citation.chunk_id for p in rows],context=current,candidates=tuple(p.citation for p in rows)) if rows else ()

    async def fetch(self, chunk_ids, *, context: ExecutionContext) -> tuple[Passage, ...]:
        arguments = FetchPassagesArguments(chunk_ids=tuple(chunk_ids))
        if not context.scope.sources and context.scope.selection is None:
            return ()
        try:
            current = await self._current_context(context)
            if not current.scope.sources:
                return ()
            passages = await self._canonical(arguments.chunk_ids, context=current)
            result, characters = [], 0
            for passage in passages:
                if characters + len(passage.text) <= MAX_EVIDENCE_CHARACTERS:
                    result.append(passage); characters += len(passage.text)
            return tuple(result)
        except APIError as error:
            if error.code == 'scope_changed':
                return ()
            raise


async def retrieve_evidence(query: str, *, context: ExecutionContext, retriever: EvidenceRetriever, limit: int = 6) -> EvidenceBundle:
    return await retriever.retrieve(query, context=context, limit=limit)
