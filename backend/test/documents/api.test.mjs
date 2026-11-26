import { expect } from 'chai';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import { createApp } from '../../src/app.mjs';
import { User, Course, Book, Note, Document } from '../../src/db.mjs';
import { DocumentRepository } from '../../src/documents/repository.mjs';
import { DocumentService, VALIDATION_LEASE_MS } from '../../src/documents/service.mjs';
import { DocumentError } from '../../src/documents/errors.mjs';

const integration = process.env.TEST_DSN ? describe : describe.skip;
const bytes = Buffer.from('%PDF-test-private-document');
const digest = data => createHash('sha256').update(data).digest('hex');

integration('Document uploads with MongoDB and Passport (requires TEST_DSN)', () => {
  let alice;
  let bob;
  let aliceId;
  let bobId;
  let storage;
  let inspector;
  let repository;
  let now;

  before(async () => {
    if (!new URL(process.env.TEST_DSN).pathname.endsWith('_test')) { throw new Error('TEST_DSN must end in _test.'); }
    await mongoose.connect(process.env.TEST_DSN);
    await Promise.all([User.init(), Course.init(), Book.init(), Note.init(), Document.init()]);
  });
  after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Course.deleteMany({}), Book.deleteMany({}), Note.deleteMany({}), Document.deleteMany({})]);
    const password = await bcrypt.hash('test-password123', 4);
    [aliceId, bobId] = (await User.create([
      { username: 'alice', email: 'alice@example.com', password },
      { username: 'bob', email: 'bob@example.com', password },
    ])).map(user => user._id);
    now = new Date('2026-11-24T12:00:00Z');
    repository = new DocumentRepository();
    storage = {
      objects: new Map(), signed: [], puts: [], removals: [],
      async signUpload(key, byteCount, expiresIn) {
        this.signed.push({ key, byteCount, expiresIn });
        return `https://upload.example/${encodeURIComponent(key)}?signature=test-only`;
      },
      async download(key, { maxBytes, expectedBytes }) {
        const object = this.objects.get(key);
        if (!object) { throw new DocumentError(409, 'upload_not_found', 'Finish uploading first.'); }
        if (object.length > maxBytes || object.length !== expectedBytes) {
          throw new DocumentError(422, 'upload_size_mismatch', 'Uploaded size mismatch.');
        }
        return Buffer.from(object);
      },
      async putValidated(key, data) { this.objects.set(key, Buffer.from(data)); this.puts.push(key); },
      async signDownload(key) { return `https://read.example/${encodeURIComponent(key)}?signature=test-only`; },
      async remove(key) { this.objects.delete(key); this.removals.push(key); },
    };
    inspector = {
      count: 0,
      async policy() { return { maxPages: 5, maxBytes: 10000 }; },
      async inspect(data) { this.count++; return { pageCount: 2, byteCount: data.length, sha256: digest(data) }; },
    };
    const service = new DocumentService({ repository, storage, inspector, clock: () => now });
    const app = createApp({ documentService: service });
    alice = request.agent(app);
    bob = request.agent(app);
    await alice.post('/api/auth/login').send({ username: 'alice', password: 'test-password123' }).expect(200);
    await bob.post('/api/auth/login').send({ username: 'bob', password: 'test-password123' }).expect(200);
  });

  async function begin(extra = {}, agent = alice) {
    return (await agent.post('/api/documents/uploads').send({ filename: 'Lecture.pdf', byteCount: bytes.length, ...extra }).expect(201)).body;
  }
  async function upload(documentId) {
    const document = await Document.findById(documentId).lean();
    storage.objects.set(document.uploadKey, Buffer.from(bytes));
    return document;
  }

  it('creates a standalone owned intent and a scoped temporary upload URL', async () => {
    const result = await begin();
    expect(result.document).to.include({ status: 'awaiting_upload', title: 'Lecture', book: null, note: null });
    expect(result.document.courses).to.deep.equal([]);
    expect(result.upload).to.include({ method: 'PUT' });
    expect(result.upload.headers).to.deep.equal({ 'Content-Type': 'application/pdf' });
    const saved = await Document.findById(result.document._id).lean();
    expect(String(saved.user)).to.equal(String(aliceId));
    expect(saved.uploadKey).to.match(new RegExp(`^pending/${aliceId}/${saved._id}/`));
    expect(storage.signed[0]).to.include({ byteCount: bytes.length, expiresIn: 300 });
    expect(result.document).not.to.have.any.keys('uploadKey', 'objectKey', 'validationToken', 'user', 'sha256');
  });

  it('links only owned courses, books and notes', async () => {
    const course = await Course.create({ title: 'Biology', user: aliceId });
    const book = await Book.create({ title: 'Textbook', author: 'Author', category: 'Biology', user: aliceId });
    const note = await Note.create({ title: 'Lecture', content: 'Private text', user: aliceId });
    const result = await begin({ courses: [String(course._id)], book: String(book._id), note: String(note._id) });
    expect(result.document.courses).to.deep.equal([String(course._id)]);
    expect(result.document.book).to.equal(String(book._id));
    expect(result.document.note).to.equal(String(note._id));
    const foreignCourse = await Course.create({ title: 'Foreign', user: bobId });
    const foreignBook = await Book.create({ title: 'Foreign', author: 'Author', category: 'Private', user: bobId });
    const foreignNote = await Note.create({ title: 'Foreign', content: 'Private', user: bobId });
    for (const association of [{ courses: [String(foreignCourse._id)] }, { book: String(foreignBook._id) }, { note: String(foreignNote._id) }]) {
      await alice.post('/api/documents/uploads').send({ filename: 'file.pdf', byteCount: 10, ...association }).expect(400);
    }
    expect(storage.signed).to.have.length(1);
  });

  it('rejects identity, storage-key, status and malformed input claims before signing', async () => {
    for (const changes of [
      { user: String(bobId) }, { objectKey: 'foreign/file' }, { uploadKey: 'foreign/file' }, { status: 'uploaded' },
      { filename: '../file.pdf' }, { filename: 'lecture.txt' }, { byteCount: '123' }, { byteCount: 0 }, { title: ' ' },
    ]) {
      await alice.post('/api/documents/uploads').send({ filename: 'file.pdf', byteCount: 10, ...changes }).expect(400);
    }
    await alice.post('/api/documents/uploads').send({ filename: 'file.pdf', byteCount: 10001 }).expect(413);
    expect(storage.signed).to.have.length(0);
    expect(await Document.countDocuments()).to.equal(0);
  });

  it('persists only exact inspected bytes as uploaded, without claiming index readiness', async () => {
    const result = await begin();
    const pending = await upload(result.document._id);
    const completed = await alice.post(`/api/documents/${pending._id}/complete`).send({}).expect(200);
    expect(completed.body.document).to.include({ status: 'uploaded', pageCount: 2, byteCount: bytes.length });
    expect(completed.body.document.sourceVersion).to.be.a('string');
    const saved = await Document.findById(pending._id).lean();
    expect(saved.sha256).to.equal(digest(bytes));
    expect(saved.objectKey).to.match(new RegExp(`^documents/${aliceId}/${pending._id}/`));
    expect(saved.objectKey).not.to.equal(pending.uploadKey);
    expect(storage.objects.get(saved.objectKey).equals(bytes)).to.equal(true);
    expect(storage.removals).to.include(pending.uploadKey);
    expect(saved.validationToken).to.equal(null);
  });

  it('keeps the approved snapshot stable if the browser replaces its temporary upload', async () => {
    const result = await begin();
    const pending = await upload(result.document._id);
    const originalInspect = inspector.inspect.bind(inspector);
    inspector.inspect = async data => {
      storage.objects.set(pending.uploadKey, Buffer.from('malicious replacement'));
      return originalInspect(data);
    };
    await alice.post(`/api/documents/${pending._id}/complete`).send({}).expect(200);
    const saved = await Document.findById(pending._id).lean();
    expect(storage.objects.get(saved.objectKey).equals(bytes)).to.equal(true);
    storage.objects.set(pending.uploadKey, Buffer.from('replayed upload URL'));
    expect(storage.objects.get(saved.objectKey).equals(bytes)).to.equal(true);
  });

  it('makes completion retries idempotent', async () => {
    const result = await begin();
    await upload(result.document._id);
    const first = await alice.post(`/api/documents/${result.document._id}/complete`).send({}).expect(200);
    const second = await alice.post(`/api/documents/${result.document._id}/complete`).send({}).expect(200);
    expect(second.body).to.deep.equal(first.body);
    expect(inspector.count).to.equal(1);
    expect(storage.puts).to.have.length(1);
  });

  it('prevents other users from reading, finalizing or listing the document', async () => {
    const result = await begin();
    await bob.get(`/api/documents/${result.document._id}`).expect(404);
    await bob.post(`/api/documents/${result.document._id}/complete`).send({}).expect(404);
    expect((await bob.get('/api/documents').expect(200)).body.documents).to.deep.equal([]);
    const list = await alice.get('/api/documents').expect(200);
    expect(list.body.documents).to.have.length(1);
    expect(list.body.documents[0]).not.to.have.any.keys('uploadKey', 'objectKey', 'validationToken', 'maxBytes');
  });

  it('rejects finalization payloads that supply a key or identity', async () => {
    const result = await begin();
    await alice.post(`/api/documents/${result.document._id}/complete`).send({ objectKey: 'foreign/key' }).expect(400);
    expect((await Document.findById(result.document._id)).status).to.equal('awaiting_upload');
    await alice.get('/api/documents/invalid-id').expect(400);
  });

  it('paginates owned documents without losing older records or accepting injected cursors', async () => {
    const result = await begin();
    const template = await Document.findById(result.document._id).lean();
    await Document.insertMany(Array.from({ length: 51 }, () => ({ ...template, _id: new mongoose.Types.ObjectId() })));
    const first = (await alice.get('/api/documents').expect(200)).body;
    expect(first.documents).to.have.length(50);
    expect(first.nextCursor).to.be.a('string');
    const second = (await alice.get(`/api/documents?before=${first.nextCursor}`).expect(200)).body;
    expect(second.documents).to.have.length(2);
    expect(second.nextCursor).to.equal(null);
    expect(new Set([...first.documents, ...second.documents].map(doc => doc._id)).size).to.equal(52);
    await alice.get('/api/documents?before=invalid').expect(400);
    await alice.get('/api/documents?before=one&before=two').expect(400);
    expect((await bob.get('/api/documents?before[$ne]=null').expect(200)).body.documents).to.deep.equal([]);
    expect((await bob.get('/api/documents').expect(200)).body.documents).to.deep.equal([]);
  });

  it('allows retry after upload-not-found or temporary validation failure', async () => {
    const result = await begin();
    await alice.post(`/api/documents/${result.document._id}/complete`).send({}).expect(409);
    expect((await Document.findById(result.document._id)).status).to.equal('awaiting_upload');
    await upload(result.document._id);
    const originalInspect = inspector.inspect.bind(inspector);
    inspector.inspect = async () => { throw new DocumentError(503, 'validation_unavailable', 'Try again.'); };
    await alice.post(`/api/documents/${result.document._id}/complete`).send({}).expect(503);
    expect((await Document.findById(result.document._id)).status).to.equal('awaiting_upload');
    inspector.inspect = originalInspect;
    await alice.post(`/api/documents/${result.document._id}/complete`).send({}).expect(200);
  });

  it('persists PDF rejection without saving a final object', async () => {
    const result = await begin();
    await upload(result.document._id);
    inspector.inspect = async () => { throw new DocumentError(422, 'pdf_page_limit_exceeded', 'Too many pages.'); };
    await alice.post(`/api/documents/${result.document._id}/complete`).send({}).expect(422);
    const saved = await Document.findById(result.document._id).lean();
    expect(saved.status).to.equal('failed');
    expect(saved.error.code).to.equal('pdf_page_limit_exceeded');
    expect(saved.objectKey).to.equal(null);
    expect(storage.puts).to.have.length(0);
    await alice.post(`/api/documents/${result.document._id}/complete`).send({}).expect(422);
  });

  it('serializes concurrent finalization and recovers expired validation leases', async () => {
    const result = await begin();
    await upload(result.document._id);
    let notifyStarted;
    let finish;
    const started = new Promise(resolve => { notifyStarted = resolve; });
    const blocked = new Promise(resolve => { finish = resolve; });
    const originalInspect = inspector.inspect.bind(inspector);
    inspector.inspect = async data => { notifyStarted(); await blocked; return originalInspect(data); };
    const first = alice.post(`/api/documents/${result.document._id}/complete`).send({}).then(response => response);
    await started;
    const concurrent = await alice.post(`/api/documents/${result.document._id}/complete`).send({}).expect(409);
    expect(concurrent.body.code).to.equal('validation_in_progress');
    // Simulate the lease expiring while an old worker is still alive.
    now = new Date(now.getTime() + VALIDATION_LEASE_MS + 1);
    inspector.inspect = originalInspect;
    await alice.post(`/api/documents/${result.document._id}/complete`).send({}).expect(200);
    finish();
    expect((await first).status).to.equal(409);
    const saved = await Document.findById(result.document._id).lean();
    expect(storage.objects.has(saved.objectKey)).to.equal(true);
    expect(storage.objects.size).to.equal(1);
  });

  it('rejects expired intents', async () => {
    const result = await begin();
    now = new Date(now.getTime() + 21 * 60 * 1000);
    const response = await alice.post(`/api/documents/${result.document._id}/complete`).send({}).expect(410);
    expect(response.body.code).to.equal('upload_expired');
  });

  it('returns only current owned material metadata for upload choices', async () => {
    await Course.create([{ title: 'Owned course', user: aliceId }, { title: 'Private course', user: bobId }]);
    await Note.create([{ title: 'Owned note', content: 'private-text-not-needed-by-the-picker', user: aliceId }, { title: 'Foreign note', content: 'Private', user: bobId }]);
    const result = (await alice.get('/api/documents/options').expect(200)).body;
    expect(result.courses.map(item => item.title)).to.deep.equal(['Owned course']);
    expect(result.notes.map(item => item.title)).to.deep.equal(['Owned note']);
    expect(result.notes[0]).not.to.have.any.keys('content', 'contentHtml', 'user');
  });

  it('filters by course, book and note including inherited links and rejects foreign scopes', async () => {
    const course = await Course.create({ title: 'Biology', user: aliceId });
    const foreign = await Course.create({ title: 'Foreign', user: bobId });
    const book = await Book.create({ title: 'Textbook', author: 'Author', category: 'Biology', user: aliceId, courses: [course._id] });
    const note = await Note.create({ title: 'Lecture', content: 'Idea', user: aliceId, book: book._id });
    const connected = await begin({ note: String(note._id), title: 'Cells [draft]' });
    await begin({ title: 'Independent handout' });
    for (const filter of [`course=${course._id}`, `book=${book._id}`, `note=${note._id}`, 'q=%5Bdraft%5D']) {
      const result = await alice.get(`/api/documents?${filter}`).expect(200);
      expect(result.body.documents.map(item => item._id)).to.deep.equal([connected.document._id]);
    }
    await alice.get(`/api/documents?course=${foreign._id}`).expect(404);
    await alice.get('/api/documents?course=invalid').expect(400);
    expect((await alice.get('/api/documents?q=.*').expect(200)).body.documents).to.deep.equal([]);
    await alice.get('/api/documents?status=unknown').expect(400);
  });

  it('issues read links only for an owned saved PDF', async () => {
    const result = await begin();
    await alice.get(`/api/documents/${result.document._id}/file`).expect(409);
    await upload(result.document._id);
    await alice.post(`/api/documents/${result.document._id}/complete`).send({}).expect(200);
    await bob.get(`/api/documents/${result.document._id}/file`).expect(404);
    const opened = await alice.get(`/api/documents/${result.document._id}/file`).expect(302);
    expect(opened.headers.location).to.match(/^https:\/\/read\.example\//);
    expect(opened.headers['cache-control']).to.equal('no-store');
    expect((await alice.get('/api/documents?status=saved').expect(200)).body.documents).to.have.length(1);
  });

  it('removes only an owned document and its R2 objects', async () => {
    const result = await begin(); await upload(result.document._id);
    await alice.post(`/api/documents/${result.document._id}/complete`).send({}).expect(200);
    await bob.delete(`/api/documents/${result.document._id}`).expect(404);
    expect(storage.objects.size).to.equal(1);
    await alice.delete(`/api/documents/${result.document._id}`).expect(204);
    expect(await Document.findById(result.document._id)).to.equal(null);
    expect(storage.objects.size).to.equal(0);
  });

  it('revokes file access during failed cleanup and allows removal to be retried', async () => {
    const result = await begin(); await upload(result.document._id);
    await alice.post(`/api/documents/${result.document._id}/complete`).send({}).expect(200);
    const remove = storage.remove.bind(storage);
    storage.remove = async () => { throw new DocumentError(503, 'storage_unavailable', 'Try again.'); };
    await alice.delete(`/api/documents/${result.document._id}`).expect(503);
    expect((await Document.findById(result.document._id)).status).to.equal('deleting');
    await alice.get(`/api/documents/${result.document._id}/file`).expect(409);
    storage.remove = remove;
    await alice.delete(`/api/documents/${result.document._id}`).expect(204);
    expect(storage.objects.size).to.equal(0);
  });

  it('prevents an in-flight validator from restoring a removed document', async () => {
    const result = await begin(); await upload(result.document._id);
    let notify;
    let finish;
    const started = new Promise(resolve => { notify = resolve; });
    const blocked = new Promise(resolve => { finish = resolve; });
    const inspect = inspector.inspect.bind(inspector);
    inspector.inspect = async data => { notify(); await blocked; return inspect(data); };
    const pending = alice.post(`/api/documents/${result.document._id}/complete`).send({}).then(value => value);
    await started;
    await alice.delete(`/api/documents/${result.document._id}`).expect(204);
    finish();
    expect((await pending).status).to.equal(409);
    expect(await Document.findById(result.document._id)).to.equal(null);
    expect(storage.objects.size).to.equal(0);
  });

  it('does not remove a committed snapshot if the MongoDB acknowledgement is lost', async () => {
    const result = await begin();
    await upload(result.document._id);
    const finalize = repository.finalize.bind(repository);
    repository.finalize = async (...args) => { await finalize(...args); throw new Error('Database acknowledgement lost'); };
    await alice.post(`/api/documents/${result.document._id}/complete`).send({}).expect(503);
    const saved = await Document.findById(result.document._id).lean();
    expect(saved.status).to.equal('uploaded');
    expect(storage.objects.has(saved.objectKey)).to.equal(true);
    await alice.post(`/api/documents/${result.document._id}/complete`).send({}).expect(200);
  });
});
