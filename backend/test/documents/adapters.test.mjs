import { expect } from 'chai';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { AiPdfClient } from '../../src/integrations/ai-pdfs.mjs';
import { R2Storage } from '../../src/integrations/r2.mjs';
import { DocumentError } from '../../src/documents/errors.mjs';

const configuration = {
  accountId: 'a'.repeat(32), bucket: 'test-private-bucket',
  accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-key',
};
const token = 'test-service-token-' + 'x'.repeat(32);
const data = Buffer.from('%PDF-fixture');
const digest = value => createHash('sha256').update(value).digest('hex');

async function rejects(operation, status, code) {
  try { await operation(); } catch (error) {
    expect(error).to.be.instanceOf(DocumentError);
    expect(error.status).to.equal(status);
    expect(error.code).to.equal(code);
    return error;
  }
  throw new Error('Expected operation to reject');
}

describe('R2 adapter', () => {
  it('lists every page within the exact source prefix for cleanup', async () => {
    const calls = [];
    const storage = new R2Storage(configuration, { client: { async send(command) {
      calls.push(command.input);
      return command.input.ContinuationToken ? { Contents: [{ Key: 'documents/owner/id/old-2', LastModified: new Date(0) }] }
        : { IsTruncated: true, NextContinuationToken: 'next-page', Contents: [{ Key: 'documents/owner/id/old-1', LastModified: new Date(0) }] };
    } } });
    expect((await storage.list('documents/owner/id/')).map(item => item.key)).to.deep.equal(['documents/owner/id/old-1', 'documents/owner/id/old-2']);
    expect(calls).to.have.length(2);
    expect(calls[1]).to.include({ Prefix: 'documents/owner/id/', ContinuationToken: 'next-page' });
  });

  it('signs short-lived read access to one private object', async () => {
    const storage = new R2Storage(configuration);
    try {
      const url = new URL(await storage.signDownload('documents/owner/source.pdf', 60));
      expect(url.pathname).to.contain('/documents/owner/source.pdf');
      expect(url.searchParams.get('X-Amz-Expires')).to.equal('60');
      expect(url.toString()).not.to.contain(configuration.secretAccessKey);
    } finally { storage.client?.destroy(); }
  });
  it('signs real SDK URLs for one object, exact length/type and short expiry without network access', async () => {
    const storage = new R2Storage(configuration);
    try {
      const url = new URL(await storage.signUpload('pending/owner/document/file.pdf', 1234, 300));
      expect(url.protocol).to.equal('https:');
      expect(url.hostname).to.contain(configuration.accountId + '.r2.cloudflarestorage.com');
      expect(url.pathname).to.contain('/pending/owner/document/file.pdf');
      expect(url.searchParams.get('X-Amz-Expires')).to.equal('300');
      expect(url.searchParams.get('X-Amz-SignedHeaders').split(';')).to.include.members(['content-type', 'content-length']);
      expect(url.toString()).not.to.contain(configuration.secretAccessKey);
    } finally { storage.client?.destroy(); }
  });

  it('does not invent working credentials or expose configuration errors', async () => {
    const error = await rejects(() => new R2Storage({}).signUpload('pending/file', 10, 300), 503, 'storage_unavailable');
    expect(error.message).not.to.contain('secret');
  });

  it('downloads bounded bytes with the expected actual size', async () => {
    const client = { send: async command => {
      expect(command.input).to.include({ Bucket: configuration.bucket, Key: 'pending/file' });
      return { ContentLength: data.length, Body: Readable.from([data.subarray(0, 4), data.subarray(4)]) };
    } };
    const result = await new R2Storage(configuration, { client }).download('pending/file', {
      maxBytes: 100, expectedBytes: data.length,
    });
    expect(result.equals(data)).to.equal(true);
  });

  it('rejects oversized object metadata before reading the body', async () => {
    const body = new Readable({ read() { throw new Error('Must not read this body'); } });
    const storage = new R2Storage(configuration, { client: { send: async () => ({ ContentLength: 1000, Body: body }) } });
    await rejects(() => storage.download('key', { maxBytes: 10, expectedBytes: 1000 }), 413, 'pdf_too_large');
    expect(body.destroyed).to.equal(true);
  });

  it('enforces streamed byte limits even if object metadata lies', async () => {
    const body = Readable.from([Buffer.alloc(6), Buffer.alloc(6)]);
    const storage = new R2Storage(configuration, { client: { send: async () => ({ ContentLength: 10, Body: body }) } });
    await rejects(() => storage.download('key', { maxBytes: 10, expectedBytes: 10 }), 413, 'pdf_too_large');
  });

  it('rejects incomplete streams and declared-size mismatches', async () => {
    for (const length of [data.length, data.length + 1]) {
      const storage = new R2Storage(configuration, { client: { send: async () => ({
        ContentLength: length, Body: Readable.from([data.subarray(1)]),
      }) } });
      await rejects(() => storage.download('key', { maxBytes: 100, expectedBytes: data.length }), 422, 'upload_size_mismatch');
    }
  });

  it('distinguishes an unfinished upload from a storage outage without leaking provider text', async () => {
    const missing = new R2Storage(configuration, { client: { send: async () => { throw { name: 'NoSuchKey' }; } } });
    await rejects(() => missing.download('key', { maxBytes: 100, expectedBytes: 10 }), 409, 'upload_not_found');
    const offline = new R2Storage(configuration, { client: { send: async () => { throw new Error('private-server-credential'); } } });
    const error = await rejects(() => offline.download('key', { maxBytes: 100, expectedBytes: 10 }), 503, 'storage_unavailable');
    expect(error.message).not.to.contain('private-server');
  });

  it('writes exact validated bytes under a new key and removes only the supplied object', async () => {
    const commands = [];
    const storage = new R2Storage(configuration, { client: { send: async command => { commands.push(command); } } });
    await storage.putValidated('documents/owner/snapshot.pdf', data);
    await storage.remove('pending/owner/upload.pdf');
    expect(commands[0].input).to.include({ Key: 'documents/owner/snapshot.pdf', ContentLength: data.length, ContentType: 'application/pdf' });
    expect(commands[0].input.Body.equals(data)).to.equal(true);
    expect(commands[1].input).to.deep.equal({ Bucket: configuration.bucket, Key: 'pending/owner/upload.pdf' });
  });
});

describe('Python PDF API adapter', () => {
  it('authenticates service calls, disables redirects and supplies only PDF bytes', async () => {
    const calls = [];
    const client = new AiPdfClient({ baseUrl: 'http://127.0.0.1:8001', token, fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const body = options.method === 'GET' ? { max_pages: 5, max_bytes: 1000 } : {
        page_count: 2, byte_count: data.length, sha256: digest(data),
      };
      return Response.json(body);
    } });
    const policy = await client.policy();
    const result = await client.inspect(data, policy);
    expect(result).to.deep.equal({ pageCount: 2, byteCount: data.length, sha256: digest(data) });
    expect(calls[0].url.pathname).to.equal('/internal/pdfs/policy');
    expect(calls[1].options).to.include({ method: 'POST', redirect: 'error', body: data });
    expect(calls[1].options.headers.Authorization).to.equal(`Bearer ${token}`);
    expect(calls[1].options.headers).not.to.have.property('X-User-ID');
  });

  it('rejects missing service credentials before making a request', async () => {
    const client = new AiPdfClient({ baseUrl: 'http://localhost:8001', token: '', fetchImpl: () => { throw new Error('Must not call'); } });
    await rejects(() => client.policy(), 503, 'validation_unavailable');
  });

  it('maps known PDF rejection codes without returning arbitrary Python messages', async () => {
    const client = new AiPdfClient({ baseUrl: 'http://localhost:8001', token, fetchImpl: async () => Response.json({
      error: { code: 'pdf_page_limit_exceeded', message: 'private-raw-document' },
    }, { status: 422 }) });
    const error = await rejects(() => client.inspect(data, { maxPages: 5, maxBytes: 100 }), 422, 'pdf_page_limit_exceeded');
    expect(error.message).not.to.contain('private-raw');
  });

  it('rejects oversized/malformed responses, credential failures and outages as unavailable', async () => {
    const responses = [
      () => new Response('x'.repeat(20000)), () => new Response('not-json'),
      () => Response.json({ error: { code: 'unauthorized', message: token } }, { status: 401 }),
      () => { throw new Error('private-provider-details'); },
    ];
    for (const response of responses) {
      const client = new AiPdfClient({ baseUrl: 'http://localhost:8001', token, fetchImpl: async () => response() });
      await rejects(() => client.policy(), 503, 'validation_unavailable');
    }
  });

  it('validates discovered policy rather than accepting malformed limits', async () => {
    for (const body of [{}, { max_pages: 0, max_bytes: 100 }, { max_pages: 5, max_bytes: '100' }]) {
      const client = new AiPdfClient({ baseUrl: 'http://localhost:8001', token, fetchImpl: async () => Response.json(body) });
      await rejects(() => client.policy(), 503, 'validation_unavailable');
    }
  });

  it('requires inspection metadata to match the exact PDF and current policy', async () => {
    for (const override of [{ sha256: '0'.repeat(64) }, { byte_count: 1 }, { page_count: 6 }]) {
      const client = new AiPdfClient({ baseUrl: 'http://localhost:8001', token, fetchImpl: async () => Response.json({
        page_count: 1, byte_count: data.length, sha256: digest(data), ...override,
      }) });
      await rejects(() => client.inspect(data, { maxPages: 5, maxBytes: 1000 }), 503, 'validation_unavailable');
    }
  });
});
