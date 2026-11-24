import { expect } from 'chai';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.mjs';
import { User, Course, Book, Note, Flashcard } from '../src/db.mjs';

describe('HTTP boundaries without a database', () => {
  const app = createApp();
  it('returns JSON 401 responses for protected resources', async () => {
    for (const endpoint of ['/api/auth/me', '/api/dashboard', '/api/courses', '/api/books', '/api/notes', '/api/flashcards']) {
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
    await Promise.all([User.init(), Course.init(), Book.init(), Note.init(), Flashcard.init()]);
    app = createApp();
  });
  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), Course.deleteMany({}), Book.deleteMany({}), Note.deleteMany({}), Flashcard.deleteMany({})]);
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
  it('saves arbitrary cover colors, normalizes hex input, and rejects unsafe values', async () => {
    const created = await alice.post('/api/books').send({ ...bookBody, color: ' #AbC ' }).expect(201);
    const id = created.body.book._id;
    expect(created.body.book.color).to.equal('#aabbcc');
    const changed = await alice.patch(`/api/books/${id}`).send({ color: '#123456' }).expect(200);
    expect(changed.body.book.color).to.equal('#123456');
    await alice.patch(`/api/books/${id}`).send({ title: 'Color stays' }).expect(200);
    const listed = await alice.get('/api/books').expect(200);
    expect(listed.body.books[0].color).to.equal('#123456');
    const note = (await alice.post('/api/notes').send({ title: 'Color connection', content: 'My reading', book: id }).expect(201)).body.note;
    const related = await alice.get(`/api/notes/${note._id}`).expect(200);
    expect(related.body.related.book.color).to.equal('#123456');
    expect(related.body.note.book.color).to.equal('#123456');
    for (const color of ['red', 'url(https://example.com)', '#1234', '#123456;display:none', { $ne: null }]) {
      const invalid = await alice.patch(`/api/books/${id}`).send({ color }).expect(400);
      expect(invalid.body.fields.color).to.be.a('string');
    }
    await bob.patch(`/api/books/${id}`).send({ color: '#ffffff' }).expect(404);
    const reset = await alice.patch(`/api/books/${id}`).send({ color: null }).expect(200);
    expect(reset.body.book.color).to.equal(null);
    const automatic = await alice.post('/api/books').send(bookBody).expect(201);
    expect(automatic.body.book.color).to.equal(null);
  });
  it('connects owned book materials and same-course reading without leaking another user’s records', async () => {
    const course = await Course.create({ title: 'Learning science', user: aliceId });
    const foreignCourse = await Course.create({ title: 'Private course', user: bobId });
    const book = await Book.create({ ...bookBody, user: aliceId, courses: [course._id, foreignCourse._id] });
    const sibling = await Book.create({ ...bookBody, title: 'Related reading', user: aliceId, courses: [course._id] });
    await Book.create({ ...bookBody, title: 'Private reading', user: bobId, courses: [course._id] });
    const note = await Note.create({ title: 'My book note', content: 'My thought', contentHtml: '<p>My thought</p>', book: book._id, user: aliceId });
    await Note.create({ title: 'Private note', content: 'Not shared', book: book._id, courses: [course._id], user: bobId });
    const card = await Flashcard.create({ question: 'My recall', options: ['Yes', 'No'], correctIndex: 0, tags: [book._id], user: aliceId });
    await Flashcard.create({ question: 'Private recall', options: ['Yes', 'No'], correctIndex: 0, tags: [book._id], user: bobId });
    const result = (await alice.get(`/api/books/${book._id}`).expect(200)).body.related;
    expect(result.courses.map(item => item._id)).to.deep.equal([String(course._id)]);
    expect(result.books.map(item => item._id)).to.deep.equal([String(sibling._id)]);
    expect(result.notes.map(item => item._id)).to.deep.equal([String(note._id)]);
    expect(result.notes[0]).not.to.have.property('contentHtml');
    expect(result.flashcards.map(item => item._id)).to.deep.equal([String(card._id)]);
    expect(JSON.stringify(result)).not.to.include('Private');
    const noteResult = (await alice.get(`/api/notes/${note._id}`).expect(200)).body.related;
    expect(noteResult.book._id).to.equal(String(book._id));
    expect(noteResult.notes).to.have.length(0);
    expect(noteResult.flashcards.map(item => item._id)).to.deep.equal([String(card._id)]);
    await bob.get(`/api/books/${book._id}`).expect(404);
    await bob.get(`/api/notes/${note._id}`).expect(404);
  });
  it('connects standalone course notes to direct and inherited materials while keeping unassigned notes independent', async () => {
    const courses = await Course.create([{ title: 'First subject', user: aliceId }, { title: 'Second subject', user: aliceId }]);
    const ids = courses.map(course => course._id);
    const book = await Book.create({ ...bookBody, user: aliceId, courses: ids });
    const source = await Note.create({ title: 'Course overview', content: 'Overview', courses: ids, user: aliceId });
    const sibling = await Note.create({ title: 'Reading idea', content: 'Idea', book: book._id, courses: [ids[0]], user: aliceId });
    const card = await Flashcard.create({ question: 'Inherited recall', options: ['A', 'B'], correctIndex: 0, tags: [book._id], courses: ids, user: aliceId });
    const directCard = await Flashcard.create({ question: 'Course recall', options: ['A', 'B'], correctIndex: 0, courses: [ids[1]], user: aliceId });
    const unassigned = await Note.create({ title: 'Personal', content: 'Independent', user: aliceId });
    const related = (await alice.get(`/api/notes/${source._id}`).expect(200)).body.related;
    expect(related.book).to.equal(null);
    expect(related.courses).to.have.length(2);
    expect(related.books.map(item => item._id)).to.deep.equal([String(book._id)]);
    expect(related.notes.map(item => item._id)).to.deep.equal([String(sibling._id)]);
    expect(related.flashcards.map(item => item._id)).to.have.members([String(card._id), String(directCard._id)]);
    const personal = (await alice.get(`/api/notes/${unassigned._id}`).expect(200)).body.related;
    expect(personal).to.deep.equal({ book: null, courses: [], notes: [], flashcards: [], books: [] });
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
  it('creates, edits and lists courses with safe ownership and validation', async () => {
    const created = await alice.post('/api/courses').send({ title: 'Psychology', code: 'PSY 101', term: 'Fall 2026', color: 'mint', user: String(bobId) }).expect(201);
    const id = created.body.course._id;
    expect(created.body.course.user).to.equal(String(aliceId));
    const list = await alice.get('/api/courses').expect(200);
    expect(list.body.courses[0].counts).to.deep.equal({ books: 0, notes: 0, flashcards: 0 });
    const updated = await alice.patch(`/api/courses/${id}`).send({ instructor: 'Dr. Example', title: 'Cognitive Psychology' }).expect(200);
    expect(updated.body.course.instructor).to.equal('Dr. Example');
    for (const method of ['get', 'patch', 'delete']) { await bob[method](`/api/courses/${id}`).send({ title: 'Not mine' }).expect(404); }
    await alice.post('/api/courses').send({ title: 'Invalid color', color: 'unsafe' }).expect(400);
    await alice.post('/api/courses').send({ title: ' ' }).expect(400);
    await alice.get('/api/courses/not-an-id').expect(400);
  });
  it('shares materials across courses and includes notes and cards from related books without duplicates', async () => {
    const [first, second] = await Course.create([{ title: 'First course', user: aliceId }, { title: 'Second course', user: aliceId }]);
    const book = (await alice.post('/api/books').send({ ...bookBody, courses: [String(first._id), String(second._id)] }).expect(201)).body.book;
    const note = (await alice.post('/api/notes').send({ title: 'Linked idea', contentHtml: '<p><strong>Remember</strong> this</p>', book: book._id, courses: [String(first._id)] }).expect(201)).body.note;
    const card = (await alice.post('/api/flashcards').send({ question: 'Recall?', options: ['A', 'B'], correctIndex: 0, tags: [book._id], courses: [String(first._id)] }).expect(201)).body.flashcard;
    const detail = await alice.get(`/api/courses/${first._id}`).expect(200);
    expect(detail.body.books).to.have.length(1); expect(detail.body.notes).to.have.length(1); expect(detail.body.flashcards).to.have.length(1);
    expect(detail.body.notes[0].book.courses).to.have.length(2);
    const inherited = await alice.get(`/api/notes?course=${second._id}`).expect(200);
    expect(inherited.body.notes[0]._id).to.equal(note._id);
    expect(inherited.body.notes[0].contentHtml).to.include('<strong>Remember</strong>');
    const cards = await alice.get(`/api/flashcards?course=${second._id}`).expect(200);
    expect(cards.body.flashcards[0]._id).to.equal(card._id);
    const summary = await alice.get('/api/courses').expect(200);
    expect(summary.body.courses.find(course => course._id === String(first._id)).counts).to.deep.equal({ books: 1, notes: 1, flashcards: 1 });
    await alice.patch(`/api/books/${book._id}`).send({ courses: [String(first._id)] }).expect(200);
    expect((await alice.get(`/api/notes?course=${second._id}`)).body.notes).to.have.length(0);
    expect((await alice.get(`/api/flashcards?course=${second._id}`)).body.flashcards).to.have.length(0);
  });
  it('allows course-only notes and flashcards and supports course quizzes without books', async () => {
    const course = await Course.create({ title: 'Independent study', user: aliceId });
    await alice.post('/api/notes').send({ title: 'Lecture notes', content: 'Important idea', courses: [String(course._id)] }).expect(201);
    const created = await alice.post('/api/flashcards').send({ question: 'Which one?', options: ['A', 'B'], correctIndex: 1, tags: [], courses: [String(course._id)] }).expect(201);
    expect(created.body.flashcard.tags).to.deep.equal([]);
    const quiz = await alice.get(`/api/flashcards?course=${course._id}`).expect(200);
    expect(quiz.body.flashcards).to.have.length(1);
    const detail = await alice.get(`/api/courses/${course._id}`).expect(200);
    expect(detail.body.books).to.have.length(0); expect(detail.body.notes).to.have.length(1);
    await alice.patch(`/api/flashcards/${created.body.flashcard._id}`).send({ question: 'Edited question?' }).expect(200);
    await alice.post('/api/flashcards').send({ question: 'No association?', options: ['A', 'B'], correctIndex: 0, tags: [], courses: [] }).expect(400);
  });
  it('validates all bulk assignments before changing membership and preserves other courses', async () => {
    const [course, other, foreign] = await Course.create([{ title: 'Main', user: aliceId }, { title: 'Shared', user: aliceId }, { title: 'Private', user: bobId }]);
    const [first, second, privateBook] = await Book.create([{ ...bookBody, user: aliceId, courses: [course._id, other._id] }, { ...bookBody, user: aliceId }, { ...bookBody, user: bobId }]);
    await alice.patch(`/api/courses/${course._id}/materials`).send({ kind: 'books', ids: [String(second._id), String(privateBook._id)] }).expect(400);
    expect((await Book.findById(first._id)).courses.map(String)).to.include(String(course._id));
    await alice.patch(`/api/courses/${course._id}/materials`).send({ kind: 'books', ids: [String(second._id)] }).expect(204);
    expect((await Book.findById(first._id)).courses.map(String)).to.deep.equal([String(other._id)]);
    expect((await Book.findById(second._id)).courses.map(String)).to.deep.equal([String(course._id)]);
    await alice.patch(`/api/courses/${foreign._id}/materials`).send({ kind: 'books', ids: [] }).expect(404);
    await alice.patch(`/api/courses/${course._id}/materials`).send({ kind: '__proto__', ids: [] }).expect(400);
    await alice.patch(`/api/courses/${course._id}/materials`).send({ kind: { toString: 'books' }, ids: [] }).expect(400);
    await alice.post('/api/books').send({ ...bookBody, courses: [String(foreign._id)] }).expect(400);
    await alice.post('/api/notes').send({ title: 'Wrong course', content: 'Private', courses: [String(foreign._id)] }).expect(400);
    await alice.post('/api/flashcards').send({ question: 'Wrong?', options: ['A', 'B'], correctIndex: 0, courses: [String(foreign._id)] }).expect(400);
    await alice.get(`/api/books?course=${foreign._id}`).expect(404);
    await alice.get('/api/notes?course=invalid').expect(400);
  });
  it('removes only course associations while preserving materials and their other relationships', async () => {
    const [course, other] = await Course.create([{ title: 'Remove me', user: aliceId }, { title: 'Keep me', user: aliceId }]);
    const book = await Book.create({ ...bookBody, user: aliceId, courses: [course._id, other._id] });
    const note = await Note.create({ title: 'Keep note', content: 'Keep content', user: aliceId, book: book._id, courses: [course._id, other._id] });
    const card = await Flashcard.create({ question: 'Keep?', options: ['A', 'B'], correctIndex: 0, tags: [book._id], courses: [course._id, other._id], user: aliceId });
    await alice.delete(`/api/courses/${course._id}`).expect(204);
    await alice.get(`/api/courses/${course._id}`).expect(404);
    expect((await Book.findById(book._id)).courses.map(String)).to.deep.equal([String(other._id)]);
    const kept = await Note.findById(note._id);
    expect(kept.content).to.equal('Keep content'); expect(String(kept.book)).to.equal(String(book._id));
    expect(kept.courses.map(String)).to.deep.equal([String(other._id)]);
    expect((await Flashcard.findById(card._id)).tags.map(String)).to.deep.equal([String(book._id)]);
    const remaining = await alice.get(`/api/courses/${other._id}`).expect(200);
    expect(remaining.body.notes).to.have.length(1); expect(remaining.body.flashcards).to.have.length(1);
  });
  it('keeps legacy materials without course fields available and allows organizing them later', async () => {
    const course = await Course.create({ title: 'New organization', user: aliceId });
    const inserted = await Book.collection.insertOne({ ...bookBody, user: aliceId });
    const note = await Note.collection.insertOne({ title: 'Legacy', content: 'Original plain text', book: inserted.insertedId, user: aliceId });
    expect((await alice.get('/api/books?course=none')).body.books).to.have.length(1);
    expect((await alice.get('/api/notes?course=none')).body.notes).to.have.length(1);
    await alice.patch(`/api/courses/${course._id}/materials`).send({ kind: 'books', ids: [String(inserted.insertedId)] }).expect(204);
    expect((await alice.get('/api/notes?course=none')).body.notes).to.have.length(0);
    expect((await alice.get(`/api/notes?course=${course._id}`)).body.notes[0]._id).to.equal(String(note.insertedId));
    expect((await Note.findById(note.insertedId)).content).to.equal('Original plain text');
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
    expect(dashboard.body).to.deep.equal({ books: [], notes: [], flashcardsCount: 0, courses: [] });
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
