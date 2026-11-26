import { expect } from 'chai';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '../../src/app.mjs';
import { Document, User } from '../../src/db.mjs';
import { DocumentRepository } from '../../src/documents/repository.mjs';
import { DocumentJobRepository } from '../../src/documents/job-repository.mjs';
import { DocumentJobService } from '../../src/documents/job-service.mjs';
import { createIndexingJob, INDEXING_LEASE_MS, INDEXING_MAX_ATTEMPTS, INDEXING_RETRY_BASE_MS } from '../../src/documents/indexing-policy.mjs';

const token = 'document-worker-test-' + 'x'.repeat(40);
const auth = { Authorization: `Bearer ${token}` };
const execute = promisify(execFile);
const integration = process.env.TEST_DSN ? describe : describe.skip;

describe('Document worker HTTP boundary', () => {
  let app;
  let calls;
  beforeEach(() => {
    calls = 0;
    app = createApp({ internalServiceToken: token, documentJobsService: {
      async claim() { calls++; return null; },
      async heartbeat() { throw new Error('private-document-and-secret'); },
    } });
  });

  it('requires service authentication even with cookies, identity headers or malformed JSON', async () => {
    for (const headers of [{}, { Authorization: 'Bearer wrong' }, { Authorization: 'Basic credentials' },
      { Cookie: 'classmate.sid=not-a-service-credential', 'X-User-ID': 'owner' },
      { Authorization: [`Bearer ${token}`, `Bearer ${token}`] }]) {
      const response = await request(app).post('/internal/document-jobs/claim').set(headers)
        .set('Content-Type', 'application/json').send('{private-invalid-json').expect(401);
      expect(response.headers['www-authenticate']).to.equal('Bearer');
      expect(response.headers['cache-control']).to.equal('no-store');
      expect(response.text).not.to.contain('private-invalid');
    }
    expect(calls).to.equal(0);
  });

  it('returns no job without creating browser sessions', async () => {
    const response = await request(app).post('/internal/document-jobs/claim').set(auth).send({}).expect(204);
    expect(response.headers['set-cookie']).to.equal(undefined);
    expect(calls).to.equal(1);
  });

  it('rejects claimed identities, non-JSON requests, large payloads and malformed leases', async () => {
    await request(app).post('/internal/document-jobs/claim').set(auth).send({ user_id: 'forged-owner' }).expect(400);
    await request(app).post('/internal/document-jobs/claim').set(auth).type('text').send('{}').expect(415);
    await request(app).post('/internal/document-jobs/claim').set(auth).send({ private: 'x'.repeat(17000) }).expect(413);
    await request(app).post('/internal/document-jobs/invalid/heartbeat').set(auth).send({ lease_token: randomUUID() }).expect(400);
    await request(app).post(`/internal/document-jobs/${randomUUID()}/source`).set(auth).send({ lease_token: { $ne: null } }).expect(400);
    expect(calls).to.equal(0);
  });

  it('fails closed for missing configuration and hides unexpected service errors', async () => {
    const disabled = createApp({ internalServiceToken: '', documentJobsService: { claim() { throw new Error('Must not call'); } } });
    await request(disabled).post('/internal/document-jobs/claim').set(auth).send({}).expect(503);
    const response = await request(app).post(`/internal/document-jobs/${randomUUID()}/heartbeat`).set(auth)
      .send({ lease_token: randomUUID() }).expect(503);
    expect(response.text).not.to.contain('private-document');
    await request(app).get(`/api/documents/${new mongoose.Types.ObjectId()}/indexing`).expect(401);
  });
});

integration('Durable document jobs with MongoDB (requires TEST_DSN)', () => {
  let now;
  let alice;
  let bob;
  let user;
  let otherUser;
  let repository;
  let jobs;
  let storage;
  let app;

  before(async () => {
    if (!new URL(process.env.TEST_DSN).pathname.endsWith('_test')) { throw new Error('Use a disposable TEST_DSN ending in _test.'); }
    await mongoose.connect(process.env.TEST_DSN);
    await Promise.all([Document.createIndexes(), User.createIndexes()]);
  });
  after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
  beforeEach(async () => {
    await Promise.all([Document.deleteMany({}), User.deleteMany({})]);
    now = new Date('2026-11-26T12:00:00Z');
    const password = await bcrypt.hash('test-password123', 4);
    [user, otherUser] = await User.create([
      { username: 'job-alice', email: 'job-alice@example.test', password },
      { username: 'job-bob', email: 'job-bob@example.test', password },
    ]);
    repository = new DocumentJobRepository();
    storage = { signed: [], async signDownload(key, seconds) {
      this.signed.push({ key, seconds }); return 'https://private.example/source.pdf?test-signature';
    } };
    jobs = new DocumentJobService({ repository, storage, clock: () => now });
    app = createApp({ documentJobsService: jobs, internalServiceToken: token });
    alice = request.agent(app);
    bob = request.agent(app);
    await alice.post('/api/auth/login').send({ username: user.username, password: 'test-password123' }).expect(200);
    await bob.post('/api/auth/login').send({ username: otherUser.username, password: 'test-password123' }).expect(200);
  });

  async function document({ indexing = true, status = 'uploaded', owner = user._id } = {}) {
    const id = new mongoose.Types.ObjectId();
    const sourceVersion = randomUUID();
    return Document.create({
      _id: id, user: owner, title: 'Job fixture', filename: 'fixture.pdf', status,
      expectedBytes: 100, maxBytes: 1000, byteCount: 100, pageCount: 2,
      uploadKey: `pending/${owner}/${id}/temporary.pdf`, objectKey: `documents/${owner}/${id}/snapshot.pdf`,
      sourceVersion, sha256: 'a'.repeat(64), uploadExpiresAt: now, finalizeUntil: now,
      ...(indexing ? { indexing: createIndexingJob(owner, sourceVersion, now) } : {}),
    });
  }
  const internal = (path, body = {}) => request(app).post(`/internal/document-jobs/${path}`).set(auth).send(body);

  it('queues the exact validated source atomically with upload finalization', async () => {
    const doc = await document({ indexing: false, status: 'validating' });
    const validationToken = randomUUID();
    await Document.updateOne({ _id: doc._id }, { validationToken });
    const uploaded = await new DocumentRepository().finalize(user._id, doc._id, validationToken, {
      objectKey: doc.objectKey, sourceVersion: doc.sourceVersion, pageCount: 2, byteCount: 100, sha256: doc.sha256,
    }, now);
    expect(uploaded.status).to.equal('uploaded');
    expect(uploaded.indexing).to.include({ sourceVersion: uploaded.sourceVersion, status: 'queued', attempts: 0 });
    expect(String(uploaded.indexing.user)).to.equal(String(user._id));
    expect(await new DocumentRepository().finalize(user._id, doc._id, validationToken, { sourceVersion: randomUUID() }, now)).to.equal(null);
    expect((await Document.findById(doc._id)).indexing.jobId).to.equal(uploaded.indexing.jobId);
  });

  it('allows only one concurrent worker to claim a job', async () => {
    const doc = await document();
    const claims = await Promise.all(Array.from({ length: 8 }, () => jobs.claim()));
    const active = claims.filter(Boolean);
    expect(active).to.have.length(1);
    expect(active[0].job).to.include({ job_id: doc.indexing.jobId, source_version: doc.sourceVersion, storage_key: doc.objectKey });
    expect(active[0].job.limits).to.deep.equal({ max_pages: 2, max_bytes: 100 });
    expect(active[0].context.user_id).to.equal(String(user._id));
    expect(active[0].context.scope.sources).to.deep.equal([active[0].snapshot.source]);
    expect((await Document.findById(doc._id)).indexing.attempts).to.equal(1);
  });

  it('gives the active lease a bounded URL and renews without changing its token', async () => {
    const doc = await document();
    const claim = (await internal('claim').expect(200)).body;
    const jobId = claim.job.job_id;
    const lease = { lease_token: claim.lease.token };
    await internal(`${jobId}/source`, lease).expect(200);
    expect(storage.signed[0]).to.deep.equal({ key: doc.objectKey, seconds: 60 });
    now = new Date(now.getTime() + INDEXING_LEASE_MS - 500);
    await internal(`${jobId}/source`, lease).expect(409);
    await internal(`${jobId}/heartbeat`, lease).expect(200);
    expect((await Document.findById(doc._id)).indexing.leaseToken).to.equal(claim.lease.token);
    await internal(`${jobId}/source`, lease).expect(200);
  });

  it('recovers an expired lease and rejects the old worker', async () => {
    await document();
    const first = await jobs.claim();
    now = new Date(now.getTime() + INDEXING_LEASE_MS + 1);
    const second = await jobs.claim();
    expect(second.attempt).to.equal(2);
    expect(second.lease.token).not.to.equal(first.lease.token);
    await internal(`${first.job.job_id}/heartbeat`, { lease_token: first.lease.token }).expect(409);
    await internal(`${first.job.job_id}/source`, { lease_token: first.lease.token }).expect(409);
    expect(await jobs.fail(first.job.job_id, first.lease.token, 'index_unavailable', true)).to.include({ disposition: 'stale' });
  });

  it('backs off retries and acknowledges duplicate failures without mutating the newer lease', async () => {
    const doc = await document();
    const first = await jobs.claim();
    const fail = () => jobs.fail(first.job.job_id, first.lease.token, 'embedding_unavailable', true);
    expect(await fail()).to.include({ disposition: 'applied' });
    const saved = await Document.findById(doc._id).lean();
    expect(saved.indexing.status).to.equal('queued');
    expect(saved.indexing.availableAt.getTime()).to.equal(now.getTime() + INDEXING_RETRY_BASE_MS);
    expect(await fail()).to.include({ disposition: 'duplicate' });
    expect(await jobs.claim()).to.equal(null);
    now = new Date(now.getTime() + INDEXING_RETRY_BASE_MS + 1);
    const second = await jobs.claim();
    expect(second.attempt).to.equal(2);
    expect(await fail()).to.include({ disposition: 'duplicate' });
    expect((await Document.findById(doc._id)).indexing.leaseToken).to.equal(second.lease.token);
  });

  it('stops crashed workers after the retry budget and permits an explicit owner retry', async () => {
    const doc = await document();
    for (let attempt = 1; attempt <= INDEXING_MAX_ATTEMPTS; attempt++) {
      expect((await jobs.claim()).attempt).to.equal(attempt);
      now = new Date(now.getTime() + INDEXING_LEASE_MS + 1);
    }
    expect(await jobs.claim()).to.equal(null);
    expect((await Document.findById(doc._id)).indexing.error.code).to.equal('worker_timeout');
    await alice.post(`/api/documents/${doc._id}/indexing/retry`).send({}).expect(200);
    const retried = await Document.findById(doc._id);
    expect(retried.indexing.jobId).not.to.equal(doc.indexing.jobId);
    expect(retried.indexing.attempts).to.equal(0);
  });

  it('keeps permanent PDF failures terminal and rejects arbitrary error messages', async () => {
    const doc = await document();
    const claim = await jobs.claim();
    await internal(`${claim.job.job_id}/fail`, { lease_token: claim.lease.token, error_code: 'pdf_text_unavailable',
      retryable: true, message: 'private-extracted-text' }).expect(400);
    await internal(`${claim.job.job_id}/fail`, { lease_token: claim.lease.token, error_code: 'pdf_text_unavailable', retryable: true }).expect(200);
    expect((await Document.findById(doc._id)).indexing.status).to.equal('failed');
    expect(await jobs.claim()).to.equal(null);
  });

  it('keeps owned public status free of worker credentials and supports legacy saved PDFs', async () => {
    const doc = await document({ indexing: false });
    expect((await alice.get(`/api/documents/${doc._id}/indexing`).expect(200)).body.indexing.status).to.equal('not_requested');
    await bob.get(`/api/documents/${doc._id}/indexing`).expect(404);
    await bob.post(`/api/documents/${doc._id}/indexing/retry`).send({}).expect(404);
    await alice.post(`/api/documents/${doc._id}/indexing/retry`).send({ user: String(otherUser._id) }).expect(400);
    await alice.post(`/api/documents/${doc._id}/indexing/retry`).send({}).expect(200);
    await jobs.claim();
    const response = await alice.get(`/api/documents/${doc._id}/indexing`).expect(200);
    expect(response.body.indexing.status).to.equal('processing');
    for (const name of ['leaseToken', 'lease_token', 'storage_key', 'objectKey', 'jobId', 'sha256']) {
      expect(response.text).not.to.contain(name);
    }
  });

  it('fences changed source versions and allows the owner to queue the new version', async () => {
    const doc = await document();
    const first = await jobs.claim();
    const sourceVersion = randomUUID();
    await Document.updateOne({ _id: doc._id }, { sourceVersion });
    await internal(`${first.job.job_id}/heartbeat`, { lease_token: first.lease.token }).expect(409);
    await internal(`${first.job.job_id}/source`, { lease_token: first.lease.token }).expect(409);
    expect(await jobs.claim()).to.equal(null);
    await jobs.retry(user._id, doc._id);
    expect((await jobs.claim()).job.source_version).to.equal(sourceVersion);
  });

  it('revokes leases when ownership changes or deletion starts', async () => {
    const doc = await document();
    const claim = await jobs.claim();
    await Document.updateOne({ _id: doc._id }, { user: otherUser._id });
    await internal(`${claim.job.job_id}/source`, { lease_token: claim.lease.token }).expect(409);
    await Document.updateOne({ _id: doc._id }, { user: user._id, status: 'deleting' });
    await internal(`${claim.job.job_id}/heartbeat`, { lease_token: claim.lease.token }).expect(409);
    expect(await jobs.fail(claim.job.job_id, claim.lease.token, 'index_unavailable', true)).to.include({ disposition: 'stale' });
    expect((await Document.findById(doc._id)).status).to.equal('deleting');
    await Document.deleteOne({ _id: doc._id });
    expect(await jobs.fail(claim.job.job_id, claim.lease.token, 'index_unavailable', true)).to.include({ disposition: 'stale' });
  });

  it('does not grant download access to malformed or mismatched stored snapshots', async () => {
    const doc = await document();
    await Document.updateOne({ _id: doc._id }, { objectKey: `documents/${otherUser._id}/foreign/file.pdf` });
    expect(await jobs.claim()).to.equal(null);
    expect((await Document.findById(doc._id)).indexing.error.code).to.equal('source_unavailable');
    expect(storage.signed).to.have.length(0);
  });

  it('recovers the persisted job from a fresh Node process', async () => {
    await document();
    const first = await jobs.claim();
    now = new Date(now.getTime() + INDEXING_LEASE_MS + 1);
    const script = `
      import mongoose from 'mongoose';
      import { DocumentJobRepository } from './src/documents/job-repository.mjs';
      import { DocumentJobService } from './src/documents/job-service.mjs';
      await mongoose.connect(process.env.TEST_DSN);
      try {
        const service = new DocumentJobService({ repository: new DocumentJobRepository(), storage: {}, clock: () => new Date(process.env.JOB_TEST_TIME) });
        const result = await service.claim();
        process.stdout.write(JSON.stringify({ id: result.job.job_id, attempt: result.attempt, lease: result.lease.token }));
      } finally { await mongoose.disconnect(); }
    `;
    const result = await execute(process.execPath, ['--input-type=module', '-e', script], {
      cwd: new URL('../../', import.meta.url), env: { ...process.env, JOB_TEST_TIME: now.toISOString() }, timeout: 10000,
    });
    const recovered = JSON.parse(result.stdout);
    expect(recovered.id).to.equal(first.job.job_id);
    expect(recovered.attempt).to.equal(2);
    expect(recovered.lease).not.to.equal(first.lease.token);
  });
});
