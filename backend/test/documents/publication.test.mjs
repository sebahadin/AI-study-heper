import { expect } from 'chai';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/app.mjs';
import { Document, Note, Book, Course, User } from '../../src/db.mjs';
import { DocumentJobRepository } from '../../src/documents/job-repository.mjs';
import { DocumentJobService } from '../../src/documents/job-service.mjs';
import { createIndexingJob, INDEXING_LEASE_MS } from '../../src/documents/indexing-policy.mjs';
import { noteSourceText, passageDigest, textDigest } from '../../src/documents/publication.mjs';

const integration = process.env.TEST_DSN ? describe : describe.skip;
integration('Verified indexing publication, notes and cleanup (requires TEST_DSN)', () => {
  let user, other, now, jobs, storage, agent;
  before(async () => {
    if (!new URL(process.env.TEST_DSN).pathname.endsWith('_test')) { throw new Error('Use a disposable TEST_DSN.'); }
    await mongoose.connect(process.env.TEST_DSN);
  });
  after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
  beforeEach(async () => {
    await Promise.all([Document, Note, Book, Course, User].map(model => model.deleteMany({})));
    now = new Date();
    const password = await bcrypt.hash('test-password123', 4);
    [user, other] = await User.create([{ username: 'manifest-owner', email: 'owner@example.test', password }, { username: 'manifest-other', email: 'other@example.test', password }]);
    storage = { removed: [], objects: [], async remove(key) { this.removed.push(key); }, async list(prefix) { return this.objects.filter(item => item.key.startsWith(prefix)); } };
    jobs = new DocumentJobService({ repository: new DocumentJobRepository(), notesRepository: new DocumentJobRepository(Note), storage, clock: () => now,
      profile: async () => ({ embedding_model: 'test-model', index_version: 'test-index' }) });
    agent = request.agent(createApp({ documentJobsService: jobs }));
    await agent.post('/api/auth/login').send({ username: user.username, password: 'test-password123' }).expect(200);
  });
  async function pdf() {
    const id = new mongoose.Types.ObjectId(), version = randomUUID();
    return Document.create({ _id: id, user: user._id, title: 'Text PDF', filename: 'study.pdf', status: 'uploaded',
      expectedBytes: 100, maxBytes: 1000, byteCount: 100, pageCount: 2,
      uploadKey: `pending/${user._id}/${id}/upload.pdf`, objectKey: `documents/${user._id}/${id}/snapshot.pdf`,
      sourceVersion: version, sha256: 'a'.repeat(64), uploadExpiresAt: new Date(now.getTime() - 60000), finalizeUntil: now,
      indexing: createIndexingJob(user._id, version, now) });
  }
  function manifest(claim, text = 'Cells contain mitochondria.') {
    const passages = [{ text, citation: { chunk_id: 'chunk-' + 'b'.repeat(64), source: structuredClone(claim.snapshot.source),
      locator: claim.job.source_type === 'note' ? 'paragraph 2' : 'page 1',
      page_start: claim.job.source_type === 'note' ? null : 1, page_end: null } }];
    return { lease_token: claim.lease.token, generation_id: claim.snapshot.source.index_generation,
      source_sha256: claim.snapshot.sha256, passages, manifest_digest: passageDigest(passages), pages_without_text: [],
      report: { job_id: claim.job.job_id, document_id: claim.job.document_id, source_version: claim.job.source_version,
        status: 'ready', expected_chunks: 1, indexed_chunks: 1, embedding_model: 'test-model', index_version: 'test-index' } };
  }
  const ack = (claim, body) => jobs.complete(claim.job.job_id, body);
  const lookup = (claim, owner = user._id) => jobs.passages({ context: { ...claim.context, user_id: String(owner) }, chunk_ids: ['chunk-' + 'b'.repeat(64)] });

  it('publishes canonical passages atomically and acknowledges a lost response after lease expiry', async () => {
    const doc = await pdf(), claim = await jobs.claim(), body = manifest(claim);
    expect(await lookup(claim)).to.deep.equal({ passages: [] });
    expect((await ack(claim, body)).disposition).to.equal('applied');
    const saved = await Document.findById(doc._id).lean();
    expect(saved.indexing).to.include({ status: 'ready', indexedChunks: 1, activeGeneration: body.generation_id });
    expect(saved.indexing.leaseToken).to.equal(null);
    now = new Date(now.getTime() + INDEXING_LEASE_MS * 5);
    expect((await ack(claim, body)).disposition).to.equal('duplicate');
    expect((await lookup(claim)).passages).to.deep.equal(body.passages);
    expect((await lookup(claim, other._id)).passages).to.deep.equal([]);
    const status = await jobs.status(user._id, doc._id);
    expect(JSON.stringify(status)).not.to.match(/lease|chunk-|generation|Cells contain/);
  });

  it('rejects incomplete counts, corrupt manifests, citations, model mismatches and untrusted text', async () => {
    const doc = await pdf(), claim = await jobs.claim();
    for (const mutate of [b => b.report.indexed_chunks = 0, b => b.manifest_digest = 'bad',
      b => b.passages[0].citation.source.source_id = String(other._id), b => b.passages[0].citation.page_start = 9,
      b => b.source_sha256 = 'b'.repeat(64), b => b.passages.push(b.passages[0]), b => b.extra = true]) {
      const body = manifest(claim); mutate(body);
      try { await ack(claim, body); throw new Error('Accepted invalid manifest'); }
      catch (error) { expect(error.status).to.equal(422); }
    }
    const wrongModel = manifest(claim); wrongModel.report.embedding_model = 'other-model';
    try { await ack(claim, wrongModel); throw new Error('Accepted wrong model'); } catch (e) { expect(e.status).to.equal(409); }
    expect((await Document.findById(doc._id)).indexing.status).to.equal('processing');
  });

  it('fences old generations, ownership changes, and deletion without blocking outbox replay', async () => {
    const doc = await pdf(), first = await jobs.claim();
    now = new Date(now.getTime() + INDEXING_LEASE_MS + 1);
    const second = await jobs.claim();
    expect(second.snapshot.source.index_generation).not.to.equal(first.snapshot.source.index_generation);
    expect((await ack(first, manifest(first))).disposition).to.equal('stale');
    expect((await ack(second, manifest(second))).disposition).to.equal('applied');
    await Document.updateOne({ _id: doc._id }, { user: other._id });
    expect((await lookup(second)).passages).to.deep.equal([]);
    expect((await ack(second, manifest(second))).disposition).to.equal('stale');
    await Document.updateOne({ _id: doc._id }, { user: user._id, status: 'deleted' });
    expect((await lookup(second)).passages).to.deep.equal([]);
  });

  it('indexes saved notes and requeues only text edits while preserving book/course links', async () => {
    const course = await Course.create({ user: user._id, title: 'Biology' });
    const book = await Book.create({ user: user._id, title: 'Cells', author: 'Author', category: 'Science', courses: [course._id] });
    const created = (await agent.post('/api/notes').send({ title: 'Cell notes', content: 'Cells contain mitochondria.', book: String(book._id), courses: [String(course._id)] }).expect(201)).body.note;
    expect(created).not.to.have.property('indexing'); expect(created).not.to.have.property('sourceVersion');
    now = new Date(Date.now() + 1000);
    const claim = await jobs.claim(), body = manifest(claim);
    expect(claim.job.source_type).to.equal('note');
    const source = await jobs.source(claim.job.job_id, claim.lease.token);
    expect(source.sha256).to.equal(textDigest(noteSourceText(created)));
    expect(source.text).to.contain('Cell notes');
    expect((await ack(claim, body)).disposition).to.equal('applied');
    await agent.patch(`/api/notes/${created._id}`).send({ courses: [] }).expect(200);
    expect((await lookup(claim)).passages).to.have.length(1);
    const changed = (await agent.patch(`/api/notes/${created._id}`).send({ content: 'A nucleus contains DNA.' }).expect(200)).body.note;
    expect(changed.book).to.equal(String(book._id)); expect(changed.courses).to.deep.equal([]);
    expect((await lookup(claim)).passages).to.have.length(0);
    expect((await ack(claim, body)).disposition).to.equal('stale');
    now = new Date(Date.now() + 2000);
    const next = await jobs.claim();
    expect(next.job.source_version).not.to.equal(claim.job.source_version);
    const fake = manifest(next, 'Invented note text');
    try { await ack(next, fake); throw new Error('Accepted invented passage'); } catch (e) { expect(e.status).to.equal(422); }
    await agent.delete(`/api/notes/${created._id}`).expect(204);
    await agent.get(`/api/notes/${created._id}`).expect(404);
    expect((await agent.get('/api/notes').expect(200)).body.notes).to.deep.equal([]);
    expect(await Note.countDocuments({ user: user._id })).to.equal(0);
    expect((await ack(next, manifest(next, 'A nucleus contains DNA.'))).disposition).to.equal('stale');
  });

  it('backfills legacy notes, requeues model changes, and ignores storage reconciliation outages', async () => {
    const doc = await pdf(), claim = await jobs.claim(); await ack(claim, manifest(claim));
    const noteId = new mongoose.Types.ObjectId();
    await Note.collection.insertOne({ _id: noteId, user: user._id, title: 'Legacy note', content: 'Saved before indexing', courses: [] });
    storage.list = async () => { throw new Error('private R2 failure'); };
    expect((await jobs.maintenance.prepare('next-model')).queued).to.equal(2);
    expect((await jobs.claim()).job.source_type).to.equal('note');
    expect((await Document.findById(doc._id)).indexing.status).to.equal('queued');
    const legacy = await Note.findById(noteId).select('+sourceVersion +indexing');
    expect(legacy.sourceVersion).to.be.a('string');
  });

  it('requeues missing index data and fences delayed audits after a new publication', async () => {
    const doc = await pdf(), claim = await jobs.claim();
    await ack(claim, manifest(claim));
    const [candidate] = (await jobs.maintenance.auditCandidates('test-model')).sources;
    expect(candidate.chunk_ids).to.deep.equal(['chunk-' + 'b'.repeat(64)]);
    const identity = { ...candidate }; delete identity.chunk_ids; delete identity.manifest_digest;
    expect((await jobs.maintenance.auditResult({ ...identity, available: true })).disposition).to.equal('applied');
    expect((await jobs.maintenance.auditResult({ ...identity, available: false })).disposition).to.equal('applied');
    expect((await Document.findById(doc._id)).indexing.status).to.equal('queued');
    expect((await lookup(claim)).passages).to.have.length(0);
    const replacement = await jobs.claim();
    await ack(replacement, manifest(replacement));
    expect((await jobs.maintenance.auditResult({ ...identity, available: false })).disposition).to.equal('stale');
    expect((await Document.findById(doc._id)).indexing.status).to.equal('ready');
  });

  it('retains deletion tombstones until safe R2 and Chroma cleanup, including expired intents', async () => {
    const doc = await pdf();
    const recent = new Date(now.getTime() + 60000);
    await Document.updateOne({ _id: doc._id }, { status: 'deleted', uploadExpiresAt: recent });
    expect(await jobs.maintenance.claimCleanup()).to.equal(null);
    now = new Date(recent.getTime() + 30001);
    const cleanup = await jobs.maintenance.claimCleanup();
    expect(cleanup.source_id).to.equal(String(doc._id));
    expect(await jobs.maintenance.claimCleanup()).to.equal(null);
    expect((await jobs.maintenance.finishCleanup({ ...cleanup, cleanup_token: randomUUID() })).disposition).to.equal('stale');
    storage.objects = [{ key: `documents/${user._id}/${doc._id}/orphan.pdf`, modifiedAt: now }];
    expect((await jobs.maintenance.finishCleanup(cleanup)).disposition).to.equal('applied');
    expect(await Document.findById(doc._id)).to.equal(null);
    expect(storage.removed).to.include.members([doc.uploadKey, doc.objectKey, storage.objects[0].key]);
    const expired = await pdf();
    await Document.updateOne({ _id: expired._id }, { status: 'awaiting_upload', finalizeUntil: new Date(now.getTime() - 1) });
    await jobs.maintenance.prepare('test-model');
    expect((await Document.findById(expired._id)).status).to.equal('deleting');
  });

  it('cleans expired temporary and orphan snapshot objects after a rejected upload', async () => {
    const doc = await pdf();
    await Document.updateOne({ _id: doc._id }, { status: 'failed', objectKey: null });
    storage.objects = [doc.uploadKey, doc.objectKey].map(key => ({ key, modifiedAt: new Date(now.getTime() - INDEXING_LEASE_MS * 3) }));
    await jobs.maintenance.prepare('test-model');
    expect(storage.removed).to.have.members([doc.uploadKey, doc.objectKey]);
    expect((await Document.findById(doc._id)).status).to.equal('failed');
  });

  it('reconciles only obsolete vectors and old objects within known source prefixes', async () => {
    const doc = await pdf(), claim = await jobs.claim();
    const record = { ...claim.snapshot.source, user_id: String(user._id), generation_id: claim.snapshot.source.index_generation, embedding_model: 'test-model' };
    expect((await jobs.maintenance.check([record])).stale).to.deep.equal([]);
    expect((await jobs.maintenance.check([{ ...record, generation_id: randomUUID() }, { ...record, user_id: String(other._id) }])).stale).to.deep.equal([0, 1]);
    const orphan = `documents/${user._id}/${doc._id}/orphan.pdf`, foreign = `documents/${other._id}/foreign.pdf`;
    storage.objects = [doc.objectKey, orphan, foreign].map(key => ({ key, modifiedAt: new Date(now.getTime() - INDEXING_LEASE_MS * 3) }));
    await jobs.maintenance.prepare('test-model');
    expect(storage.removed).to.deep.equal([orphan]);
    await ack(claim, manifest(claim));
    expect((await jobs.maintenance.check([record])).stale).to.deep.equal([]);
    await Document.updateOne({ _id: doc._id }, { sourceVersion: randomUUID() });
    expect((await jobs.maintenance.check([record])).stale).to.deep.equal([0]);
  });
});
