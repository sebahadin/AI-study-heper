"""Authorization and canonical evidence tests; no provider calls or application writes."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from app.api import retrieval as api
from app.core.config import Settings
from app.core.errors import APIError
from app.main import create_app
from app.rag.retrieval.service import EvidenceRetriever
from app.schemas.context import AuthorizedScope, ExecutionContext, SourceReference, StudySelection
from app.schemas.evidence import Citation, EvidenceBundle, Passage
from app.tools.materials import create_material_tools

pytestmark = pytest.mark.anyio
TOKEN = 'retrieval-test-' + 'x' * 40
AUTH = {'Authorization': 'Bearer ' + TOKEN}
@pytest.fixture
def anyio_backend(): return 'asyncio'

def context(*, selection=None, sources=None):
    ref = SourceReference(source_id='a'*24, source_type='note', source_version='v1', index_generation='generation-1')
    return ExecutionContext(user_id='b'*24, run_id='run', scope=AuthorizedScope(scope_id='scope', selection=selection, sources=tuple(sources) if sources is not None else (ref,)))

def passage(ref=None, chunk='a', text='Mitochondria supply ATP.', locator='paragraph 2'):
    return Passage(text=text, citation=Citation(chunk_id='note-' + chunk*64, source=ref or context().scope.sources[0], locator=locator))

class Fixture:
    def __init__(self, ctx=None, passages=None):
        self.context = ctx or context()
        self.passages = list(passages) if passages is not None else [passage()]
        self.gateway = SimpleNamespace(resolve_context=AsyncMock(return_value=self.context), fetch_current_passages=AsyncMock(return_value=tuple(self.passages)))
        self.model = SimpleNamespace(embed=AsyncMock(return_value=((1., 0., 0.),)))
        self.index = SimpleNamespace(search=AsyncMock(return_value=tuple(p.citation for p in self.passages)))
        self.retriever = EvidenceRetriever(embeddings=self.model, index=lambda vector: self.index, classmate=self.gateway)

async def test_ranks_candidates_but_returns_only_current_canonical_text():
    f = Fixture()
    result = await f.retriever.retrieve('What supplies ATP?', context=f.context)
    assert result.passages == tuple(f.passages)
    f.model.embed.assert_awaited_once_with(['What supplies ATP?'])
    assert f.index.search.await_args.kwargs['limit'] == 18
    assert f.gateway.fetch_current_passages.await_args.args[0] == (f.passages[0].citation.chunk_id,)

async def test_empty_scope_does_not_load_model_query_chroma_or_call_express():
    f = Fixture(context(sources=[]))
    assert (await f.retriever.retrieve('Question?', context=f.context)).passages == ()
    f.gateway.resolve_context.assert_not_awaited(); f.model.embed.assert_not_awaited(); f.index.search.assert_not_awaited()

async def test_explicit_library_scope_refreshes_before_search_even_if_previous_sources_were_empty():
    f = Fixture()
    original = context(selection=StudySelection(library=True), sources=[])
    current = f.context.model_copy(update={'scope': f.context.scope.model_copy(update={'selection': original.scope.selection})})
    f.gateway.resolve_context.return_value = current
    assert (await f.retriever.retrieve('Question?', context=original)).passages

async def test_revoked_scope_stops_before_embedding_and_never_falls_back_to_library():
    f = Fixture(); f.gateway.resolve_context.return_value = context(sources=[])
    assert (await f.retriever.retrieve('Question?', context=f.context)).passages == ()
    f.model.embed.assert_not_awaited(); f.index.search.assert_not_awaited()

@pytest.mark.parametrize('change', ['identity', 'scope', 'source'])
async def test_unexpected_context_broadening_is_rejected(change):
    f = Fixture(); current = f.context
    if change == 'identity': current = current.model_copy(update={'user_id': 'c'*24})
    elif change == 'scope': current = current.model_copy(update={'scope': current.scope.model_copy(update={'scope_id': 'other'})})
    else: current = current.model_copy(update={'scope': current.scope.model_copy(update={'sources': (current.scope.sources[0].model_copy(update={'source_version': 'v2'}),)})})
    f.gateway.resolve_context.return_value = current
    with pytest.raises(APIError) as e: await f.retriever.retrieve('Question?', context=f.context)
    assert e.value.code == 'invalid_scope_response'; f.model.embed.assert_not_awaited()

async def test_stale_deleted_forged_and_unrequested_passages_cannot_become_evidence():
    f = Fixture()
    stale = f.context.scope.sources[0].model_copy(update={'source_version': 'old'})
    f.gateway.fetch_current_passages.return_value = (passage(stale), passage(chunk='b'), passage(locator='invented locator'))
    assert (await f.retriever.retrieve('Question?', context=f.context)).passages == ()
    f.gateway.fetch_current_passages.return_value = ()
    assert (await f.retriever.retrieve('Question?', context=f.context)).passages == ()

async def test_budget_and_count_keep_whole_canonical_passages_in_candidate_order():
    rows = [passage(chunk=letter, text=letter * 5000) for letter in 'abcd']
    f = Fixture(passages=rows)
    f.gateway.fetch_current_passages.return_value = tuple(reversed(rows))
    result = await f.retriever.retrieve('Question?', context=f.context, limit=4)
    assert result.passages == tuple(rows[:2])
    f.gateway.fetch_current_passages.return_value = tuple(rows)
    result = await f.retriever.retrieve('Question?', context=f.context, limit=1)
    assert len(result.passages) == 1

async def test_duplicate_candidates_are_fetched_once_and_foreign_candidates_are_ignored():
    f = Fixture(); ref = f.context.scope.sources[0].model_copy(update={'source_id': 'd'*24})
    f.index.search.return_value = (f.passages[0].citation, f.passages[0].citation, passage(ref, chunk='b').citation)
    result = await f.retriever.retrieve('Question?', context=f.context)
    assert len(result.passages) == 1
    assert len(f.gateway.fetch_current_passages.await_args.args[0]) == 1

async def test_scope_disappearing_during_retrieval_returns_empty_evidence_but_outages_remain_errors():
    f = Fixture(); f.gateway.fetch_current_passages.side_effect = APIError(409, 'scope_changed', 'Changed')
    assert (await f.retriever.retrieve('Question?', context=f.context)).passages == ()
    f.gateway.fetch_current_passages.side_effect = APIError(503, 'classmate_unavailable', 'Unavailable')
    with pytest.raises(APIError): await f.retriever.retrieve('Question?', context=f.context)

async def test_fetch_tool_checks_current_scope_and_deduplicates_requested_ids():
    f = Fixture(); ids = (f.passages[0].citation.chunk_id,) * 2
    result = await f.retriever.fetch(ids, context=f.context)
    assert result == tuple(f.passages)
    assert f.gateway.resolve_context.await_count == 1

async def test_langchain_tools_hide_context_and_reject_identity_or_scope_arguments():
    f = Fixture(); search, fetch = create_material_tools(retriever=f.retriever, context=f.context)
    assert set(search.args) == {'query', 'limit'}; assert set(fetch.args) == {'chunk_ids'}
    for override in ({'user_id': 'c'*24}, {'context': {}}, {'scope': {'library': True}}):
        with pytest.raises(ValidationError): await search.ainvoke({'query': 'Question?', **override})
    assert (await search.ainvoke({'query': 'Question?'}))['passages']
    assert await fetch.ainvoke({'chunk_ids': [f.passages[0].citation.chunk_id]})

@pytest.mark.parametrize('value', [{'library': True, 'notes': ['a'*24]}, {'notes': ['not-an-id']}, {'user_id': 'a'*24}, {'library': 'true'}, {'notes': ['a'*24]*21}])
async def test_invalid_or_ambiguous_selections_fail_schema_validation(value):
    with pytest.raises(ValidationError): StudySelection.model_validate(value)

async def test_retrieval_http_auth_precedes_parsing_and_no_private_body_is_echoed(monkeypatch):
    app = create_app(Settings(_env_file=None, service_token=TOKEN))
    f = Fixture(); runtime = SimpleNamespace(retriever=f.retriever, capacity=asyncio.Semaphore(2))
    monkeypatch.setattr(api, 'get_retrieval_runtime', lambda request: runtime)
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        for path in ('/internal/retrieval/search',):
            response = await client.post(path, content='{private-invalid', headers={'Content-Type': 'application/json'})
            assert response.status_code == 401 and 'private' not in response.text
            response = await client.post(path, content='x'*(128*1024+1), headers={**AUTH,'Content-Type':'application/json'})
            assert response.status_code == 413
        body = dict(query='Question?', context=f.context.model_dump(mode='json'))
        response = await client.post('/internal/retrieval/search', json=body, headers=AUTH)
        assert response.status_code == 200 and response.json()['passages']
        for extra in ({'user_id': 'forged'}, {'limit': 13}, {'query': 'private-'*1000}):
            response = await client.post('/internal/retrieval/search', json={**body, **extra}, headers=AUTH)
            assert response.status_code == 422 and 'private-' not in response.text
        await runtime.capacity.acquire(); await runtime.capacity.acquire()
        response = await client.post('/internal/retrieval/search', json=body, headers=AUTH)
        assert response.status_code == 503
        assert response.headers['cache-control'] == 'no-store'
