import { expect } from 'chai';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.mjs';
import { User, Book, Note, Flashcard } from '../src/db.mjs';

describe('HTTP boundaries without a database', () => {
  const app = createApp();
  it('returns JSON 401 responses for protected resources', async () => {
    for (const endpoint of ['/api/auth/me', '/api/dashboard', '/api/books', '/api/notes', '/api/flashcards']) {
      const response = await request(app).get(endpoint).expect(401).expect('Content-Type', /json/);
      expect(response.headers.location).to.equal(undefined);
    }
  });
  it('blocks cross-site writes', async () => {
    await request(app).post('/api/auth/login').set('Origin', 'https://untrusted.example').send({ username: 'student', password: 'password' }).expect(403);
  });
  it('keeps unknown APIs and missing assets separate from React fallback routes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'classmate-spa-test-'));
    try {
      await writeFile(path.join(directory, 'index.html'), '<html><div id="root"></div></html>');
      const frontendApp = createApp({ frontendDirectory: directory });
      await request(frontendApp).get('/books/some-id/edit').expect(200).expect('Content-Type', /html/);
      await request(frontendApp).get('/api/does-not-exist').expect(404).expect('Content-Type', /json/);
      await request(frontendApp).get('/missing.js').expect(404);
    } finally { await rm(directory, { recursive: true }); }
  });
});

const integration = process.env.TEST_DSN ? describe : describe.skip;
integration('MongoDB + Passport API integration (requires TEST_DSN)', () => {
  let app;
  let alice;
  let bob;
  let aliceId;
  let bobId;
  before(async () => {
    const uri = new URL(process.env.TEST_DSN);
    if (!uri.pathname.endsWith('_test')) { throw new Error('TEST_DSN must name a disposable database ending in _test.'); }
    await mongoose.connect(process.env.TEST_DSN);
    await Promise.all([User.init(), Book.init(), Note.init(), Flashcard.init()]);
    app = createApp();
  });
  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Book.deleteMany({}), Note.deleteMany({}), Flashcard.deleteMany({})]);
    const password = await bcrypt.hash('password123', 4);
    const users = await User.create([{ username: 'alice', email: 'alice@example.com', password }, { username: 'bob', email: 'bob@example.com', password }]);
    aliceId = users[0]._id;
    bobId = users[1]._id;
    alice = request.agent(app);
    bob = request.agent(app);
    await alice.post('/api/auth/login').send({ username: 'alice', password: 'password123' }).expect(200);
    await bob.post('/api/auth/login').send({ username: 'bob', password: 'password123' }).expect(200);
  });
  after(async () => { if (mongoose.connection.readyState === 1) { await mongoose.connection.dropDatabase(); } await mongoose.disconnect(); });
  const bookBody = { title: 'Algorithms', author: 'A. Author', category: 'Computer science', description: 'Practice problems', url: 'https://example.com/book' };

  it('registers a user, hashes credentials, restores the session, and logs out', async () => {
    const agent = request.agent(app);
    const body = { username: 'newstudent', email: 'new@example.com', password: 'password123', confirmPassword: 'password123' };
    await agent.post('/api/auth/register').send(body).expect(201);
    const user = await User.findOne({ username: body.username });
    expect(user.password).not.to.equal(body.password);
    expect(await bcrypt.compare(body.password, user.password)).to.equal(true);
    const login = await agent.post('/api/auth/login').send(body).expect(200);
    expect(login.body.user).not.to.have.property('password');
    expect(login.headers['set-cookie'][0]).to.contain('HttpOnly').and.contain('SameSite=Lax');
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.user._id).to.equal(String(user._id));
    await agent.post('/api/auth/logout').expect(204);
    await agent.get('/api/auth/me').expect(401);
  });
  it('rejects incorrect credentials and query injection inputs', async () => {
    await request(app).post('/api/auth/login').send({ username: 'alice', password: 'wrong' }).expect(401);
    await request(app).post('/api/auth/login').send({ username: { $ne: null }, password: 'password123' }).expect(400);
  });
  it('supports book create, details, edit, listing, and delete', async () => {
    const created = await alice.post('/api/books').send({ ...bookBody, user: String(bobId) }).expect(201);
    const id = created.body.book._id;
    expect(created.body.book.user).to.equal(String(aliceId));
    await alice.get(`/api/books/${id}`).expect(200);
    const updated = await alice.patch(`/api/books/${id}`).send({ title: 'Updated algorithms' }).expect(200);
    expect(updated.body.book.title).to.equal('Updated algorithms');
    const list = await alice.get('/api/books').expect(200);
    expect(list.body.books).to.have.length(1);
    await alice.delete(`/api/books/${id}`).expect(204);
    await alice.get(`/api/books/${id}`).expect(404);
  });
  it('supports standalone notes and optional owned-book links', async () => {
    const book = await Book.create({ ...bookBody, user: aliceId });
    const created = await alice.post('/api/notes').send({ title: 'Study note', content: 'First line\nSecond line', book: String(book._id) }).expect(201);
    const id = created.body.note._id;
    const detail = await alice.get(`/api/notes/${id}`).expect(200);
    expect(detail.body.note.book.title).to.equal(book.title);
    await alice.patch(`/api/notes/${id}`).send({ book: null, title: 'Standalone note' }).expect(200);
    const list = await alice.get('/api/notes').expect(200);
    expect(list.body.notes[0].book).to.equal(null);
    await alice.delete(`/api/notes/${id}`).expect(204);
  });
  it('persists rich notes, sanitizes HTML, preserves formatting on metadata edits, and supports plain-text replacements', async () => {
    const created = await alice.post('/api/notes').send({ title: 'Formatted note', contentHtml: '<h2>Connections</h2><p><em>Remember</em> <span style="font-family:Georgia;font-size:18pt;color:#123456">this</span></p><script>bad()</script>' }).expect(201);
    const id = created.body.note._id;
    expect(created.body.note.content).to.include('Connections').and.include('Remember this').and.not.include('bad');
    expect(created.body.note.contentHtml).to.include('<em>Remember</em>').and.include('font-family:Georgia').and.not.include('<script>');
    const changed = await alice.patch(`/api/notes/${id}`).send({ title: 'Renamed' }).expect(200);
    expect(changed.body.note.contentHtml).to.equal(created.body.note.contentHtml);
    expect(changed.body.note.updatedAt).to.be.a('string');
    await bob.patch(`/api/notes/${id}`).send({ contentHtml: '<p>stolen</p>' }).expect(404);
    const detail = await alice.get(`/api/notes/${id}`).expect(200);
    expect(detail.body.note.contentHtml).to.equal(created.body.note.contentHtml);
    await alice.patch(`/api/notes/${id}`).send({ contentHtml: '<p><strong>Edited</strong> note</p>' }).expect(200);
    const plain = await alice.patch(`/api/notes/${id}`).send({ content: 'Plain replacement <example>' }).expect(200);
    expect(plain.body.note.contentHtml).to.equal(null);
    expect(plain.body.note.content).to.equal('Plain replacement <example>');
    await alice.post('/api/notes').send({ title: 'Empty', contentHtml: '<p><br></p>' }).expect(400);
    const dashboard = await alice.get('/api/dashboard').expect(200);
    expect(dashboard.body.notes[0].content).to.equal(plain.body.note.content);
  });
  it('supports flashcard editing, tag filtering, and deletion', async () => {
    const [book1, book2] = await Book.create([{ ...bookBody, user: aliceId }, { ...bookBody, title: 'Another book', user: aliceId }]);
    const body = { question: 'Which option is correct?', options: ['One', 'Two', '', 'Four'], correctIndex: 3, tags: [String(book1._id)] };
    const created = await alice.post('/api/flashcards').send(body).expect(201);
    const id = created.body.flashcard._id;
    expect(created.body.flashcard.correctIndex).to.equal(2);
    await alice.get(`/api/flashcards/${id}`).expect(200);
    const matched = await alice.get(`/api/flashcards?tags=${book1._id},${book2._id}`).expect(200);
    expect(matched.body.flashcards).to.have.length(1);
    expect(matched.body.flashcards[0]).not.to.have.property('password');
    const unmatched = await alice.get(`/api/flashcards?tags=${book2._id}`).expect(200);
    expect(unmatched.body.flashcards).to.have.length(0);
    await alice.patch(`/api/flashcards/${id}`).send({ question: 'Updated question?' }).expect(200);
    await alice.delete(`/api/flashcards/${id}`).expect(204);
  });
  it('prevents reading, editing, deleting, or linking another user’s content', async () => {
    const book = await Book.create({ ...bookBody, user: bobId });
    const note = await Note.create({ title: 'Private note', content: 'Private', user: bobId });
    const card = await Flashcard.create({ question: 'Private?', options: ['Yes', 'No'], correctIndex: 0, tags: [book._id], user: bobId });
    for (const [resource, id] of [['books', book._id], ['notes', note._id], ['flashcards', card._id]]) {
      await alice.get(`/api/${resource}/${id}`).expect(404);
      await alice.patch(`/api/${resource}/${id}`).send({ title: 'Stolen', question: 'Stolen?' }).expect(404);
      await alice.delete(`/api/${resource}/${id}`).expect(404);
    }
    await alice.post('/api/notes').send({ title: 'Note', content: 'Content', book: String(book._id) }).expect(400);
    await alice.post('/api/flashcards').send({ question: 'Question?', options: ['Yes', 'No'], correctIndex: 0, tags: [String(book._id)] }).expect(400);
    expect(await Flashcard.exists({ _id: card._id })).not.to.equal(null);
    const dashboard = await alice.get('/api/dashboard').expect(200);
    expect(dashboard.body).to.deep.equal({ books: [], notes: [], flashcardsCount: 0 });
  });
  it('unlinks notes and flashcard tags when deleting a book, preserving both', async () => {
    const book = await Book.create({ ...bookBody, user: aliceId, isFavorite: true });
    const note = await Note.create({ title: 'Keep this note', content: 'Content', book: book._id, user: aliceId });
    const card = await Flashcard.create({ question: 'Keep this card?', options: ['Yes', 'No'], correctIndex: 0, tags: [book._id], user: aliceId });
    const dashboard = await alice.get('/api/dashboard').expect(200);
    expect(dashboard.body.books[0].isFavorite).to.equal(true);
    expect(dashboard.body.flashcardsCount).to.equal(1);
    await alice.delete(`/api/books/${book._id}`).expect(204);
    expect((await Note.findById(note._id)).book).to.equal(null);
    expect((await Flashcard.findById(card._id)).tags).to.have.length(0);
  });
  it('returns validation errors for invalid IDs, URLs, choices, and missing tags', async () => {
    await alice.get('/api/books/not-an-id').expect(400);
    await alice.post('/api/books').send({ ...bookBody, url: 'javascript:alert(1)' }).expect(400);
    await alice.post('/api/flashcards').send({ question: 'Question?', options: ['Yes', 'No'], correctIndex: 5, tags: [] }).expect(400);
  });
});
