import { Book, Course, Document, Note, Conversation, StudyArtifact } from '../db.mjs';
import { RetrievalError, unavailable } from './errors.mjs';

export const MAX_SCOPE_SOURCES = 100;
const groups = { documents: Document, notes: Note, books: Book, courses: Course };
export const objectId = value => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
export const plainObject = value => value && typeof value === 'object' && !Array.isArray(value);
const invalid = () => new RetrievalError(400, 'invalid_scope', 'Choose valid study materials for this search.');
export const sourceKey = ref => JSON.stringify([ref.source_type, ref.source_id, ref.source_version, ref.index_generation]);

export function parseSelection(raw) {
  if (!plainObject(raw) || Object.keys(raw).some(key => !['library', ...Object.keys(groups)].includes(key))
      || (raw.library !== undefined && typeof raw.library !== 'boolean')) { throw invalid(); }
  const selected = { library: raw.library === true };
  let count = 0;
  for (const group of Object.keys(groups)) {
    const ids = raw[group] === undefined ? [] : raw[group];
    if (!Array.isArray(ids) || ids.length > 20 || ids.some(id => !objectId(id))) { throw invalid(); }
    selected[group] = [...new Set(ids.map(id => id.toLowerCase()))]; count += selected[group].length;
  }
  if (count > 50 || selected.library && count) { throw invalid(); }
  return selected;
}

const projection = { _id: 1, user: 1, title: 1, sourceVersion: 1,
  'indexing.user': 1, 'indexing.sourceVersion': 1, 'indexing.activeGeneration': 1 };
const ready = profile => ({ 'indexing.status': 'ready', 'indexing.embeddingModel': profile.embedding_model,
  'indexing.indexVersion': profile.index_version, 'indexing.activeGeneration': { $type: 'string' },
  $expr: { $and: [{ $eq: ['$user', '$indexing.user'] }, { $eq: ['$sourceVersion', '$indexing.sourceVersion'] }] } });

export class StudyScopeResolver {
  constructor({ profile }) { this.profile = profile; }

  async records(user, noteFilter, documentFilter) {
    const profile = await this.profile();
    if (!['embedding_model', 'index_version'].every(key => typeof profile?.[key] === 'string' && profile[key].length > 0 && profile[key].length <= 1024)) { throw unavailable(); }
    const [notes, documents] = await Promise.all([
      Note.find({ user, deletedAt: null, ...ready(profile), ...noteFilter }).select(projection).schemaLevelProjections(false).limit(MAX_SCOPE_SOURCES + 1).lean(),
      Document.find({ user, status: 'uploaded', ...ready(profile), ...documentFilter }).select(projection).limit(MAX_SCOPE_SOURCES + 1).lean(),
    ]);
    if (notes.length + documents.length > MAX_SCOPE_SOURCES) {
      throw new RetrievalError(409, 'scope_too_large', 'Choose a smaller set of books, notes, documents, or courses.');
    }
    const sources = [], descriptors = [];
    for (const [type, rows] of [['note', notes], ['document', documents]]) {
      for (const row of rows) {
        if (typeof row.sourceVersion !== 'string' || !row.sourceVersion || !row.indexing.activeGeneration) { continue; }
        const source = { source_id: String(row._id), source_type: type, source_version: row.sourceVersion, index_generation: row.indexing.activeGeneration };
        sources.push(source);
        descriptors.push({ ...source, title: row.title, href: `/${type === 'note' ? 'notes' : 'documents'}/${row._id}` });
      }
    }
    return { sources, descriptors };
  }

  async resolve(user, raw) {
    user = String(user);
    if (!objectId(user)) { throw invalid(); }
    const selection = parseSelection(raw);
    if (selection.library) { return { ...await this.records(user, {}, {}), selection }; }
    const total = Object.keys(groups).reduce((sum, group) => sum + selection[group].length, 0);
    if (!total) { return { sources: [], descriptors: [], selection }; }
    await Promise.all(Object.entries(groups).map(async ([group, model]) => {
      const ids = selection[group];
      if (!ids.length) { return; }
      const exists = await model.countDocuments({ user, _id: { $in: ids },
        ...(model === Document ? { status: { $nin: ['deleted', 'deleting'] } } : {}) });
      if (exists !== ids.length) { throw new RetrievalError(404, 'material_not_found', 'A selected study material is no longer available.'); }
    }));
    const courseBooks = selection.courses.length ? await Book.find({ user, courses: { $in: selection.courses } }).select('_id').lean() : [];
    const bookIds = [...selection.books, ...courseBooks.map(book => String(book._id))];
    const noteClauses = [];
    if (selection.notes.length) { noteClauses.push({ _id: { $in: selection.notes } }); }
    if (bookIds.length) { noteClauses.push({ book: { $in: bookIds } }); }
    if (selection.courses.length) { noteClauses.push({ courses: { $in: selection.courses } }); }
    const noteFilter = noteClauses.length ? { $or: noteClauses } : { _id: { $in: [] } };
    // Linked PDFs inherit a note's current book/course membership, even before that note is indexed.
    const relatedNotes = noteClauses.length ? await Note.find({ user, ...noteFilter }).select('_id').lean() : [];
    const documentClauses = [];
    if (selection.documents.length) { documentClauses.push({ _id: { $in: selection.documents } }); }
    if (bookIds.length) { documentClauses.push({ book: { $in: bookIds } }); }
    if (selection.courses.length) { documentClauses.push({ courses: { $in: selection.courses } }); }
    if (relatedNotes.length) { documentClauses.push({ note: { $in: relatedNotes.map(note => note._id) } }); }
    const documentFilter = documentClauses.length ? { $or: documentClauses } : { _id: { $in: [] } };
    return { ...await this.records(user, noteFilter, documentFilter), selection };
  }

  async refresh(context) {
    if (!plainObject(context) || Object.keys(context).some(key => !['user_id', 'run_id', 'conversation_id', 'proposal_id', 'scope'].includes(key))
        || !objectId(context.user_id) || typeof context.run_id !== 'string' || !context.run_id || context.run_id.length > 128
        || !plainObject(context.scope) || Object.keys(context.scope).some(key => !['scope_id', 'sources', 'selection', 'topics'].includes(key))
        || typeof context.scope.scope_id !== 'string' || !context.scope.scope_id || context.scope.scope_id.length > 128
        || !Array.isArray(context.scope.sources) || context.scope.sources.length > MAX_SCOPE_SOURCES
        || context.scope.sources.some(ref => !plainObject(ref) || !objectId(ref.source_id) || !['note', 'document'].includes(ref.source_type)
          || !['source_version', 'index_generation'].every(key => typeof ref[key] === 'string' && ref[key].length > 0 && ref[key].length <= 200))) { throw invalid(); }
    if (context.conversation_id && context.proposal_id) { throw invalid(); }
    if (context.proposal_id) {
      if (!objectId(context.proposal_id)) { throw invalid(); }
      const proposal = await StudyArtifact.findOne({ _id: context.proposal_id, user: context.user_id, status: 'generating',
        'activeRun.id': context.run_id, 'activeRun.leaseUntil': { $gt: new Date() },
      }).select('request.selection').lean();
      if (!proposal || JSON.stringify(parseSelection(context.scope.selection)) !== JSON.stringify(parseSelection(proposal.request.selection))) {
        throw new RetrievalError(404, 'scope_changed', 'This study request is no longer active.');
      }
    }
    if (context.conversation_id) {
      if (!objectId(context.conversation_id)) { throw invalid(); }
      const conversation = await Conversation.findOne({ _id: context.conversation_id, user: context.user_id,
        'activeRun.id': context.run_id, 'activeRun.leaseUntil': { $gt: new Date() },
      }).select('selection topic').lean();
      if (!conversation || JSON.stringify(parseSelection(context.scope.selection)) !== JSON.stringify(parseSelection(conversation.selection))) {
        throw new RetrievalError(404, 'scope_changed', 'This conversation scope is no longer active.');
      }
    }
    if (context.scope.selection !== undefined && context.scope.selection !== null) {
      const resolved = await this.resolve(context.user_id, context.scope.selection);
      return { ...context, scope: { ...context.scope, sources: resolved.sources, selection: resolved.selection } };
    }
    if (!context.scope.sources.length) { return context; }
    const refs = context.scope.sources;
    const current = await this.records(context.user_id,
      { _id: { $in: refs.filter(ref => ref.source_type === 'note').map(ref => ref.source_id) } },
      { _id: { $in: refs.filter(ref => ref.source_type === 'document').map(ref => ref.source_id) } });
    const allowed = new Set(current.sources.map(sourceKey));
    return { ...context, scope: { ...context.scope, sources: refs.filter(ref => allowed.has(sourceKey(ref))) } };
  }
}
