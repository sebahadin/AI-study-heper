import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { StudyArtifact, Book, Course, Note, Document } from '../db.mjs';
import { uuid, citationKey } from '../chat/policy.mjs';
import { sourceKey, objectId } from '../retrieval/scope.mjs';
import { kinds, formats, validateDraft, exact, fail, safeErrors } from './validation.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => hash(JSON.stringify(value));
const missing = () => fail(404, 'study_not_found', 'Study set not found.');
export function publicStudy(row, brief = false) {
  const content = row.content || row.draft;
  return { _id: String(row._id), kind: row.kind, title: content?.title || row.title, status: row.status, revision: row.revision,
    savedRevision: row.savedRevision, updatedAt: row.updatedAt, hasDraft: !!row.draft,
    count: content?.cards?.length || content?.questions?.length || 0,
    ...(!brief && { request: row.request, draft: row.draft, content: row.content, busy: row.status === 'generating', error: row.errorCode ? safeErrors[row.errorCode] || safeErrors.chat_unavailable : null }) };
}
export class StudyService {
  constructor({ repository, search, chat, client }) { Object.assign(this, { repository, search, chat, client }); this.controllers = new Map(); }
  async owned(user, id, deleted = false) {
    if (!objectId(id)) { missing(); }
    const row = await this.repository.get(user, id, deleted); if (!row) { missing(); } return row;
  }
  async list(user, query) {
    let association;
    if (query.course) {
      const course = query.course;
      if (!objectId(course) || !await Course.exists({ _id: course, user })) { fail(404, 'material_not_found', 'Course not found.'); }
      const books = await Book.find({ user, courses: course }).select('_id').limit(1001).lean();
      const bookIds = books.map(b => b._id);
      const notes = await Note.find({ user, $or: [{ courses: course }, { book: { $in: bookIds } }] }).select('_id').limit(1001).lean();
      const noteIds = notes.map(n => n._id);
      const documents = await Document.find({ user, status: 'uploaded', $or: [{ courses: course }, { book: { $in: bookIds } }, { note: { $in: noteIds } }] }).select('_id').limit(1001).lean();
      if ([books, notes, documents].some(items => items.length > 1000)) { fail(409, 'scope_too_large', 'Open your study sets to browse this large library.'); }
      const sourceIds = [...noteIds, ...documents.map(d => d._id)].map(String);
      association = { $or: [{ 'request.selection.courses': course }, { 'request.selection.books': { $in: bookIds.map(String) } },
        { 'content.citations.source.source_id': { $in: sourceIds } }, { 'draft.citations.source.source_id': { $in: sourceIds } }] };
    }
    return this.repository.list(user, query, association);
  }
  async create(user, body) {
    exact(body, ['requestId', 'kind', 'selection', 'topic', 'instruction', 'count', 'format']);
    if (!uuid(body.requestId) || !kinds.includes(body.kind) || typeof body.instruction !== 'string' || body.instruction.length > 2000 || body.format !== undefined && !formats.includes(body.format)) { fail(); }
    const fields = await this.chat.fields(user, { selection: body.selection, topic: body.topic ?? '' });
    let count = body.count;
    if (count === undefined) { count = (await this.client.config()).defaultCount; }
    if (!Number.isInteger(count) || count < 1 || count > 10) { fail(); }
    const request = { kind: body.kind, selection: fields.selection, topic: fields.topic || '', instruction: body.instruction.trim(), count, format: body.format || 'auto' };
    const row = await this.repository.create(user, body.requestId, request);
    if (row.status === 'deleted' || digest(row.request) !== digest(request)) { fail(409, 'request_conflict', 'Use a new request for a different draft.'); }
    return publicStudy(row);
  }
  async canonical(user, selection, raw, context) {
    const current = await this.search.resolver.resolve(user, selection);
    const allowed = new Map(current.sources.map(ref => [sourceKey(ref), ref]));
    if (!Array.isArray(raw?.citations) || raw.citations.length > 12 || !raw.citations.length || raw.citations.some(c => !c || !c.source || !allowed.has(sourceKey(c.source)))) { fail(409, 'source_changed', safeErrors.source_changed); }
    const refs = [...new Map(raw.citations.map(c => [sourceKey(c.source), allowed.get(sourceKey(c.source))])).values()];
    const result = await this.search.passages.fetch({ context: { ...context, scope: { ...context.scope, selection, sources: refs } }, chunk_ids: raw.citations.map(c => c.chunk_id) });
    const byKey = new Map(result.passages.map(p => [citationKey(p.citation), p.citation]));
    if (raw.citations.some(c => !byKey.has(citationKey(c)))) { fail(409, 'source_changed', safeErrors.source_changed); }
    const info = new Map(current.descriptors.map(s => [sourceKey(s), s]));
    return raw.citations.map(c => ({ ...byKey.get(citationKey(c)), number: c.number, title: info.get(sourceKey(c.source)).title, href: info.get(sourceKey(c.source)).href }));
  }
  async prepare(user, id) {
    const row = await this.owned(user, id);
    if (row.draft || row.content) { return { row, duplicate: true }; }
    const started = await this.repository.begin(user, row);
    if (!started) { fail(409, 'study_busy', 'Wait for the current draft or stop it first.'); }
    return started;
  }
  async *generate(user, started, signal) {
    const { row, run } = started, id = String(row._id);
    if (started.duplicate) { yield { type: 'done', artifact: publicStudy(row) }; return; }
    const controller = new AbortController(); this.controllers.set(run.id, controller);
    const stop = () => controller.abort(); signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) { controller.abort(); }
    let timer, completed = false;
    try {
      if (controller.signal.aborted) { return; }
      await this.chat.repository.quota(user, this.chat.dailyTurns, this.chat.globalTurns);
      const resolved = await this.search.resolver.resolve(user, row.request.selection);
      const context = { user_id: String(user), proposal_id: id, run_id: run.id,
        scope: { scope_id: id, selection: row.request.selection, sources: resolved.sources } };
      timer = setInterval(() => { void this.repository.heartbeat(user, id, run).then(record => { if (!record.modifiedCount) { controller.abort(); } }).catch(() => controller.abort()); }, 10000);
      for await (const event of this.client.stream({ ...row.request, selection: undefined, context }, controller.signal)) {
        if (controller.signal.aborted) { break; }
        if (event.type === 'status' && ['searching', 'drafting', 'checking'].includes(event.phase)) { yield { type: 'status', phase: event.phase }; }
        if (event.type === 'error') { fail(503, safeErrors[event.code] ? event.code : 'chat_unavailable'); }
        if (event.type === 'final') {
          const canonical = await this.canonical(user, row.request.selection, event.draft, context);
          const draft = validateDraft({ ...event.draft, citations: canonical }, row.kind);
          if (['flashcards', 'quiz'].includes(row.kind) && (draft.cards.length || draft.questions.length) !== row.request.count) { fail(503, 'draft_invalid'); }
          const saved = await this.repository.finish(user, id, run, { draft, title: draft.title, status: 'draft', model: String(event.model || '').slice(0, 100), usage: event.usage });
          if (!saved) { fail(409, 'source_changed'); }
          completed = true; yield { type: 'done', artifact: publicStudy(saved) }; break;
        }
      }
      if (!completed && !controller.signal.aborted) { fail(503, 'chat_unavailable'); }
    } catch (error) {
      const code = controller.signal.aborted ? 'cancelled' : error.code === 'invalid_draft' ? 'draft_invalid' : safeErrors[error.code] ? error.code : 'chat_unavailable';
      await this.repository.finish(user, id, run, { status: code === 'cancelled' ? 'cancelled' : 'failed', errorCode: code }).catch(() => {});
      if (!controller.signal.aborted) { yield { type: 'error', code, message: safeErrors[code] }; }
    } finally {
      if (timer) { clearInterval(timer); } signal.removeEventListener('abort', stop); this.controllers.delete(run.id); controller.abort();
      if (!completed) { await this.repository.cancel(user, id, run.id).catch(() => {}); }
    }
  }
  async cancel(user, id) { const row = await this.owned(user, id); this.controllers.get(row.activeRun?.id)?.abort(); return publicStudy(await this.repository.cancel(user, id, row.activeRun?.id) || row); }
  async edit(user, id, body) {
    exact(body, ['revision', 'draft']); const row = await this.owned(user, id);
    if (row.revision !== body.revision || !['draft', 'saved'].includes(row.status)) { fail(409, 'draft_changed', 'This draft changed. Reload before editing.'); }
    const original = row.draft || row.content, draft = validateDraft(body.draft, row.kind, original);
    const saved = await this.repository.edit(user, row, draft); if (!saved) { fail(409, 'draft_changed', 'This draft changed. Reload before saving.'); }
    return publicStudy(saved);
  }
  async confirmation(user, id, body) {
    exact(body, ['action', 'revision']); const row = await this.owned(user, id);
    const action = body.action;
    if (!['save', 'update', 'delete'].includes(action) || row.revision !== body.revision || row.status === 'generating'
      || action === 'save' && (row.status !== 'draft' || !row.draft) || action === 'update' && (row.status !== 'saved' || !row.draft)) { fail(409, 'draft_changed', 'Reload this study set before confirming.'); }
    const token = randomBytes(32).toString('base64url'), payloadDigest = digest(row.draft || row.content);
    const confirmation = { hash: hash(token), action, revision: row.revision, payloadDigest, expiresAt: new Date(this.repository.clock().getTime() + 10 * 60000) };
    const result = await StudyArtifact.updateOne({ _id: id, user, revision: row.revision, status: row.status }, { $set: { confirmation } });
    if (!result.matchedCount) { fail(409, 'draft_changed', 'The draft changed. Review it again.'); }
    return { token, revision: row.revision, action, expiresAt: confirmation.expiresAt, preview: row.draft || row.content, title: row.title };
  }
  async action(user, id, body) {
    exact(body, ['action', 'revision', 'token']);
    if (!['save', 'update', 'delete'].includes(body.action) || !Number.isInteger(body.revision) || typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) { fail(400, 'confirmation_required', 'Review and confirm this action first.'); }
    const row = await this.owned(user, id, true), tokenHash = hash(body.token), confirmation = row.confirmation;
    if (row.lastAction?.hash === tokenHash && row.lastAction.action === body.action) { return row.status === 'deleted' ? { deleted: true } : { artifact: publicStudy(row), duplicate: true }; }
    if (!confirmation || confirmation.hash !== tokenHash || confirmation.action !== body.action || row.revision !== body.revision || confirmation.revision !== body.revision
      || new Date(confirmation.expiresAt) <= this.repository.clock() || confirmation.payloadDigest !== digest(row.draft || row.content)) { fail(409, 'confirmation_expired', 'The draft changed or the confirmation expired. Review it again.'); }
    if (body.action !== 'delete') {
      const context = { user_id: String(user), run_id: randomUUID(), scope: { scope_id: id, selection: row.request.selection, sources: [] } };
      await this.canonical(user, row.request.selection, row.draft, context);
      validateDraft(row.draft, row.kind);
    }
    const deleted = body.action === 'delete';
    const fields = deleted ? { status: 'deleted', draft: null, content: null, request: {}, title: 'Deleted study set' }
      : { content: row.draft, draft: null, status: 'saved', title: row.draft.title, savedRevision: row.revision + 1 };
    const result = await StudyArtifact.findOneAndUpdate({ _id: id, user, revision: row.revision, status: row.status, 'confirmation.hash': tokenHash, 'confirmation.expiresAt': { $gt: this.repository.clock() } },
      { $set: { ...fields, confirmation: null, lastAction: { hash: tokenHash, action: body.action }, errorCode: null }, $inc: { revision: 1 } }, { new: true }).lean();
    if (!result) {
      const latest = await this.owned(user, id, true);
      if (latest.lastAction?.hash === tokenHash) { return latest.status === 'deleted' ? { deleted: true } : { artifact: publicStudy(latest), duplicate: true }; }
      fail(409, 'draft_changed', 'This study set changed. Review the latest version.');
    }
    return deleted ? { deleted: true } : { artifact: publicStudy(result) };
  }
  async source(user, id, number) {
    const row = await this.owned(user, id), citation = (row.draft || row.content)?.citations.find(c => c.number === number); if (!citation) { missing(); }
    const context = { user_id: String(user), run_id: randomUUID(), scope: { scope_id: id, sources: [], selection: row.request.selection } };
    await this.canonical(user, row.request.selection, { citations: [citation] }, context);
    const result = await this.search.passages.fetch({ context: { ...context, scope: { ...context.scope, sources: [citation.source] } }, chunk_ids: [citation.chunk_id] });
    return { passage: result.passages[0], title: citation.title, href: citation.href };
  }
  async practice(user, id) {
    const row = await this.owned(user, id), payload = row.content || row.draft;
    if (!payload || !['quiz', 'flashcards'].includes(row.kind)) { fail(409, 'not_practice', 'This study set is not ready to practice.'); }
    return { _id: String(row._id), title: payload.title, kind: row.kind, revision: row.status === 'saved' ? row.savedRevision : row.revision, saved: row.status === 'saved', citations: payload.citations,
      ...(row.kind === 'flashcards' ? { cards: payload.cards } : { questions: payload.questions.map((q, index) => ({ id: 'q' + (index + 1), kind: q.kind, prompt: q.prompt, options: q.options, language: q.language, starterCode: q.starterCode, citationNumbers: q.citationNumbers })) }) };
  }
  async feedback(user, id, body) {
    exact(body, ['revision', 'questionId', 'answer', 'reveal']);
    const row = await this.owned(user, id), payload = row.content || row.draft;
    if (row.kind !== 'quiz' || !payload || (row.status === 'saved' ? row.savedRevision : row.revision) !== body.revision) { fail(409, 'study_changed', 'This quiz changed. Restart to use the latest questions.'); }
    const match = /^q([1-9]|10)$/.exec(body.questionId || ''), question = match && payload.questions[Number(match[1]) - 1]; if (!question) { missing(); }
    const reveal = body.reveal === true;
    if (question.kind === 'choice') {
      if (!reveal && (!Number.isInteger(body.answer) || body.answer < 0 || body.answer >= question.options.length)) { fail(); }
      return { kind: 'choice', correctIndex: question.correctIndex, correct: !reveal && body.answer === question.correctIndex, revealed: reveal, explanation: question.explanation };
    }
    if (!reveal && (typeof body.answer !== 'string' || !body.answer.trim() || body.answer.length > 12000)) { fail(); }
    return { kind: question.kind, referenceAnswer: question.referenceAnswer, rubric: question.rubric, explanation: question.explanation, selfReview: true };
  }
  async fromChat(user, conversation, run, raw) {
    const context = { user_id: String(user), conversation_id: String(conversation._id), run_id: run.id, scope: { scope_id: String(conversation._id), selection: conversation.selection, sources: [] } };
    const citations = await this.canonical(user, conversation.selection, raw, context);
    const draft = validateDraft({ ...raw, citations }, raw.kind);
    const request = { kind: draft.kind, selection: conversation.selection, topic: conversation.topic, instruction: '', count: draft.cards.length || draft.questions.length || 1, format: 'auto' };
    const row = await this.repository.create(user, run.id, request, conversation._id);
    const result = await StudyArtifact.findOneAndUpdate({ _id: row._id, user, status: 'queued' }, { $set: { status: 'draft', title: draft.title, draft }, $inc: { revision: 1 } }, { new: true }).lean();
    return publicStudy(result || row);
  }
}
