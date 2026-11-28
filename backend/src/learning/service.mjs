import { createHash, randomUUID } from 'node:crypto';
import { Book, Course, Note, Document, Flashcard, StudyArtifact, Conversation } from '../db.mjs';
import { QuizAttempt, QuizDefinition, LearningProfile } from './models.mjs';
import { objectId, parseSelection } from '../retrieval/scope.mjs';
import { materialCourseFilter } from '../course-materials.mjs';
import { ChatError, uuid } from '../chat/policy.mjs';
import { exact, invalid, answerValue, possible, publicAttempt, summarize, ASSESSMENT_LEASE_MS, MAX_MANUAL_QUESTIONS } from './policy.mjs';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const changed = () => { throw new ChatError(409, 'attempt_changed', 'This attempt changed in another tab. Load the latest answers.'); };
const ids = values => [...new Set((values || []).map(String))];
const intersects = (a, b) => a?.some(id => b.has(String(id)));
export class LearningService {
  constructor({ repository, client, chat }) { Object.assign(this, { repository, client, chat }); }
  async start(user, body) {
    exact(body, ['requestId', 'studyId', 'manual', 'fromAttempt']);
    if (!uuid(body.requestId) || [body.studyId, body.manual, body.fromAttempt].filter(Boolean).length !== 1) { invalid(); }
    let definition;
    if (body.fromAttempt) {
      const old = await this.repository.owned(user, body.fromAttempt);
      definition = await QuizDefinition.findOne({ _id: old.definition, user }).select('+questions').lean(); if (!definition) { invalid(); }
    } else if (body.studyId) {
      if (!objectId(body.studyId)) { invalid(); }
      const row = await StudyArtifact.findOne({ _id: body.studyId, user, status: 'saved', kind: 'quiz' }).lean();
      if (!row?.content) { throw new ChatError(404, 'quiz_not_found', 'Save this quiz before starting a recorded attempt. Drafts can still be previewed.'); }
      const selection = parseSelection(row.request.selection), associations = { courses: [...selection.courses], books: [...selection.books], notes: [...selection.notes], documents: [...selection.documents] };
      for (const c of row.content.citations) { associations[c.source.source_type === 'note' ? 'notes' : 'documents'].push(c.source.source_id); }
      definition = await this.repository.define(user, { key: `study:${row._id}:${row.savedRevision}`, title: row.content.title, origin: 'generated', studyId: row._id, sourceRevision: row.savedRevision,
        selection, associations, questions: row.content.questions.map((q, i) => ({ ...q, id: `q${i + 1}` })), citations: row.content.citations });
    } else {
      exact(body.manual, ['tags', 'course']);
      const tags = body.manual.tags || [], course = body.manual.course || '';
      if (!Array.isArray(tags) || tags.length > 50 || tags.some(id => !objectId(id)) || typeof course !== 'string' || course && course !== 'none' && !objectId(course) || !tags.length && !course) { invalid('Choose books or a course for this quiz.'); }
      if (await Book.countDocuments({ user, _id: { $in: ids(tags) } }) !== ids(tags).length) { invalid('Choose books from your own library.'); }
      const filter = { user, ...(tags.length && { tags: { $in: ids(tags) } }), ...await materialCourseFilter('flashcards', course, user) };
      const cards = await Flashcard.find(filter).sort({ createdAt: -1, _id: -1 }).limit(MAX_MANUAL_QUESTIONS).lean();
      if (!cards.length) { invalid('No flashcards found for these materials. Add some or choose a different course or book.'); }
      if (cards.some(c => c.options.length < 2 || c.options.length > 4 || !Number.isInteger(c.correctIndex) || c.correctIndex < 0 || c.correctIndex >= c.options.length || c.question.length > 4000 || c.options.some(o => o.length > 3000))) { invalid('Some flashcards need their answers corrected before starting this quiz.'); }
      const associations = { books: ids(cards.flatMap(c => c.tags)), courses: ids(cards.flatMap(c => c.courses)), notes: [], documents: [] };
      const title = course && course !== 'none' ? `${(await Course.findOne({ _id: course, user }).lean()).title} practice` : tags.length === 1 ? `${(await Book.findOne({ _id: tags[0], user }).lean()).title} practice` : 'Library flashcard practice';
      const questions = cards.map((c, i) => ({ id: `q${i + 1}`, kind: 'choice', prompt: c.question, options: c.options, correctIndex: c.correctIndex, referenceAnswer: '', rubric: [], language: '', starterCode: '', explanation: 'From your saved flashcard.', citationNumbers: [] }));
      definition = await this.repository.define(user, { key: `manual:${hash(cards)}`, title, origin: 'manual', questions, associations, citations: [], selection: { library: false, books: ids(tags), courses: course && course !== 'none' ? [course] : [], notes: [], documents: [] } });
    }
    return this.repository.start(user, definition, body.requestId);
  }
  async edit(user, id, body) {
    exact(body, ['revision', 'answers', 'position', 'marked']); const row = await this.repository.owned(user, id);
    if (row.status !== 'in_progress' || body.revision !== row.revision) { changed(); }
    if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers) || !Number.isInteger(body.position) || body.position < 0 || body.position >= row.questions.length || !Array.isArray(body.marked) || body.marked.length > row.questions.length) { invalid(); }
    const allowed = new Map(row.questions.map(q => [q.id, q]));
    if (Object.keys(body.answers).some(key => !allowed.has(key)) || body.marked.some(key => !allowed.has(key))) { invalid(); }
    const answers = { ...row.answers };
    for (const [key, value] of Object.entries(body.answers)) {
      if (answers[key]?.submitted) { if (JSON.stringify(answers[key].value) !== JSON.stringify(value)) { invalid('Submitted answers stay in your results. Start a new attempt to try again.'); } continue; }
      answers[key] = { value: answerValue(allowed.get(key), value), submitted: false };
    }
    return this.repository.change(user, row, { answers, position: body.position, marked: ids(body.marked) });
  }
  async submit(user, id, qid, body) {
    exact(body, ['revision', 'answer', 'reveal']); const row = await this.repository.owned(user, id), q = row.questions.find(q => q.id === qid);
    if (!q || typeof body.reveal !== 'boolean') { invalid(); }
    const value = body.reveal ? null : answerValue(q, body.answer, false), existing = row.answers[qid];
    if (existing?.submitted && existing.revealed === body.reveal && JSON.stringify(existing.value) === JSON.stringify(value)) { return row; }
    if (row.status !== 'in_progress' || row.revision !== body.revision || existing?.submitted) { changed(); }
    return this.repository.change(user, row, { answers: { ...row.answers, [qid]: { value, submitted: true, revealed: body.reveal, submittedAt: this.repository.clock() } } });
  }
  async complete(user, id, body) {
    exact(body, ['revision']); const row = await this.repository.owned(user, id);
    if (row.status === 'completed') { return row; }
    if (row.revision !== body.revision) { changed(); }
    return this.repository.change(user, row, { status: 'completed', completedAt: this.repository.clock() });
  }
  async assess(user, id, qid) {
    const row = await this.repository.owned(user, id); const q = row.questions.find(q => q.id === qid), answer = row.answers[qid];
    if (!q || q.kind === 'choice' || !answer?.submitted || answer.revealed) { invalid('Submit a written or code answer before requesting AI feedback.'); }
    const current = row.assessments[qid], now = this.repository.clock();
    if (current?.status === 'ready' || current?.status === 'processing' && new Date(current.leaseUntil) > now) { return row; }
    const leaseId = randomUUID(), leaseUntil = new Date(now.getTime() + ASSESSMENT_LEASE_MS), key = `assessments.${qid}`;
    const claim = await QuizAttempt.findOneAndUpdate({ _id: id, user, $or: [{ [`${key}.status`]: { $ne: 'processing' } }, { [`${key}.leaseUntil`]: { $lte: now } }], [`${key}.status`]: { $ne: 'ready' } }, { $set: { [key]: { status: 'processing', leaseId, leaseUntil } } }, { new: true }).select('+questions').lean();
    if (!claim) { return this.repository.owned(user, id); }
    const fence = { _id: id, user, [`${key}.leaseId`]: leaseId, [`${key}.leaseUntil`]: { $gt: this.repository.clock() } };
    try {
      await this.chat.repository.quota(user, this.chat.dailyTurns, this.chat.globalTurns);
      const result = await this.client.call('assess', { question: { kind: q.kind, prompt: q.prompt, referenceAnswer: q.referenceAnswer, rubric: q.rubric, language: q.language || '' }, answer: answer.value });
      const assessment = this.validateAssessment(result, q);
      const saved = await QuizAttempt.findOneAndUpdate({ ...fence, [`${key}.leaseUntil`]: { $gt: this.repository.clock() } }, { $set: { [key]: { ...assessment, status: 'ready', model: String(result.model || '').slice(0, 100), assessedAt: this.repository.clock() } } }, { new: true }).select('+questions').lean();
      if (!saved) { changed(); } return saved;
    } catch (e) {
      await QuizAttempt.updateOne({ _id: id, user, [`${key}.leaseId`]: leaseId }, { $set: { [key]: { status: 'failed', error: e.code === 'daily_limit' ? 'Daily AI limit reached. Try again tomorrow.' : 'AI feedback was interrupted. Your answer is saved; retry when ready.' } } });
      throw e;
    }
  }
  validateAssessment(result, q) {
    if (!result || !Array.isArray(result.criteria) || result.criteria.length !== q.rubric.length || typeof result.feedback !== 'string' || !result.feedback.trim() || result.feedback.length > 3000) { throw new ChatError(503, 'assessment_invalid', 'The AI assessment could not be verified. Your answer is saved.'); }
    const criteria = result.criteria.map((entry, i) => {
      if (entry.index !== i || !Number.isInteger(entry.points) || entry.points < 0 || entry.points > q.rubric[i].maxPoints || typeof entry.reason !== 'string' || !entry.reason.trim() || entry.reason.length > 600) { throw new ChatError(503, 'assessment_invalid', 'The AI assessment could not be verified. Your answer is saved.'); }
      return { description: q.rubric[i].description, maxPoints: q.rubric[i].maxPoints, points: entry.points, reason: entry.reason };
    });
    return { criteria, earned: criteria.reduce((sum, c) => sum + c.points, 0), feedback: result.feedback };
  }
  async context(user, rawSelection = { library: true }) {
    const selection = parseSelection(rawSelection);
    // All candidates are re-read from MongoDB under the current owner. No external catalog is used.
    const [courses, books, notes, documents, sets, attempts, conversations] = await Promise.all([
      Course.find({ user }).select('title description code').limit(200).lean(), Book.find({ user }).select('title author category description courses').limit(200).lean(),
      Note.find({ user }).select('title content courses book').sort({ updatedAt: -1 }).limit(200).lean(),
      Document.find({ user, status: 'uploaded' }).select('title courses book note').limit(200).lean(),
      StudyArtifact.find({ user, status: 'saved' }).select('kind title content.title content.citations request.selection').sort({ updatedAt: -1 }).limit(100).lean(),
      QuizAttempt.find({ user, status: 'completed' }).select('+questions').sort({ completedAt: -1 }).limit(40).lean(),
      Conversation.find({ user }).select({ messages: { $slice: -12 }, title: 1, topic: 1, selection: 1 }).sort({ updatedAt: -1 }).limit(8).lean(),
    ]);
    const courseIds = new Set(selection.courses), bookIds = new Set([...selection.books, ...books.filter(b => intersects(b.courses, courseIds)).map(b => String(b._id))]);
    const noteIds = new Set([...selection.notes, ...notes.filter(n => bookIds.has(String(n.book)) || intersects(n.courses, courseIds)).map(n => String(n._id))]);
    const documentIds = new Set([...selection.documents, ...documents.filter(d => bookIds.has(String(d.book)) || noteIds.has(String(d.note)) || intersects(d.courses, courseIds)).map(d => String(d._id))]);
    const match = associations => selection.library || intersects(associations?.courses, courseIds) || intersects(associations?.books, bookIds) || intersects(associations?.notes, noteIds) || intersects(associations?.documents, documentIds);
    const recent = attempts.filter(a => match(a.associations)).slice(0, 12);
    const chatTopics = conversations.filter(c => selection.library || match(c.selection)).flatMap(c => [c.topic, ...c.messages.filter(m => m.role === 'user' && m.status === 'completed').map(m => m.content)]).filter(Boolean).slice(0, 6).map(s => s.slice(0, 240));
    const resources = [];
    const add = (rows, type, plural, predicate, hint) => { for (const r of rows.filter(predicate)) { resources.push({ id: `${type}:${r._id}`, type, title: (r.content?.title || r.title).slice(0, 200), href: `/${plural}/${r._id}`, hint: String(hint(r) || '').replace(/\s+/g, ' ').slice(0, 160) }); } };
    add(courses, 'course', 'courses', c => selection.library || courseIds.has(String(c._id)), c => c.description || c.code);
    add(books, 'book', 'books', b => selection.library || bookIds.has(String(b._id)), b => `${b.author} ${b.category} ${b.description || ''}`);
    add(notes, 'note', 'notes', n => selection.library || noteIds.has(String(n._id)), n => n.content);
    add(documents, 'document', 'documents', d => selection.library || documentIds.has(String(d._id)), () => 'Uploaded PDF');
    add(sets, 'study', 'study-tools', s => selection.library || match(s.request?.selection) || s.content?.citations?.some(c => (c.source.source_type === 'note' ? noteIds : documentIds).has(c.source.source_id)), s => s.kind);
    const history = recent.map(a => { const summary = summarize(a); return { id: String(a._id), title: a.title, completedAt: a.completedAt, ...summary, misses: summary.misses.slice(0, 5) }; });
    const topics = [...history.flatMap(a => a.misses.map(m => m.topic)), ...chatTopics].join(' ').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
    const words = new Set(topics.filter(t => !['the', 'and', 'what', 'with', 'this', 'that', 'which', 'from', 'your', 'for', 'how', 'are', 'was'].includes(t)));
    const rank = r => [...words].filter(word => `${r.title} ${r.hint}`.toLowerCase().includes(word)).length;
    resources.sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id));
    const catalog = resources.slice(0, 40);
    const stats = { completed: recent.length, choiceCorrect: history.reduce((n, a) => n + a.choice.correct, 0), choiceAnswered: history.reduce((n, a) => n + a.choice.answered, 0), aiAssessed: history.reduce((n, a) => n + a.ai.graded, 0), aiEarned: history.reduce((n, a) => n + a.ai.earned, 0), aiPossible: recent.reduce((n, a) => n + a.questions.filter(q => a.assessments?.[q.id]?.status === 'ready').reduce((v, q) => v + possible(q), 0), 0) };
    return { stats, attempts: history, chatTopics, resources: catalog, coverage: 'Up to 12 relevant recent completed attempts, six recent chat interests, and 40 current library resources.' };
  }
  validateCoaching(result, context) {
    const bad = () => { throw new ChatError(503, 'coaching_invalid', 'The study suggestions could not be verified. Try again later.'); };
    if (!result || typeof result.overview !== 'string' || !result.overview.trim() || result.overview.length > 2000 || !Array.isArray(result.focusAreas) || result.focusAreas.length > 5 || !Array.isArray(result.recommendations) || result.recommendations.length > 5 || !Array.isArray(result.nextSteps) || result.nextSteps.length > 5) { bad(); }
    const allowedAttempts = new Set(context.attempts.map(a => a.id)), catalog = new Map(context.resources.map(r => [r.id, r]));
    const focusAreas = result.focusAreas.map(f => { if (typeof f.topic !== 'string' || !f.topic.trim() || f.topic.length > 200 || typeof f.reason !== 'string' || !f.reason.trim() || f.reason.length > 600 || !Array.isArray(f.attemptIds) || f.attemptIds.length > 12 || f.attemptIds.some(id => !allowedAttempts.has(id))) { bad(); } return { topic: f.topic, reason: f.reason, attemptIds: ids(f.attemptIds) }; });
    const recommendations = result.recommendations.map(r => { if (!catalog.has(r.resourceId) || typeof r.reason !== 'string' || !r.reason.trim() || r.reason.length > 600) { bad(); } return { ...catalog.get(r.resourceId), reason: r.reason }; });
    if (new Set(recommendations.map(r => r.id)).size !== recommendations.length || result.nextSteps.some(s => typeof s !== 'string' || !s.trim() || s.length > 500)) { bad(); }
    return { overview: result.overview, focusAreas, recommendations, nextSteps: result.nextSteps };
  }
  async dashboard(user) {
    const [context, active, profile] = await Promise.all([this.context(user), QuizAttempt.find({ user, status: 'in_progress' }).select('+questions').sort({ updatedAt: -1 }).limit(3).lean(), LearningProfile.findOne({ user }).lean()]);
    const currentIds = new Set(context.resources.map(r => r.id));
    return { stats: context.stats, coverage: context.coverage, canCoach: !!(context.attempts.length || context.chatTopics.length), resume: active.map(a => publicAttempt(a, { brief: true })),
      revisit: context.attempts.flatMap(a => a.misses.map(m => ({ ...m, attemptId: a.id, title: a.title }))).slice(0, 5),
      recommendations: context.resources.slice(0, 3).map(r => ({ ...r, reason: 'A starting point from your own library.' })),
      coaching: profile?.result ? { ...profile.result, recommendations: profile.result.recommendations.filter(r => currentIds.has(r.id)).map(r => ({ ...context.resources.find(c => c.id === r.id), reason: r.reason })), generatedAt: profile.generatedAt, stale: profile.contextHash !== hash(context) } : null,
      coachingBusy: !!(profile?.run && new Date(profile.run.leaseUntil) > this.repository.clock()),
    };
  }
  async coach(user) {
    const context = await this.context(user), contextHash = hash(context), now = this.repository.clock();
    if (!context.attempts.length && !context.chatTopics.length) { invalid('Complete a quiz or start a study conversation to build your first study suggestions.'); }
    await LearningProfile.updateOne({ user }, { $setOnInsert: { user } }, { upsert: true }).catch(e => { if (e.code !== 11000) { throw e; } });
    const old = await LearningProfile.findOne({ user }).lean();
    if (old.contextHash === contextHash && old.result) { return this.dashboard(user); }
    const run = { id: randomUUID(), leaseUntil: new Date(now.getTime() + ASSESSMENT_LEASE_MS) };
    const claimed = await LearningProfile.findOneAndUpdate({ user, $or: [{ run: null }, { 'run.leaseUntil': { $lte: now } }] }, { $set: { run, error: null } }, { new: true }).lean();
    if (!claimed) { throw new ChatError(409, 'coaching_busy', 'Your study suggestions are already being prepared. Try again shortly.'); }
    try {
      await this.chat.repository.quota(user, this.chat.dailyTurns, this.chat.globalTurns);
      const raw = await this.client.call('coach', { context }), result = this.validateCoaching(raw, context);
      const fresh = await this.context(user), allowed = new Set(fresh.resources.map(r => r.id));
      if (result.recommendations.some(r => !allowed.has(r.id))) { throw new ChatError(409, 'library_changed', 'Your library changed while suggestions were prepared. Refresh and try again.'); }
      const written = await LearningProfile.updateOne({ user, 'run.id': run.id, 'run.leaseUntil': { $gt: this.repository.clock() } }, { $set: { result, contextHash, generatedAt: this.repository.clock(), run: null } });
      if (!written.modifiedCount) { changed(); } return this.dashboard(user);
    } catch (e) { await LearningProfile.updateOne({ user, 'run.id': run.id }, { $set: { run: null, error: 'unavailable' } }); throw e; }
  }
  async chatContext(context) {
    exact(context, ['user_id', 'run_id', 'conversation_id', 'proposal_id', 'scope']);
    if (!objectId(context.user_id) || !objectId(context.conversation_id) || context.proposal_id || typeof context.run_id !== 'string') { invalid(); }
    const conversation = await Conversation.findOne({ _id: context.conversation_id, user: context.user_id, 'activeRun.id': context.run_id, 'activeRun.leaseUntil': { $gt: this.repository.clock() } }).select('selection').lean();
    if (!conversation || JSON.stringify(parseSelection(conversation.selection)) !== JSON.stringify(parseSelection(context.scope?.selection))) { throw new ChatError(404, 'scope_changed', 'This conversation is no longer active.'); }
    return this.context(context.user_id, conversation.selection);
  }
  async fromChat(user, context, raw) {
    const current = await this.chatContext(context), result = this.validateCoaching(raw, current);
    const stats = current.stats, lines = [`From ${stats.completed} recent completed quiz attempts: ${stats.choiceCorrect}/${stats.choiceAnswered} answered choice questions correct; ${stats.aiAssessed} written/code answers assessed by AI.`, result.overview];
    if (result.focusAreas.length) { lines.push('**Ideas to revisit**', ...result.focusAreas.slice(0, 3).map(f => `- ${f.topic}: ${f.reason}`)); }
    if (result.recommendations.length) { lines.push('**From your library**', ...result.recommendations.slice(0, 3).map(r => `- [${r.title.replace(/[\]\\[]/g, '')}](${r.href}): ${r.reason}`)); }
    if (result.nextSteps.length) { lines.push('**Try next**', ...result.nextSteps.slice(0, 3).map(s => `- ${s}`)); }
    return { content: lines.join('\n\n'), mode: 'coaching', citations: [] };
  }
}
