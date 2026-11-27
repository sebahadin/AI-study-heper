"""Run with python -m app.workers.documents. All app writes go through Express."""
import asyncio
from contextlib import suppress
from hashlib import sha256
import json
import logging
import signal
import time
from app.core.errors import APIError
from app.core.worker_config import WorkerSettings
from app.integrations.classmate_client import ClassmateClient
from app.integrations.chroma_client import ChromaIndex
from app.providers.local_embeddings import LocalHuggingFaceEmbeddings
from app.rag.ingestion.preparation import prepare_pdf
from app.rag.ingestion.notes import prepare_note
from app.schemas.preparation import PdfSourceSnapshot
from app.schemas.worker import ClaimedJob
from app.workers.outbox import Outbox

logger = logging.getLogger('classmate.worker')


def manifest_digest(passages):
    rows = [[p['citation']['chunk_id'], p['text'], p['citation']['locator'], p['citation'].get('page_start'), p['citation'].get('page_end')] for p in passages]
    return sha256(json.dumps(rows, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


class DocumentIngestionWorker:
    def __init__(self, settings, client, embeddings, index, outbox):
        self.settings, self.client, self.embeddings, self.index, self.outbox = settings, client, embeddings, index, outbox
        self.stopping = asyncio.Event()
        self.last_maintenance = 0

    async def heartbeat(self, claim, lost):
        while True:
            await asyncio.sleep(self.settings.worker_heartbeat_seconds)
            try:
                await self.client.request(f'/{claim.job.job_id}/heartbeat', {'lease_token': claim.lease.token})
            except APIError as error:
                if error.status_code == 409:
                    lost.set()
                    return
                logger.warning('heartbeat_unavailable')

    async def deliver(self):
        for generation, job, payload in self.outbox.entries():
            try:
                ack = await self.client.request(f'/{job}/complete', payload)
                if ack['disposition'] in ('applied', 'duplicate', 'stale'):
                    self.outbox.remove(generation)
            except APIError as error:
                if error.status_code in (400, 409, 413, 415, 422):
                    # Invalid or obsolete manifests cannot become current on retry.
                    # The job lease expires and the ordinary recovery path retries.
                    self.outbox.remove(generation)
                    logger.warning('completion_rejected code=%s', error.code)
                    continue
                # A delivery outage must not relabel verified indexing as failure.
                return

    async def process(self, claim: ClaimedJob):
        lost = asyncio.Event()
        heartbeat = asyncio.create_task(self.heartbeat(claim, lost))
        try:
            async with asyncio.timeout(self.settings.worker_job_timeout_seconds):
                source = await self.client.request(f'/{claim.job.job_id}/source', {'lease_token': claim.lease.token})
                if claim.job.source_type == 'document':
                    data = await self.client.download_pdf(source['url'], expected_bytes=claim.job.limits.max_bytes, digest=claim.snapshot.sha256)
                    prepared = await asyncio.to_thread(prepare_pdf, data, snapshot=PdfSourceSnapshot(**claim.snapshot.model_dump()),
                                                       context=claim.context, limits=claim.job.limits)
                else:
                    prepared = await asyncio.to_thread(prepare_note, source['text'], source=claim.snapshot.source,
                                                       digest=claim.snapshot.sha256, context=claim.context)
                if lost.is_set():
                    return
                chunks = await self.embeddings.embed_prepared_source(prepared, context=claim.context)
                verified = await self.index.upsert_chunks(chunks, context=claim.context)
                if lost.is_set() or verified != len(chunks):
                    return
                passages = [chunk.passage.model_dump(mode='json') for chunk in chunks]
                payload = {
                    'lease_token': claim.lease.token, 'generation_id': claim.snapshot.source.index_generation,
                    'source_sha256': claim.snapshot.sha256, 'passages': passages, 'manifest_digest': manifest_digest(passages),
                    'pages_without_text': list(prepared.pages_without_text),
                    'report': {'job_id': claim.job.job_id, 'document_id': claim.job.document_id,
                               'source_version': claim.job.source_version, 'status': 'ready',
                               'expected_chunks': len(chunks), 'indexed_chunks': verified,
                               'embedding_model': self.embeddings.model_id, 'index_version': self.index.index_version},
                }
                self.outbox.put(claim.snapshot.source.index_generation, claim.job.job_id, payload)
                # Keep renewing the lease while retrying independent callback delivery.
                while not self.stopping.is_set():
                    await self.deliver()
                    if not any(row[0] == claim.snapshot.source.index_generation for row in self.outbox.entries()):
                        break
                    if lost.is_set():
                        break
                    await asyncio.sleep(self.settings.worker_poll_seconds)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            code = error.code if isinstance(error, APIError) else 'indexing_failed'
            known = {'pdf_text_unavailable', 'invalid_pdf', 'pdf_text_extraction_failed', 'pdf_page_limit_exceeded',
                     'pdf_too_large', 'pdf_text_limit_exceeded', 'pdf_content_limit_exceeded', 'pdf_chunk_limit_exceeded',
                     'source_snapshot_mismatch', 'source_unavailable', 'storage_unavailable', 'embedding_unavailable',
                     'index_unavailable', 'index_incomplete'}
            if isinstance(error, TimeoutError):
                code = 'index_unavailable'
            pending = any(row[0] == claim.snapshot.source.index_generation for row in self.outbox.entries())
            if not pending:
                with suppress(APIError):
                    await self.client.request(f'/{claim.job.job_id}/fail', {'lease_token': claim.lease.token,
                                              'error_code': code if code in known else 'indexing_failed',
                                              'retryable': code in {'storage_unavailable', 'embedding_unavailable', 'index_unavailable', 'index_incomplete'}})
            if pending:
                logger.warning('completion_delivery_pending')
            else:
                logger.warning('indexing_operation_failed code=%s', code if code in known else 'indexing_failed')
        finally:
            heartbeat.cancel()
            with suppress(asyncio.CancelledError):
                await heartbeat

    async def maintenance(self):
        await self.client.request('/maintenance', {'embedding_model': self.embeddings.model_id})
        for _ in range(10):
            item = await self.client.request('/cleanup/claim', {})
            if not item:
                break
            await self.index.delete_source(item['source_id'], item['source_type'], item['user_id'])
            await self.client.request('/cleanup/complete', item)
        for source in (await self.client.request('/audit/candidates', {'embedding_model': self.embeddings.model_id}))['sources']:
            available = await self.index.audit_source(source)
            await self.client.request('/audit/result', {
                **{key: source[key] for key in ('source_id', 'source_type', 'user_id', 'source_version', 'generation_id', 'job_id')},
                'available': available,
            })
        await self.index.reconcile(self.client)

    async def run(self, *, once=False):
        while not self.stopping.is_set():
            try:
                await self.deliver()
                if time.monotonic() - self.last_maintenance >= self.settings.worker_maintenance_seconds:
                    try:
                        await self.maintenance()
                        self.last_maintenance = time.monotonic()
                    except Exception:
                        logger.warning('index_maintenance_pending')
                raw = await self.client.request('/claim', {})
                if raw:
                    await self.process(ClaimedJob.model_validate(raw))
                elif once:
                    return
            except Exception:
                logger.warning('worker_service_unavailable')
                if once:
                    raise
            if once:
                return
            with suppress(TimeoutError):
                await asyncio.wait_for(self.stopping.wait(), timeout=self.settings.worker_poll_seconds)


async def main():
    settings = WorkerSettings()
    embeddings = LocalHuggingFaceEmbeddings(settings)
    vector = (await embeddings.embed(['Warm up local retrieval.']))[0]
    index = ChromaIndex.shared(settings, embeddings.model_id, len(vector))
    client = ClassmateClient(settings)
    worker = DocumentIngestionWorker(settings, client, embeddings, index, Outbox(settings.worker_outbox_path))
    loop = asyncio.get_running_loop()
    for name in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(name, worker.stopping.set)
    logger.info('local_indexing_worker_ready')
    try:
        await worker.run()
    finally:
        await client.close()

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(name)s %(message)s')
    # HTTPX logs full signed storage URLs at INFO. Keep credentials out of logs.
    logging.getLogger('httpx').setLevel(logging.WARNING)
    logging.getLogger('httpcore').setLevel(logging.WARNING)
    asyncio.run(main())
