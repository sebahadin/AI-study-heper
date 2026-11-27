// Disposable integration server. Never imported by the application.
import mongoose from 'mongoose';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { S3Client } from '@aws-sdk/client-s3';
import { createApp } from '../../src/app.mjs';
import { Document } from '../../src/db.mjs';
import { settings } from '../../src/config.mjs';
import { R2Storage } from '../../src/integrations/r2.mjs';
import { AiPdfClient } from '../../src/integrations/ai-pdfs.mjs';
import { DocumentRepository } from '../../src/documents/repository.mjs';
import { DocumentService } from '../../src/documents/service.mjs';
import { DocumentJobRepository } from '../../src/documents/job-repository.mjs';
import { DocumentJobService } from '../../src/documents/job-service.mjs';
import { Note } from '../../src/db.mjs';

const dsn = process.env.TEST_DSN;
if (process.env.NODE_ENV !== 'test' || !/^classmate_indexing_[a-f0-9]+_test$/.test(new URL(dsn).pathname.slice(1))) {
  throw new Error('Use the isolated indexing test database.');
}
await mongoose.connect(dsn);
const objects = new Map();
const s3 = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local.test');
  const key = decodeURIComponent(url.pathname).replace(/^\/private-test\//, '');
  if (req.method === 'PUT') {
    const chunks = []; for await (const chunk of req) { chunks.push(chunk); }
    objects.set(key, { data: Buffer.concat(chunks), modified: new Date() });
    res.setHeader('ETag', '"fixture-etag"'); res.end();
  } else if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204).end(); }
  else if (req.method === 'GET' && url.searchParams.has('list-type')) {
    const prefix = url.searchParams.get('prefix') || '';
    const contents = [...objects].filter(([name]) => name.startsWith(prefix)).map(([name, item]) => `<Contents><Key>${name}</Key><LastModified>${item.modified.toISOString()}</LastModified><Size>${item.data.length}</Size></Contents>`).join('');
    res.setHeader('Content-Type', 'application/xml');
    res.end(`<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`);
  } else if (req.method === 'GET' && objects.has(key)) {
    const data = objects.get(key).data;
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': data.length }).end(data);
  } else { res.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>'); }
});
s3.listen(0, '127.0.0.1'); await once(s3, 'listening');
const localClient = new S3Client({ endpoint: `http://127.0.0.1:${s3.address().port}`, region: 'auto', forcePathStyle: true,
  credentials: { accessKeyId: 'test-access', secretAccessKey: 'test-secret' },
  requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
const storage = process.env.AI_LIVE_R2_TEST === '1' ? new R2Storage(settings.r2) : new R2Storage({
  accountId: 'a'.repeat(32), bucket: 'private-test', accessKeyId: 'test-access', secretAccessKey: 'test-secret',
}, { client: localClient });
let offset = 0;
const clock = () => new Date(Date.now() + offset);
const inspector = new AiPdfClient({ baseUrl: settings.aiServiceUrl, token: settings.aiServiceToken });
const jobs = new DocumentJobService({ repository: new DocumentJobRepository(), notesRepository: new DocumentJobRepository(Note), storage, clock,
  profile: () => inspector.request('/internal/retrieval/profile') });
const documents = new DocumentService({ repository: new DocumentRepository(), storage, inspector, clock });
const server = createApp({ documentService: documents, documentJobsService: jobs }).listen(0, '127.0.0.1');
await once(server, 'listening');
console.log(JSON.stringify({ port: server.address().port }));
// Clock control is process-local stdin, never an HTTP application endpoint.
createInterface({ input: process.stdin }).on('line', line => {
  if (line === 'expire-upload-links') { offset = 10 * 60 * 1000; }
});
let stopping = false;
async function stop() {
  if (stopping) { return; } stopping = true;
  server.closeAllConnections(); server.close(); s3.closeAllConnections(); s3.close();
  try {
    const rows = await Document.find({}).lean();
    const results = await Promise.allSettled(rows.map(async row => {
      await Promise.all([`documents/${row.user}/${row._id}/`, `pending/${row.user}/${row._id}/`].map(async prefix => {
        const objects = await storage.list(prefix);
        await Promise.all(objects.map(item => storage.remove(item.key)));
      }));
    }));
    if (results.some(result => result.status === 'rejected')) { throw new Error('Test storage cleanup failed'); }
    await mongoose.connection.dropDatabase();
  } catch {
    console.error('Test resource cleanup failed; isolated database retained for retry.');
    process.exitCode = 1;
  } finally { storage.client?.destroy(); localClient.destroy(); await mongoose.disconnect(); process.exit(process.exitCode || 0); }
}
process.on('SIGTERM', stop); process.on('SIGINT', stop);
