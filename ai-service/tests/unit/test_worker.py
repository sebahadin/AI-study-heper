"""Worker protocol and recovery tests; no provider calls or application DB writes."""
import asyncio
from hashlib import sha256
from uuid import uuid4
import httpx
import pytest
from app.core.errors import APIError
from app.core.worker_config import WorkerSettings
from app.integrations.classmate_client import ClassmateClient
from app.rag.ingestion.notes import prepare_note
from app.schemas.worker import ClaimedJob
from app.schemas.evidence import EmbeddedChunk
from app.workers.documents import DocumentIngestionWorker, manifest_digest
from app.workers.outbox import Outbox

pytestmark = pytest.mark.anyio
@pytest.fixture
def anyio_backend(): return 'asyncio'

def settings(**values):
    return WorkerSettings(_env_file=None, service_token='x' * 40, worker_poll_seconds=.001, **values)

def claim():
    ref = dict(source_id='note-1', source_type='note', source_version='v1', index_generation=str(uuid4()))
    text = 'Cells\n\nMitochondria supply ATP.'
    return ClaimedJob.model_validate(dict(
        job=dict(job_id=str(uuid4()), document_id='note-1', source_version='v1', storage_key='notes/owner/note-1', source_type='note', limits=dict(max_pages=1, max_bytes=len(text.encode()))),
        context=dict(user_id='owner', run_id='run', scope=dict(scope_id='scope', sources=[ref])),
        snapshot=dict(source=ref, sha256=sha256(text.encode()).hexdigest()), lease=dict(token=str(uuid4()), expires_at='2030-01-01T00:00:00Z'), attempt=1, max_attempts=3,
    ))

class Embeddings:
    model_id = 'test-model'
    async def embed_prepared_source(self, prepared, *, context):
        return tuple(EmbeddedChunk(passage=c.passage, embedding_model=self.model_id, embedding=(1., 0., 0.)) for c in prepared.chunks)

class Index:
    index_version = 'test-index'
    def __init__(self): self.chunks = []
    async def upsert_chunks(self, chunks, *, context): self.chunks.extend(chunks); return len(chunks)

class Client:
    def __init__(self): self.calls = []; self.offline = False; self.applied = 0
    async def request(self, path, body):
        self.calls.append((path, body))
        if path.endswith('/source'): return {'text': 'Cells\n\nMitochondria supply ATP.'}
        if path.endswith('/complete'):
            if self.offline: raise APIError(503, 'classmate_unavailable', 'Unavailable')
            self.applied += 1
            return {'disposition': 'applied'}
        return {}

def worker(tmp_path, client=None, **config):
    return DocumentIngestionWorker(settings(**config), client or Client(), Embeddings(), Index(), Outbox(tmp_path/'outbox.sqlite'))

async def test_note_preparation_preserves_unicode_code_and_paragraphs():
    c = claim()
    text = 'Title\n\né = 10\nprint(é)\n\n' + 'A long passage. ' * 200
    p = prepare_note(text, source=c.snapshot.source, digest=sha256(text.encode()).hexdigest(), context=c.context)
    assert ''.join(''.join(x.passage.text.split()) for x in p.chunks) == ''.join(text.split())
    assert all(x.passage.citation.page_start is None for x in p.chunks)
    assert len({x.passage.citation.chunk_id for x in p.chunks}) == len(p.chunks)
    with pytest.raises(APIError): prepare_note(text, source=c.snapshot.source, digest='a'*64, context=c.context)

async def test_worker_verifies_index_before_reporting_and_keeps_service_fields(tmp_path):
    w = worker(tmp_path); c = claim()
    await w.process(c)
    done = [body for path, body in w.client.calls if path.endswith('/complete')]
    assert len(done) == 1 and done[0]['report']['indexed_chunks'] == 2
    assert done[0]['manifest_digest'] == manifest_digest(done[0]['passages'])
    assert done[0]['generation_id'] == c.snapshot.source.index_generation
    assert w.outbox.entries() == []
    assert len(w.index.chunks) == 2

async def test_callback_outage_persists_across_worker_restart_and_never_reports_failure(tmp_path):
    client = Client(); client.offline = True
    w = worker(tmp_path, client, worker_job_timeout_seconds=.03)
    await w.process(claim())
    assert len(w.outbox.entries()) == 1
    assert not any(path.endswith('/fail') for path, _ in client.calls)
    replacement = worker(tmp_path, Client())
    await replacement.deliver()
    assert replacement.client.applied == 1 and replacement.outbox.entries() == []

async def test_duplicate_and_stale_acknowledgements_remove_only_their_generation(tmp_path):
    w = worker(tmp_path)
    for gen in ('old', 'new'): w.outbox.put(gen, 'job', {'generation_id': gen})
    async def request(path, body): return {'disposition': 'stale' if body['generation_id'] == 'old' else 'duplicate'}
    w.client.request = request
    await w.deliver()
    assert w.outbox.entries() == []

async def test_invalid_callback_does_not_block_subsequent_outbox_deliveries(tmp_path):
    w = worker(tmp_path)
    for gen in ('bad', 'good'): w.outbox.put(gen, 'job', {'generation_id': gen})
    async def request(path, body):
        if body['generation_id'] == 'bad': raise APIError(422, 'classmate_request_rejected', 'Rejected')
        return {'disposition': 'applied'}
    w.client.request = request
    await w.deliver()
    assert w.outbox.entries() == []

async def test_index_failure_reports_safe_retryable_code_and_never_ready(tmp_path):
    w = worker(tmp_path)
    async def fail(*args, **kwargs): raise APIError(503, 'index_unavailable', 'Private details')
    w.index.upsert_chunks = fail
    await w.process(claim())
    failures = [body for path, body in w.client.calls if path.endswith('/fail')]
    assert failures[0]['error_code'] == 'index_unavailable' and failures[0]['retryable'] is True
    assert not any(path.endswith('/complete') for path, _ in w.client.calls)

async def test_maintenance_outage_does_not_block_a_healthy_job(tmp_path):
    w = worker(tmp_path)
    async def maintenance(): raise ConnectionError('private details')
    w.maintenance = maintenance
    c = claim()
    original = w.client.request
    async def request(path, body): return c.model_dump(mode='json') if path == '/claim' else await original(path, body)
    w.client.request = request
    await w.run(once=True)
    assert w.client.applied == 1

async def test_http_client_authenticates_only_express_and_hides_errors():
    seen = []
    async def transport(request):
        seen.append(request)
        return httpx.Response(422, json={'private': 'secret'})
    client = ClassmateClient(settings(), transport=httpx.MockTransport(transport))
    try:
        with pytest.raises(APIError) as e: await client.request('/claim', {})
        assert e.value.status_code == 422 and 'secret' not in str(e.value)
        assert seen[0].headers['authorization'] == 'Bearer ' + 'x'*40
    finally: await client.close()

@pytest.mark.parametrize('url', ['http://169.254.169.254/latest', 'https://example.com/file.pdf', 'http://127.0.0.1/file.pdf', 'https://user:secret@'+'a'*32+'.r2.cloudflarestorage.com/file'])
async def test_download_rejects_untrusted_endpoints_before_any_request(url):
    client = ClassmateClient(settings())
    try:
        with pytest.raises(APIError) as e: await client.download_pdf(url, expected_bytes=1, digest='a'*64)
        assert e.value.code == 'source_unavailable'
    finally: await client.close()

async def test_download_has_no_bearer_bounds_bytes_and_checks_digest():
    data = b'%PDF fixture'
    client = ClassmateClient(settings())
    async def transport(request):
        assert 'authorization' not in request.headers
        return httpx.Response(200, content=data)
    await client.downloads.aclose()
    client.downloads = httpx.AsyncClient(transport=httpx.MockTransport(transport))
    url = 'https://' + 'a'*32 + '.r2.cloudflarestorage.com/key?signature=test'
    try:
        assert await client.download_pdf(url, expected_bytes=len(data), digest=sha256(data).hexdigest()) == data
        for count, digest in [(len(data)-1, sha256(data).hexdigest()), (len(data)+1, sha256(data).hexdigest()), (len(data), 'b'*64)]:
            with pytest.raises(APIError) as e: await client.download_pdf(url, expected_bytes=count, digest=digest)
            assert e.value.code == 'source_snapshot_mismatch'
    finally: await client.close()
