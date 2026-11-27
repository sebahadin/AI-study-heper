"""Real Express/Passport/Mongo, Python worker, local HF and shared HTTP Chroma.

Run explicitly: uv run --locked pytest tests/integration/test_worker_live.py
Requires local MongoDB and the cached model. No application database is used.
Set AI_LIVE_R2_TEST=1 only to additionally exercise your configured private R2.
"""
import asyncio
from io import BytesIO
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
import httpx
import pytest
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject
from app.core.retrieval_config import RetrievalSettings
from app.integrations.chroma_client import ChromaIndex
from app.providers.local_embeddings import LocalHuggingFaceEmbeddings
from app.schemas.context import ExecutionContext

ROOT = Path(__file__).resolve().parents[3]

def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); return sock.getsockname()[1]

def pdf(text=None, pages=1):
    writer = PdfWriter()
    for number in range(pages):
        page = writer.add_blank_page(width=500, height=500)
        if text and number == 0:
            page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): DictionaryObject({
                NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})})})
            stream = DecodedStreamObject(); stream.set_data(b'BT /F1 12 Tf 20 450 Td (' + text.encode('ascii') + b') Tj ET')
            page[NameObject('/Contents')] = writer._add_object(stream)
    output = BytesIO(); writer.write(output); return output.getvalue()

@pytest.fixture
def stack(tmp_path):
    api_port, chroma_port = port(), port()
    env = {**os.environ, 'NODE_ENV': 'test', 'TEST_DSN': 'mongodb://127.0.0.1:27017/classmate_indexing_'+secrets.token_hex(6)+'_test',
           'AI_SERVICE_TOKEN': secrets.token_urlsafe(32), 'AI_SERVICE_URL': f'http://127.0.0.1:{api_port}',
           'AI_CHROMA_HOST': '127.0.0.1', 'AI_CHROMA_PORT': str(chroma_port), 'AI_CHROMA_SSL': 'false',
           'AI_EMBEDDING_LOCAL_FILES_ONLY': 'true', 'AI_WORKER_OUTBOX_PATH': str(tmp_path/'outbox.sqlite'),
           'AI_WORKER_POLL_SECONDS': '.1', 'AI_WORKER_MAINTENANCE_SECONDS': '.5', 'AI_WORKER_HEARTBEAT_SECONDS': '.2',
           'AI_WORKER_ALLOW_LOCAL_DOWNLOADS': 'false' if os.getenv('AI_LIVE_R2_TEST') == '1' else 'true', 'ANONYMIZED_TELEMETRY': 'False'}
    processes, files = [], []
    node = None
    node_ready = False
    def start(args, cwd, name, listen=None, output=None):
        log = (tmp_path/(name+'.log')).open('w'); files.append(log)
        proc = subprocess.Popen(args, cwd=cwd, env=env, stdin=subprocess.PIPE, stdout=output if output is not None else log, stderr=log, text=True)
        processes.append(proc)
        if listen:
            deadline = time.monotonic()+30
            while time.monotonic() < deadline:
                if proc.poll() is not None: raise RuntimeError(name+' failed to start; inspect its private test log.')
                try:
                    with socket.create_connection(('127.0.0.1', listen), timeout=.1): break
                except OSError: time.sleep(.1)
            else: raise RuntimeError(name+' did not start.')
        return proc
    try:
        start([str(Path(sys.executable).with_name('chroma')), 'run', '--host', '127.0.0.1', '--port', str(chroma_port), '--path', str(tmp_path/'chroma')], ROOT/'ai-service', 'chroma', chroma_port)
        start([sys.executable, '-m', 'uvicorn', 'app.main:create_app', '--factory', '--host', '127.0.0.1', '--port', str(api_port), '--no-access-log'], ROOT/'ai-service', 'api', api_port)
        node = start(['node', 'test/fixtures/indexing-server.mjs'], ROOT/'backend', 'express', output=subprocess.PIPE)
        data = json.loads(node.stdout.readline()); node_ready = True; env['AI_CLASSMATE_URL'] = f"http://127.0.0.1:{data['port']}"
        def worker(): return start([sys.executable, '-m', 'app.workers.documents'], ROOT/'ai-service', 'worker')
        current = worker()
        yield dict(url=env['AI_CLASSMATE_URL'], chroma_port=chroma_port, token=env['AI_SERVICE_TOKEN'], worker=worker, process=current, node=node, env=env)
    finally:
        # Stop worker before Express drops the isolated database and cleans its source prefixes.
        for proc in reversed(processes):
            if proc.poll() is None:
                proc.terminate()
                try: proc.wait(timeout=25)
                except subprocess.TimeoutExpired: proc.kill(); proc.wait()
        for file in files: file.close()
        if node_ready and node.returncode != 0:
            raise RuntimeError('Isolated test cleanup failed; inspect its private Express test log.')


def test_automatic_upload_note_revision_restart_and_deletion(stack):
    with httpx.Client(base_url=stack['url'], timeout=30) as browser:
        result = browser.post('/api/auth/register', json={'username': 'indexing-student', 'email': 'indexing@example.test', 'password': 'test-password123', 'confirmPassword': 'test-password123'})
        assert result.status_code in (200, 201), result.status_code
        # Register need not log in automatically.
        assert browser.post('/api/auth/login', json={'username': 'indexing-student', 'password': 'test-password123'}).status_code == 200
        note = browser.post('/api/notes', json={'title': 'Cell notes', 'content': 'Mitochondria supply ATP to cells.'}).json()['note']
        def upload(data, name):
            started = browser.post('/api/documents/uploads', json={'filename': name, 'byteCount': len(data)}); assert started.status_code == 201
            intent = started.json()
            # Storage is a separate client, so no session or service credentials leak.
            result = httpx.put(intent['upload']['url'], headers=intent['upload']['headers'], content=data, timeout=30)
            assert result.status_code == 200
            return browser.post('/api/documents/'+intent['document']['_id']+'/complete', json={})
        uploaded = upload(pdf('Mitochondria convert nutrients into ATP, providing energy for cells.', pages=2), 'cells.pdf')
        assert uploaded.status_code == 200
        document = uploaded.json()['document']
        blank = upload(pdf(), 'blank.pdf').json()['document']
        assert upload(pdf(pages=6), 'six-pages.pdf').status_code == 422
        def wait(kind, id, status):
            deadline = time.monotonic()+90
            while time.monotonic() < deadline:
                response = browser.get(f'/api/{kind}/{id}/indexing')
                assert response.status_code == 200
                state = response.json()['indexing']
                if state['status'] == status: return state
                if state['status'] == 'failed' and status != 'failed': pytest.fail('Unexpected indexing failure: '+str(state.get('error', {}).get('code')))
                time.sleep(.15)
            pytest.fail('Indexing did not reach '+status)
        assert wait('documents', document['_id'], 'ready')['pagesWithoutText'] == [2]
        assert wait('documents', blank['_id'], 'failed')['error']['code'] == 'pdf_text_unavailable'
        wait('notes', note['_id'], 'ready')
        # Resolve canonical passages using candidates read from an independent HTTP Chroma client.
        settings = RetrievalSettings(_env_file=None, embedding_local_files_only=True)
        model = LocalHuggingFaceEmbeddings(settings)
        index = ChromaIndex(embedding_model=model.model_id, dimension=384, host='127.0.0.1', port=stack['chroma_port'])
        rows = index._get_collection().get(include=['metadatas'])
        citations = [json.loads(meta['citation']) for meta in rows['metadatas'] if meta['source_id'] == note['_id']]
        assert citations
        owner = next(meta['user_id'] for meta in rows['metadatas'] if meta['source_id'] == note['_id'])
        context = dict(user_id=owner, run_id='live-retrieval', scope=dict(scope_id='selected-note', sources=[citations[0]['source']]))
        headers = {'Authorization': 'Bearer '+stack['token']}
        payload = {'context': context, 'chunk_ids': [c['chunk_id'] for c in citations]}
        canonical = browser.post('/internal/document-jobs/passages', json=payload, headers=headers)
        assert canonical.status_code == 200 and canonical.json()['passages']
        query = asyncio.run(model.embed(['What supplies energy to cells?']))[0]
        assert asyncio.run(index.search(query, context=ExecutionContext.model_validate(context), limit=3))
        foreign = {**payload, 'context': {**context, 'user_id': '0'*24}}
        assert browser.post('/internal/document-jobs/passages', json=foreign, headers=headers).json()['passages'] == []
        # Losing Chroma data triggers an automatic rebuild from authoritative sources.
        handle = index._get_collection()
        original_generation = citations[0]['source']['index_generation']
        handle.delete(ids=handle.get()['ids'])
        deadline = time.monotonic()+45
        while time.monotonic() < deadline:
            rebuilt = handle.get(include=['metadatas'])
            if any(meta['source_id'] == note['_id'] and meta['generation_id'] != original_generation for meta in rebuilt['metadatas']):
                break
            time.sleep(.15)
        else: pytest.fail('Missing Chroma data was not rebuilt.')
        wait('notes', note['_id'], 'ready'); wait('documents', document['_id'], 'ready')
        assert browser.post('/internal/document-jobs/passages', json=payload, headers=headers).json()['passages'] == []
        # A stopped worker leaves a durable queue; a new process resumes it.
        stack['process'].terminate(); stack['process'].wait(timeout=10)
        assert browser.patch('/api/notes/'+note['_id'], json={'content': 'The nucleus contains DNA.'}).status_code == 200
        assert browser.get('/api/notes/'+note['_id']+'/indexing').json()['indexing']['status'] == 'queued'
        assert browser.post('/internal/document-jobs/passages', json=payload, headers=headers).json()['passages'] == []
        stack['worker'](); wait('notes', note['_id'], 'ready')
        assert browser.delete('/api/notes/'+note['_id']).status_code == 204
        assert browser.get('/api/notes/'+note['_id']).status_code == 404
        assert browser.delete('/api/documents/'+document['_id']).status_code == 204
        assert browser.get('/api/documents/'+document['_id']+'/file').status_code == 404
        stack['node'].stdin.write('expire-upload-links\n'); stack['node'].stdin.flush()
        deadline = time.monotonic()+30
        while time.monotonic() < deadline:
            if index._get_collection().count() == 0: break
            time.sleep(.15)
        assert index._get_collection().count() == 0
        assert browser.post('/internal/document-jobs/passages', json=payload, headers=headers).json()['passages'] == []
