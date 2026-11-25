import { expect } from 'chai';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';
import { createApp } from '../../src/app.mjs';
import { User, Document } from '../../src/db.mjs';
import { DocumentRepository } from '../../src/documents/repository.mjs';
import { DocumentService } from '../../src/documents/service.mjs';
import { R2Storage } from '../../src/integrations/r2.mjs';
import { AiPdfClient } from '../../src/integrations/ai-pdfs.mjs';

const live = process.env.TEST_DSN && process.env.AI_TEST_URL && process.env.AI_TEST_TOKEN ? describe : describe.skip;

// A standards-based PDF fixture with a real cross-reference table, parsed by Python.
function blankPdf(pages) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(' ')}] >>`,
    ...Array.from({ length: pages }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] >>'),
  ];
  let result = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(result)); result += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  result += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  return Buffer.from(result + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

live('Full upload flow with real Python HTTP and a local S3 transport (requires AI_TEST_URL/TOKEN)', () => {
  let server;
  let client;
  let agent;
  const objects = new Map();

  before(async () => {
    if (!new URL(process.env.TEST_DSN).pathname.endsWith('_test')) { throw new Error('TEST_DSN must end in _test.'); }
    await mongoose.connect(process.env.TEST_DSN);
    server = createServer(async (req, res) => {
      const key = decodeURIComponent(new URL(req.url, 'http://local.test').pathname);
      if (req.method === 'PUT') {
        const chunks = [];
        for await (const chunk of req) { chunks.push(chunk); }
        objects.set(key, Buffer.concat(chunks));
        res.setHeader('ETag', '"fixture-etag"');
        res.end();
      } else if (req.method === 'DELETE') {
        objects.delete(key);
        res.writeHead(204).end();
      } else if (req.method === 'GET' && objects.has(key)) {
        const data = objects.get(key);
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': data.length }).end(data);
      } else { res.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>'); }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    client = new S3Client({
      endpoint: `http://127.0.0.1:${server.address().port}`, region: 'auto', forcePathStyle: true,
      credentials: { accessKeyId: 'test-access', secretAccessKey: 'test-secret' },
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    });
    const storage = new R2Storage({
      accountId: 'a'.repeat(32), bucket: 'private-test', accessKeyId: 'test-access', secretAccessKey: 'test-secret',
    }, { client });
    const inspector = new AiPdfClient({ baseUrl: process.env.AI_TEST_URL, token: process.env.AI_TEST_TOKEN });
    const service = new DocumentService({ repository: new DocumentRepository(), storage, inspector });
    const user = await User.create({
      username: 'upload-student', email: 'upload-student@example.com', password: await bcrypt.hash('test-password123', 4),
    });
    agent = request.agent(createApp({ documentService: service }));
    await agent.post('/api/auth/login').send({ username: user.username, password: 'test-password123' }).expect(200);
  });
  after(async () => {
    client?.destroy();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    if (mongoose.connection.readyState === 1) { await mongoose.connection.dropDatabase(); }
    await mongoose.disconnect();
  });

  it('signs, uploads directly, downloads through the SDK, validates in Python and saves a stable snapshot', async () => {
    const data = blankPdf(5);
    const started = (await agent.post('/api/documents/uploads').send({ filename: 'five-pages.pdf', byteCount: data.length }).expect(201)).body;
    const upload = await fetch(started.upload.url, { method: 'PUT', headers: started.upload.headers, body: data });
    expect(upload.status).to.equal(200);
    const completed = await agent.post(`/api/documents/${started.document._id}/complete`).send({}).expect(200);
    expect(completed.headers['cache-control']).to.equal('no-store');
    expect(completed.body.document).to.include({ status: 'uploaded', pageCount: 5, byteCount: data.length });
    const record = await Document.findById(started.document._id).lean();
    expect(record.sha256).to.equal(createHash('sha256').update(data).digest('hex'));
    expect(objects.get(`/private-test/${record.objectKey}`).equals(data)).to.equal(true);
    // The still-valid temporary URL cannot alter the approved object.
    await fetch(started.upload.url, { method: 'PUT', headers: started.upload.headers, body: Buffer.alloc(data.length) });
    expect(objects.get(`/private-test/${record.objectKey}`).equals(data)).to.equal(true);
  });

  it('rejects six pages through the real Python validator and persists the rejection', async () => {
    const data = blankPdf(6);
    const started = (await agent.post('/api/documents/uploads').send({ filename: 'six-pages.pdf', byteCount: data.length }).expect(201)).body;
    await fetch(started.upload.url, { method: 'PUT', headers: started.upload.headers, body: data });
    const response = await agent.post(`/api/documents/${started.document._id}/complete`).send({}).expect(422);
    expect(response.body.code).to.equal('pdf_page_limit_exceeded');
    const record = await Document.findById(started.document._id).lean();
    expect(record.status).to.equal('failed');
    expect(record.objectKey).to.equal(null);
  });
});
