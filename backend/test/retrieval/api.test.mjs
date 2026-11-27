import { expect } from 'chai';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../src/app.mjs';
import { User, Course, Book, Note, Document } from '../../src/db.mjs';
import { StudyScopeResolver } from '../../src/retrieval/scope.mjs';
import { StudySearchService, parseSearch } from '../../src/retrieval/service.mjs';
import { AiRetrievalClient } from '../../src/integrations/ai-retrieval.mjs';
import { createIndexingJob } from '../../src/documents/indexing-policy.mjs';

const token = 'retrieval-test-' + 'x'.repeat(40), auth = { Authorization: `Bearer ${token}` };
const integration = process.env.TEST_DSN ? describe : describe.skip;

describe('Study search boundaries without a database', () => {
  it('requires Passport publicly and service authentication before internal body parsing', async () => {
    const app = createApp({ internalServiceToken: token });
    await request(app).post('/api/study/search').send({}).expect(401);
    for (const endpoint of ['context', 'passages']) {
      await request(app).post(`/internal/retrieval/${endpoint}`).set('Content-Type', 'application/json').send('{private-invalid').expect(401);
      await request(app).post(`/internal/retrieval/${endpoint}`).set(auth).type('text').send('{}').expect(415);
    }
    await request(app).post('/api/study/search').set('Origin', 'https://untrusted.example').send({}).expect(403);
  });
  it('rejects identity overrides, ambiguous broadening, injection and invalid bounds', () => {
    for (const body of [{ query: 'Question', scope: {}, context: {} }, { query: 'Question', scope: { user_id: 'forged' } },
      { query: 'Question', scope: { library: true, notes: ['a'.repeat(24)] } }, { query: 'Question', scope: { notes: [{ $ne: null }] } },
      { query: 'Question', scope: {}, limit: true }, { query: 'Question', scope: {}, limit: 13 }, { query: 'x'.repeat(2001), scope: {} },
      { query: 'Question' }, { query: 'Question', scope: { notes: ['a'.repeat(24)].flatMap(id => Array(21).fill(id)) } }]) {
      expect(() => parseSearch(body)).to.throw();
    }
    expect(parseSearch({ query: ' Energy? ', scope: {} })).to.include({ query: 'Energy?', limit: 6 });
  });
  it('bounds AI responses, authenticates requests, disables redirects and hides upstream details', async () => {
    let call;
    const client = new AiRetrievalClient({ baseUrl: 'http://127.0.0.1:8001', token, fetchImpl: async (url, options) => {
      call = { url, options }; return Response.json({ query: 'Energy?', passages: [] });
    } });
    await client.search({ query: 'Energy?' });
    expect(call.url.pathname).to.equal('/internal/retrieval/search');
    expect(call.options.redirect).to.equal('error');
    expect(call.options.headers.Authorization).to.equal(`Bearer ${token}`);
    for (const fake of [() => Response.json({ error: { message: 'private-material' } }, { status: 500 }),
      () => new Response('private-invalid'), () => new Response('x'.repeat(1024 * 1024 + 1))]) {
      try { await new AiRetrievalClient({ baseUrl: 'http://127.0.0.1:8001', token, fetchImpl: fake }).search({}); throw new Error('Expected failure'); }
      catch (error) { expect(error.code).to.equal('retrieval_unavailable'); expect(error.message).not.to.contain('private'); }
    }
  });
});

integration('Current authorized study retrieval with MongoDB (requires TEST_DSN)', () => {
  let user, other, resolver, service, agent, app;
  const profile = async () => ({ embedding_model: 'test-model', index_version: 'test-index' });
  before(async () => {
    if (!new URL(process.env.TEST_DSN).pathname.endsWith('_test')) { throw new Error('Use a disposable TEST_DSN.'); }
    await mongoose.connect(process.env.TEST_DSN);
  });
  after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
  beforeEach(async () => {
    await Promise.all([User, Course, Book, Note, Document].map(model => model.deleteMany({})));
    const password = await bcrypt.hash('test-password123', 4);
    [user, other] = await User.create([{ username: 'search-student', email: 'student@example.test', password }, { username: 'search-other', email: 'other@example.test', password }]);
    resolver = new StudyScopeResolver({ profile });
    const client = { async search(body) {
      const ref = body.context.scope.sources[0];
      const model = ref.source_type === 'note' ? Note : Document;
      const row = await model.findById(ref.source_id).select('+indexing');
      return { query: body.query, passages: row.indexing.passages };
    } };
    service = new StudySearchService({ resolver, client });
    app = createApp({ studySearchService: service, internalServiceToken: token });
    agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username: user.username, password: 'test-password123' }).expect(200);
  });
  async function publish(model, fields = {}) {
    const row = model === Note ? await Note.create({ user: user._id, title: 'Cell note', content: 'Mitochondria supply ATP.', ...fields })
      : await Document.create({ user: user._id, title: 'Cell PDF', filename: 'cells.pdf', status: 'uploaded', expectedBytes: 100, maxBytes: 1000,
        uploadKey: 'pending/test', objectKey: 'documents/test', uploadExpiresAt: new Date(), finalizeUntil: new Date(), sourceVersion: randomUUID(), ...fields });
    const version = row.sourceVersion, generation = randomUUID();
    const ref = { source_id: String(row._id), source_type: model === Note ? 'note' : 'document', source_version: version, index_generation: generation };
    const passage = { text: model === Note ? row.content : 'Mitochondria provide ATP.', citation: { chunk_id: 'chunk-' + String(row._id).padEnd(64, 'a'), source: ref,
      locator: model === Note ? 'paragraph 2' : 'page 1', page_start: model === Note ? null : 1, page_end: null } };
    await model.updateOne({ _id: row._id }, { indexing: { ...createIndexingJob(row.user, version, new Date()), status: 'ready', activeGeneration: generation,
      embeddingModel: 'test-model', indexVersion: 'test-index', passages: [passage] } });
    return { row, ref, passage };
  }
  function search(scope, query = 'Energy?') { return agent.post('/api/study/search').send({ query, scope }); }

  it('returns canonical note text, citations and owned navigation links', async () => {
    const { row, ref, passage } = await publish(Note);
    const response = await search({ notes: [String(row._id)] }).expect(200);
    expect(response.headers['cache-control']).to.equal('no-store');
    expect(response.body.passages).to.deep.equal([passage]);
    expect(response.body.sources[0]).to.include({ ...ref, title: row.title, href: `/notes/${row._id}` });
    expect(response.text).not.to.match(/leaseToken|objectKey|storage_key/);
  });
  it('uses the union of selected materials and current inherited course/book relationships', async () => {
    const course = await Course.create({ user: user._id, title: 'Biology' });
    const book = await Book.create({ user: user._id, title: 'Cells', author: 'Author', category: 'Science', courses: [course._id] });
    const linked = await publish(Note, { book: book._id });
    const direct = await publish(Note, { courses: [course._id] });
    const pdf = await publish(Document, { note: linked.row._id });
    const standalone = await publish(Document);
    await publish(Note, { user: other._id, book: book._id, courses: [course._id] });
    const scoped = await resolver.resolve(user._id, { courses: [String(course._id)] });
    expect(scoped.sources.map(ref => ref.source_id)).to.have.members([linked.ref.source_id, direct.ref.source_id, pdf.ref.source_id]);
    const mixed = await resolver.resolve(user._id, { books: [String(book._id)], documents: [standalone.ref.source_id] });
    expect(mixed.sources.map(ref => ref.source_id)).to.have.members([linked.ref.source_id, pdf.ref.source_id, standalone.ref.source_id]);
    const onlyPdf = await resolver.resolve(user._id, { documents: [pdf.ref.source_id] });
    expect(onlyPdf.sources.map(ref => ref.source_id)).to.deep.equal([pdf.ref.source_id]);
  });
  it('keeps empty/unfinished scopes empty, and requires explicit library search', async () => {
    const { row } = await publish(Note);
    expect((await search({}).expect(200)).body.passages).to.deep.equal([]);
    expect((await search({ library: true }).expect(200)).body.passages).to.have.length(1);
    await Note.updateOne({ _id: row._id }, { 'indexing.status': 'queued' });
    expect((await search({ notes: [String(row._id)] }).expect(200)).body.passages).to.deep.equal([]);
  });
  it('rejects inaccessible selections without revealing whether foreign materials exist', async () => {
    const foreign = await publish(Note, { user: other._id });
    const missing = new mongoose.Types.ObjectId();
    const first = await search({ notes: [foreign.ref.source_id] }).expect(404);
    const second = await search({ notes: [String(missing)] }).expect(404);
    expect(first.body).to.deep.equal(second.body);
    await request(app).post('/internal/retrieval/context').set(auth).send({ context: { user_id: String(user._id), run_id: 'test', scope: { scope_id: 'scope', sources: [foreign.ref] } } }).expect(200).then(response => expect(response.body.context.scope.sources).to.deep.equal([]));
  });
  it('does not trust vector/AI text and revalidates ownership and scope after the remote search', async () => {
    const { row, passage } = await publish(Note);
    service.client.search = async body => ({ query: body.query, passages: [{ ...passage, text: 'Untrusted replacement text' }] });
    expect((await search({ notes: [String(row._id)] }).expect(200)).body.passages[0].text).to.equal(passage.text);
    service.client.search = async body => { await Note.updateOne({ _id: row._id }, { user: other._id }); return { query: body.query, passages: [passage] }; };
    expect((await search({ notes: [String(row._id)] }).expect(200)).body.passages).to.deep.equal([]);
  });
  it('ignores identity headers and excludes a source indexed with an obsolete model', async () => {
    const { row } = await publish(Note);
    const response = await agent.post('/api/study/search').set('X-User-ID', String(other._id))
      .send({ query: 'Energy?', scope: { notes: [String(row._id)] } }).expect(200);
    expect(response.body.passages).to.have.length(1);
    await Note.updateOne({ _id: row._id }, { 'indexing.embeddingModel': 'obsolete-model' });
    expect((await search({ notes: [String(row._id)] }).expect(200)).body.passages).to.deep.equal([]);
  });
  it('rechecks scope membership even when the source text and generation did not change', async () => {
    const course = await Course.create({ user: user._id, title: 'Biology' });
    const { row, ref, passage } = await publish(Note, { courses: [course._id] });
    const context = { user_id: String(user._id), run_id: 'test', scope: { scope_id: 'scope', selection: { courses: [String(course._id)] }, sources: [ref] } };
    await Note.updateOne({ _id: row._id }, { courses: [] });
    const response = await request(app).post('/internal/retrieval/passages').set(auth).send({ context, chunk_ids: [passage.citation.chunk_id] }).expect(200);
    expect(response.body.passages).to.deep.equal([]);
  });
  it('fails closed for deleted or reindexed source generations and invalid AI responses', async () => {
    const { row, passage } = await publish(Note);
    service.client.search = async body => { await Note.updateOne({ _id: row._id }, { sourceVersion: randomUUID() }); return { query: body.query, passages: [passage] }; };
    expect((await search({ notes: [String(row._id)] }).expect(200)).body.passages).to.deep.equal([]);
    service.client.search = async () => ({ query: 'wrong', passages: [] });
    await Note.updateOne({ _id: row._id }, { sourceVersion: passage.citation.source.source_version });
    await search({ notes: [String(row._id)] }).expect(503);
    await Note.findOneAndUpdate({ _id: row._id }, { deletedAt: new Date() });
    await search({ notes: [String(row._id)] }).expect(404);
  });
  it('requires narrowing rather than silently dropping sources beyond the context bound', async () => {
    const { row } = await publish(Document);
    const base = await Document.findById(row._id).lean();
    await Document.insertMany(Array.from({ length: 100 }, () => ({ ...base, _id: new mongoose.Types.ObjectId(), indexing: { ...base.indexing, jobId: randomUUID() } })));
    await search({ library: true }).expect(409);
  });
});
