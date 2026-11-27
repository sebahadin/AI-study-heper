import { Document, Note } from '../db.mjs';
import mongoose from 'mongoose';
import { DocumentError } from '../documents/errors.mjs';
import { sourceKey } from './scope.mjs';

export class CanonicalPassages {
  constructor({ resolver } = {}) { this.resolver = resolver; }
  async overview(body) {
    const context = await this.resolver.refresh(body?.context);
    const groups = await Promise.all([['note', Note], ['document', Document]].map(async ([type, model]) => {
      const refs = context.scope.sources.filter(ref => ref.source_type === type);
      if (!refs.length) { return []; }
      return model.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(context.user_id), deletedAt: null,
          ...(type === 'document' ? { status: 'uploaded' } : {}), 'indexing.status': 'ready',
          $expr: { $and: [{ $eq: ['$user', '$indexing.user'] }, { $eq: ['$sourceVersion', '$indexing.sourceVersion'] }] },
          $or: refs.map(ref => ({ _id: new mongoose.Types.ObjectId(ref.source_id), sourceVersion: ref.source_version, 'indexing.activeGeneration': ref.index_generation })),
        } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, passages: [
          { $arrayElemAt: ['$indexing.passages', 0] },
          { $arrayElemAt: ['$indexing.passages', { $floor: { $divide: [{ $size: { $ifNull: ['$indexing.passages', []] } }, 2] } }] },
          { $arrayElemAt: ['$indexing.passages', -1] },
        ] } },
      ]);
    }));
    const rows = groups.flat(), passages = [], seen = new Set(); let size = 0;
    for (let position = 0; position < 3; position++) {
      for (const row of rows) {
        const passage = row.passages[position];
        if (passage?.text && !seen.has(passage.citation.chunk_id) && passages.length < 12 && size + passage.text.length <= 12000) {
          passages.push(passage); seen.add(passage.citation.chunk_id); size += passage.text.length;
        }
      }
    }
    return { passages };
  }
  async fetch(body) {
    const context = body?.context, ids = body?.chunk_ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || !Array.isArray(context?.scope?.sources)
        || context.scope.sources.length > 100 || !/^[a-f0-9]{24}$/i.test(context.user_id || '')
        || ids.some(id => typeof id !== 'string' || !/^[a-z]+-[a-f0-9]{64}$/.test(id))) {
      throw new DocumentError(400, 'invalid_passage_request', 'Use a bounded set of scoped passage IDs.');
    }
    let allowed;
    if (context.scope.selection !== undefined && context.scope.selection !== null) {
      const current = await this.resolver.refresh(context);
      allowed = new Set(current.scope.sources.map(sourceKey));
    }
    const found = new Map();
    await Promise.all([['note', Note], ['document', Document]].map(async ([type, model]) => {
      const refs = context.scope.sources.filter(ref => ref?.source_type === type && /^[a-f0-9]{24}$/i.test(ref.source_id || '')
        && typeof ref.source_version === 'string' && typeof ref.index_generation === 'string' && (!allowed || allowed.has(sourceKey(ref))));
      if (!refs.length) { return; }
      // Return requested canonical chunks only, rather than loading every manifest.
      const rows = await model.aggregate([
        { $match: { user: new mongoose.Types.ObjectId(context.user_id), deletedAt: null,
          ...(type === 'document' ? { status: 'uploaded' } : {}), 'indexing.status': 'ready',
          $expr: { $and: [{ $eq: ['$user', '$indexing.user'] }, { $eq: ['$sourceVersion', '$indexing.sourceVersion'] }] },
          $or: refs.map(ref => ({ _id: new mongoose.Types.ObjectId(ref.source_id), sourceVersion: ref.source_version, 'indexing.activeGeneration': ref.index_generation })),
        } },
        { $project: { _id: 0, passages: { $filter: { input: { $ifNull: ['$indexing.passages', []] }, as: 'passage', cond: { $in: ['$$passage.citation.chunk_id', ids] } } } } },
      ]);
      for (const row of rows) {
        for (const passage of row.passages) { found.set(passage.citation.chunk_id, passage); }
      }
    }));
    return { passages: ids.filter(id => found.has(id)).map(id => found.get(id)) };
  }
}
