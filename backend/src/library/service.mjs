import { createHash } from 'node:crypto';
import { Book, Course, Note, Document, Flashcard, StudyArtifact, Conversation } from '../db.mjs';
import { QuizAttempt } from '../learning/models.mjs';
import { publicAttempt } from '../learning/policy.mjs';
import { parseSelection, objectId, plainObject } from '../retrieval/scope.mjs';
import { ChatError } from '../chat/policy.mjs';
const models = { books: Book, courses: Course, notes: Note, documents: Document, flashcards: Flashcard, study_sets: StudyArtifact, quiz_attempts: QuizAttempt, conversations: Conversation };
const paths = { books: 'books', courses: 'courses', notes: 'notes', documents: 'documents', flashcards: 'flashcards/edit', study_sets: 'study-tools', quiz_attempts: 'learning/attempts', conversations: 'chat' };
const labels = { books: 'books', courses: 'courses', notes: 'notes', documents: 'PDF documents', flashcards: 'flashcards', study_sets: 'study sets', quiz_attempts: 'quiz attempts', conversations: 'conversations' };
const singular = { books: 'book', courses: 'course', notes: 'note', documents: 'PDF document', flashcards: 'flashcard', study_sets: 'study set', quiz_attempts: 'quiz attempt', conversations: 'conversation' };
const keys = ['kind', 'query', 'item_id', 'cursor', 'limit', 'course_id', 'book_id', 'course_query', 'book_query', 'study_kind'];
const invalid = () => { throw new ChatError(400, 'invalid_library_query', 'Choose a valid library item or search.'); };
const unavailable = () => { throw new ChatError(404, 'material_not_found', 'That item is not available in this study space.'); };
const literal = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const regex = value => ({ $regex: literal(value), $options: 'i' });
const and = (...filters) => ({ $and: filters.filter(Boolean) });
const any = clauses => clauses.length ? { $or: clauses } : { _id: { $in: [] } };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ids = rows => rows.map(r => String(r._id));
const md = value => String(value ?? '').replace(/[\\`*_[\]{}()<>#!|]/g, '\\$&').replace(/[\r\n]+/g, ' ');
export class LibraryService {
  constructor({ clock = () => new Date() } = {}) { this.clock = clock; }
  parse(raw) {
    if (!plainObject(raw) || Object.keys(raw).some(k => !keys.includes(k)) || raw.kind !== 'library' && !Object.hasOwn(models, raw.kind)) { invalid(); }
    const result = { kind: raw.kind };
    for (const key of keys.filter(k => !['kind', 'limit'].includes(k))) {
      const value = raw[key] ?? ''; if (typeof value !== 'string' || value.length > (key === 'cursor' ? 300 : 160)) { invalid(); } result[key] = value.trim();
    }
    result.limit = raw.limit ?? 10;
    if (!Number.isInteger(result.limit) || result.limit < 1 || result.limit > 20 || ['item_id', 'course_id', 'book_id'].some(k => result[k] && !objectId(result[k])) || result.study_kind && !['summary', 'explanation', 'flashcards', 'quiz'].includes(result.study_kind)) { invalid(); }
    return result;
  }
  async authorize(context) {
    if (!plainObject(context) || Object.keys(context).some(k => !['user_id', 'conversation_id', 'proposal_id', 'run_id', 'scope'].includes(k)) || !objectId(context.user_id) || !objectId(context.conversation_id) || context.proposal_id || typeof context.run_id !== 'string' || context.run_id.length > 128) { invalid(); }
    const conversation = await Conversation.findOne({ _id: context.conversation_id, user: context.user_id, 'activeRun.id': context.run_id, 'activeRun.leaseUntil': { $gt: this.clock() } }).select('selection').lean();
    if (!conversation || JSON.stringify(parseSelection(context.scope?.selection)) !== JSON.stringify(parseSelection(conversation.selection))) { throw new ChatError(404, 'scope_changed', 'This conversation is no longer active in that study space.'); }
    const selection = parseSelection(conversation.selection), user = context.user_id;
    for (const [kind, Model] of [['books', Book], ['courses', Course], ['notes', Note], ['documents', Document]]) {
      if (selection[kind].length && await Model.countDocuments({ user, _id: { $in: selection[kind] }, ...(kind === 'documents' && { status: { $nin: ['deleted', 'deleting'] } }) }) !== selection[kind].length) { unavailable(); }
    }
    return { user, selection, conversationId: context.conversation_id };
  }
  async scope(auth) {
    if (auth.selection.library) { return Object.fromEntries(Object.keys(models).map(k => [k, {}])); }
    const s = auth.selection, user = auth.user;
    const books = await Book.find({ user, ...any([{ _id: { $in: s.books } }, { courses: { $in: s.courses } }]) }).select('_id courses').lean();
    const bookIds = ids(books);
    const notes = await Note.find({ user, ...any([{ _id: { $in: s.notes } }, { book: { $in: bookIds } }, { courses: { $in: s.courses } }]) }).select('_id book courses').lean();
    const noteIds = ids(notes);
    const documents = await Document.find({ user, status: { $nin: ['deleted', 'deleting'] }, ...any([{ _id: { $in: s.documents } }, { book: { $in: bookIds } }, { note: { $in: noteIds } }, { courses: { $in: s.courses } }]) }).select('_id book note courses').lean();
    const documentIds = ids(documents), parents = [...bookIds, ...notes.map(n => n.book), ...documents.map(d => d.book)].filter(Boolean);
    const parentBooks = await Book.find({ user, _id: { $in: parents } }).select('_id courses').lean();
    const courseIds = [...s.courses, ...[...parentBooks, ...notes, ...documents].flatMap(r => r.courses || [])];
    const association = prefix => any([{ [`${prefix}.books`]: { $in: bookIds } }, { [`${prefix}.courses`]: { $in: s.courses } }, { [`${prefix}.notes`]: { $in: noteIds } }, { [`${prefix}.documents`]: { $in: documentIds } }]);
    const sourceIds = [...noteIds, ...documentIds];
    return { books: { _id: { $in: ids(parentBooks) } }, courses: { _id: { $in: courseIds } }, notes: { _id: { $in: noteIds } }, documents: { _id: { $in: documentIds } },
      flashcards: any([{ tags: { $in: bookIds } }, { courses: { $in: s.courses } }]),
      study_sets: any([association('request.selection'), { 'content.citations.source.source_id': { $in: sourceIds } }, { 'draft.citations.source.source_id': { $in: sourceIds } }]),
      quiz_attempts: association('associations'), conversations: { _id: auth.conversationId } };
  }
  base(user, kind) { return { user, ...(kind === 'documents' && { status: { $nin: ['deleted', 'deleting'] } }), ...(kind === 'study_sets' && { status: { $ne: 'deleted' } }) }; }
  async narrow(auth, scope, args) {
    let course = args.course_id, book = args.book_id;
    for (const [kind, query, explicit] of [['courses', args.course_query, course], ['books', args.book_query, book]]) {
      if (!query && !explicit) { continue; }
      const filter = and(this.base(auth.user, kind), scope[kind], explicit ? { _id: explicit } : { $or: [{ title: regex(query) }, ...(kind === 'courses' ? [{ code: regex(query) }] : [])] });
      const rows = await models[kind].find(filter).select('_id title code author').sort({ _id: 1 }).limit(3).lean();
      if (!rows.length) { return { issue: { kind, total: 0, items: [] } }; }
      if (rows.length > 1) { return { issue: { kind, total: await models[kind].countDocuments(filter), items: rows.map(r => this.item(kind, r)) } }; }
      if (kind === 'courses') { course = String(rows[0]._id); } else { book = String(rows[0]._id); }
    }
    if (!course && !book) { return {}; }
    const related = await this.connectionsFilters(auth.user, course ? 'courses' : 'books', course || book);
    return { filter: and(related[args.kind] || { _id: { $in: [] } }, book ? (args.kind === 'books' ? { _id: book } : (await this.connectionsFilters(auth.user, 'books', book))[args.kind]) : null) };
  }
  projection(kind, detail) {
    const common = { books: 'title author category description courses', courses: 'title code term instructor description', notes: `title book courses${detail ? ' content' : ''}`,
      documents: `title filename pageCount status indexing.status book note courses${detail ? ' user sourceVersion indexing.user indexing.sourceVersion indexing.activeGeneration indexing.passages' : ''}`, flashcards: `question tags courses${detail ? ' options correctIndex' : ''}`,
      study_sets: `title kind status content.title request.selection${detail ? ' content.body content.cards content.questions draft.title draft.body draft.cards draft.questions' : ''}`,
      quiz_attempts: detail ? '+questions' : 'title origin status completedAt', conversations: detail ? 'title topic messages selection' : 'title topic messageCount' };
    return common[kind];
  }
  item(kind, row, detail = false) {
    const title = String(row.content?.title || row.title || row.question || 'Untitled').slice(0, 200), facts = [], add = (label, value) => { if (value !== undefined && value !== null && value !== '') { facts.push({ label, value: String(value).slice(0, 500) }); } };
    if (kind === 'books') { add('Author', row.author); add('Category', row.category); }
    if (kind === 'courses') { add('Code', row.code); add('Term', row.term); add('Instructor', row.instructor); }
    if (kind === 'documents') { add('Filename', row.filename); add('Pages', row.pageCount); add('Upload', row.status); add('Index', row.indexing?.status || 'not_requested'); }
    if (kind === 'study_sets') { add('Type', row.kind); add('State', row.status); }
    if (kind === 'quiz_attempts') { add('State', row.status); add('Origin', row.origin); }
    if (kind === 'conversations') { add('Topic', row.topic); add('Messages', row.messageCount); }
    let text = '';
    if (detail) {
      if (kind === 'books' || kind === 'courses') { text = row.description || ''; if (kind === 'books') { add('Readable content', 'This is a book record. Explore its linked notes and PDFs for study text.'); } }
      if (kind === 'notes') { text = row.content || ''; }
      if (kind === 'documents') {
        const index = row.indexing;
        if (index?.status === 'ready' && String(index.user) === String(row.user) && index.sourceVersion === row.sourceVersion) {
          text = (index.passages || []).filter(p => p.citation?.source?.source_id === String(row._id) && p.citation.source.source_version === row.sourceVersion && p.citation.source.index_generation === index.activeGeneration).map(p => `${p.citation.locator}: ${p.text}`).join('\n\n');
        }
        if (!text) { add('Content', 'Extracted text is not ready. You can open the original PDF or check indexing.'); }
      }
      if (kind === 'flashcards') { text = row.options.map((v, i) => `${i + 1}. ${v}${i === row.correctIndex ? ' (correct answer)' : ''}`).join('\n'); }
      if (kind === 'study_sets') { const p = row.content || row.draft; text = p?.body || (p?.cards || []).slice(0, 10).map((c, i) => `${i + 1}. ${c.front}\n${c.back}`).join('\n\n') || (p?.questions || []).slice(0, 10).map((q, i) => `${i + 1}. ${q.prompt}`).join('\n\n'); }
      if (kind === 'quiz_attempts') { const a = publicAttempt(row); add('Choice score', `${a.summary.choice.earned}/${a.summary.choice.possible}`); add('AI-assessed points', `${a.summary.ai.earned}/${a.summary.ai.possible}`); add('Awaiting AI assessment', a.summary.ai.pending); text = a.questions.slice(0, 10).map(q => `${q.prompt}\nYour answer: ${a.answers[q.id]?.value ?? 'Not answered'}`).join('\n\n'); }
      if (kind === 'conversations') { text = row.messages.filter(m => m.status === 'completed').slice(-6).map(m => `${m.role === 'user' ? 'You' : 'Classmate'}: ${m.content.slice(0, 1000)}`).join('\n\n'); }
    }
    return { id: String(row._id), kind, title, href: `/${paths[kind]}/${row._id}`, facts, excerpt: text.slice(0, 4000), truncated: text.length > 4000 };
  }
  async query(context, operation, raw) {
    if (!['list_library_items', 'get_library_item', 'explore_connections', 'get_library_overview'].includes(operation)) { invalid(); }
    const args = this.parse(raw), auth = await this.authorize(context), scope = await this.scope(auth);
    const result = { operation, kind: args.kind, query: args, scope_label: auth.selection.library ? 'My library' : 'Selected materials', status: 'ok', total: 0, items: [], next_cursor: null, related: [] };
    if (operation === 'get_library_overview') {
      result.kind = 'library';
      for (const kind of Object.keys(models)) {
        const narrowed = await this.narrow(auth, scope, { ...args, kind });
        if (narrowed.issue) { return { ...result, status: narrowed.issue.total ? 'ambiguous' : 'not_found', kind: narrowed.issue.kind, total: narrowed.issue.total, items: narrowed.issue.items }; }
        const filter = and(this.base(auth.user, kind), scope[kind], narrowed.filter);
        const [total, rows] = await Promise.all([models[kind].countDocuments(filter), models[kind].find(filter).select(this.projection(kind, false)).sort({ _id: 1 }).limit(3).lean()]);
        result.total += total; result.related.push({ kind, total, items: rows.map(r => this.item(kind, r)) });
      }
      return result;
    }
    if (args.kind === 'library') { invalid(); }
    const narrowed = await this.narrow(auth, scope, args);
    if (narrowed.issue) { return { ...result, status: narrowed.issue.total ? 'ambiguous' : 'not_found', kind: narrowed.issue.kind, total: narrowed.issue.total, items: narrowed.issue.items }; }
    const fields = args.kind === 'flashcards' ? ['question'] : args.kind === 'study_sets' ? ['title', 'content.title', 'draft.title'] : ['title', ...(args.kind === 'books' ? ['author', 'category'] : args.kind === 'courses' ? ['code'] : args.kind === 'documents' ? ['filename'] : args.kind === 'notes' ? ['content'] : [])];
    const filter = and(this.base(auth.user, args.kind), scope[args.kind], narrowed.filter, args.item_id ? { _id: args.item_id } : args.query ? { $or: fields.map(f => ({ [f]: regex(args.query) })) } : null, args.study_kind && args.kind === 'study_sets' ? { kind: args.study_kind } : null);
    const total = await models[args.kind].countDocuments(filter); result.total = total;
    let pageFilter = filter;
    const signature = hash([auth.selection, operation, { ...args, cursor: '' }]);
    if (args.cursor) {
      try { const [signatureIn, id] = JSON.parse(Buffer.from(args.cursor, 'base64url').toString()); if (signatureIn !== signature || !objectId(id)) { invalid(); } pageFilter = and(filter, { _id: { $gt: id } }); }
      catch { invalid(); }
    }
    const detail = operation !== 'list_library_items', limit = detail ? 2 : args.limit;
    const rows = await models[args.kind].find(pageFilter).select(this.projection(args.kind, detail)).sort({ _id: 1 }).limit(limit + 1).lean();
    if (!total) { return { ...result, status: 'not_found' }; }
    if (detail && total > 1) { return { ...result, status: 'ambiguous', items: rows.slice(0, 3).map(r => this.item(args.kind, r)) }; }
    const more = rows.length > limit; if (more) { rows.pop(); }
    result.items = rows.map(r => this.item(args.kind, r, detail));
    if (more && !detail) { result.next_cursor = Buffer.from(JSON.stringify([signature, String(rows.at(-1)._id)])).toString('base64url'); }
    if (operation === 'explore_connections') {
      const filters = await this.connectionsFilters(auth.user, args.kind, String(rows[0]._id));
      for (const [kind, relation] of Object.entries(filters)) {
        const linked = and(this.base(auth.user, kind), scope[kind], relation, kind === args.kind ? { _id: { $ne: rows[0]._id } } : null);
        const [count, records] = await Promise.all([models[kind].countDocuments(linked), models[kind].find(linked).select(this.projection(kind, false)).sort({ _id: 1 }).limit(3).lean()]);
        if (count) { result.related.push({ kind, total: count, items: records.map(r => this.item(kind, r)) }); }
      }
    }
    return result;
  }
  async connectionsFilters(user, kind, id) {
    const row = await models[kind].findOne({ user, _id: id }).select('courses book note tags request.selection content.citations draft.citations selection associations').lean(); if (!row) { unavailable(); }
    let courseIds = kind === 'courses' ? [id] : (row.courses || []).map(String), bookIds = kind === 'books' ? [id] : kind === 'flashcards' ? (row.tags || []).map(String) : row.book ? [String(row.book)] : [];
    let selectedNotes = [], selectedDocuments = [];
    if (['study_sets', 'quiz_attempts', 'conversations'].includes(kind)) {
      const selection = row.associations || row.request?.selection || row.selection || {};
      if (kind === 'conversations' && selection.library) { return Object.fromEntries(Object.keys(models).filter(k => k !== 'conversations').map(k => [k, {}])); }
      courseIds = (selection.courses || []).map(String); bookIds = (selection.books || []).map(String); selectedNotes = (selection.notes || []).map(String); selectedDocuments = (selection.documents || []).map(String);
      for (const c of row.content?.citations || row.draft?.citations || []) { (c.source.source_type === 'note' ? selectedNotes : selectedDocuments).push(c.source.source_id); }
      const linkedBooks = await Book.find({ user, courses: { $in: courseIds } }).select('_id').lean(); bookIds.push(...ids(linkedBooks));
      const linkedNotes = await Note.find({ user, _id: { $in: selectedNotes } }).select('book').lean(); bookIds.push(...linkedNotes.filter(n => n.book).map(n => String(n.book)));
    }
    if (kind === 'courses') { bookIds = ids(await Book.find({ user, courses: id }).select('_id').lean()); }
    const parents = await Book.find({ user, _id: { $in: bookIds } }).select('courses').lean();
    courseIds = [...new Set([...courseIds, ...parents.flatMap(b => b.courses || []).map(String)])];
    const noteFilter = kind === 'notes' ? { _id: id } : any([{ _id: { $in: selectedNotes } }, { book: { $in: bookIds } }, ...(kind === 'courses' ? [{ courses: id }] : []), ...(row.note ? [{ _id: row.note }] : [])]);
    const noteIds = ids(await Note.find({ user, ...noteFilter }).select('_id').lean());
    const documents = any([{ _id: { $in: selectedDocuments } }, { book: { $in: bookIds } }, { note: { $in: noteIds } }, ...(kind === 'courses' ? [{ courses: id }] : []), ...(kind === 'documents' ? [{ _id: id }] : [])]);
    const documentIds = ids(await Document.find({ user, status: { $nin: ['deleted', 'deleting'] }, ...documents }).select('_id').lean());
    const association = prefix => any([{ [`${prefix}.books`]: { $in: bookIds } }, { [`${prefix}.courses`]: { $in: kind === 'courses' ? [id] : [] } }, { [`${prefix}.notes`]: { $in: noteIds } }, { [`${prefix}.documents`]: { $in: documentIds } }]);
    return { courses: { _id: { $in: courseIds } }, books: { _id: { $in: bookIds } }, notes: noteFilter, documents,
      flashcards: any([{ tags: { $in: bookIds } }, ...(kind === 'courses' ? [{ courses: id }] : [])]),
      study_sets: any([association('request.selection'), { 'content.citations.source.source_id': { $in: [...noteIds, ...documentIds] } }, { 'draft.citations.source.source_id': { $in: [...noteIds, ...documentIds] } }]), quiz_attempts: association('associations') };
  }
  memory(result) { return { operation: result.operation, kind: result.kind, query: result.query, total: result.total, next_cursor: result.next_cursor, scope_label: result.scope_label, items: result.items.map(({ id, kind, title }) => ({ id, kind, title })) }; }
  render(result) {
    const text = this.renderFull(result);
    if (text.length <= 12000) { return text; }
    const lines = []; let length = 0;
    for (const line of text.split('\n')) { if (length + line.length + 1 > 11600) { break; } lines.push(line); length += line.length + 1; }
    return lines.join('\n') + '\n\nThis view is shortened. Open an item or ask to list a smaller group for more.';
  }
  renderFull(result) {
    const link = item => `[${md(item.title)}](${item.href})`, list = item => `- ${link(item)}${item.facts.length ? ` — ${item.facts.map(f => `${md(f.label)}: ${md(f.value)}`).join(' · ')}` : ''}`;
    const scope = result.scope_label === 'My library' ? 'your library' : 'your selected study materials';
    if (result.operation === 'get_library_overview') { return `Here is the current overview of ${scope}:\n\n${result.related.map(g => `**${labels[g.kind]}: ${g.total}**${g.items.length ? `\n${g.items.map(list).join('\n')}` : ''}`).join('\n\n')}\n\nAsk to list a group, open an item, or explore its linked materials.`; }
    if (result.status === 'not_found') { return `I couldn’t find any matching ${labels[result.kind]} in ${scope}.${result.query.query ? ` Search: “${md(result.query.query)}”.` : ''}`; }
    if (result.status === 'ambiguous') { return `I found ${result.total} matching ${labels[result.kind]}. Which one did you mean?\n\n${result.items.map(list).join('\n')}`; }
    if (result.operation === 'list_library_items') { return `I found ${result.total} ${result.total === 1 ? singular[result.kind] : labels[result.kind]}${result.query.query ? ` matching “${md(result.query.query)}”` : ''} in ${scope}.\n\n${result.items.map(list).join('\n')}${result.next_cursor ? `\n\nShowing ${result.items.length} on this page. Ask “show the next page” to continue.` : ''}`; }
    const item = result.items[0], parts = [`**${link(item)}**`, ...item.facts.map(f => `${md(f.label)}: ${md(f.value)}`)];
    if (item.excerpt) { parts.push(item.kind === 'conversations' ? 'Historical conversation excerpt:' : ['books', 'courses'].includes(item.kind) ? 'Record description:' : 'Saved content excerpt:', item.excerpt.split('\n').map(line => `> ${line}`).join('\n'), ...(item.truncated ? ['This excerpt is shortened. Open the original to read the rest.'] : [])); }
    if (result.operation === 'explore_connections') { parts.push('**Linked study materials**', ...(result.related.length ? result.related.map(g => `${labels[g.kind]} (${g.total}):\n${g.items.map(list).join('\n')}${g.total > g.items.length ? '\nShowing a selection; ask to list this group for more.' : ''}`) : ['No linked study materials were found in this scope.'])); }
    return parts.join('\n\n');
  }
  async fromChat(context, request) { const result = await this.query(context, request.operation, request.arguments); return { content: this.render(result), mode: 'library', citations: [], library: this.memory(result) }; }
}
