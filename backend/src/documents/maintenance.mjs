import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { Document, Note } from '../db.mjs';
import { createIndexingJob, INDEXING_LEASE_MS } from './indexing-policy.mjs';
import { DocumentError } from './errors.mjs';

const modelFor = type => type === 'document' ? Document : type === 'note' ? Note : null;
const query = (model, operation) => model === Note ? operation.setOptions({ includeDeleted: true }).select('+sourceVersion +indexing') : operation;
const deleted = type => type === 'document' ? { status: { $in: ['deleted', 'deleting'] } } : { deletedAt: { $ne: null } };

export class IndexMaintenance {
  constructor({ storage, clock = () => new Date() }) { Object.assign(this, { storage, clock }); }

  async prepare(modelId, indexVersion) {
    const now = this.clock();
    await Document.updateMany({ status: { $in: ['awaiting_upload', 'validating'] }, finalizeUntil: { $lt: now },
      $or: [{ validationLeaseUntil: null }, { validationLeaseUntil: { $lte: now } }] }, { $set: { status: 'deleting', cleanupAfter: now } });
    let queued = 0;
    for (const [type, model] of [['document', Document], ['note', Note]]) {
      const available = type === 'document' ? { status: 'uploaded' } : { deletedAt: null };
      const sources = await query(model, model.find({ ...available, $or: [
        { indexing: { $exists: false } }, { sourceVersion: { $exists: false } },
        { 'indexing.status': 'ready', 'indexing.embeddingModel': { $ne: modelId } },
        ...(indexVersion ? [{ 'indexing.status': 'ready', 'indexing.indexVersion': { $ne: indexVersion } }] : []),
        { $expr: { $ne: ['$sourceVersion', '$indexing.sourceVersion'] } },
      ] }).sort({ _id: 1 }).limit(50)).lean();
      for (const source of sources) {
        const version = source.sourceVersion || randomUUID();
        const result = await query(model, model.updateOne({ _id: source._id, ...available,
          sourceVersion: source.sourceVersion ?? { $exists: false },
          ...(source.indexing ? { 'indexing.jobId': source.indexing.jobId, 'indexing.status': source.indexing.status } : { indexing: { $exists: false } }),
        }, { $set: { sourceVersion: version, indexing: createIndexingJob(source.user, version, now) } }));
        queued += result.modifiedCount;
      }
    }
    // Only known source prefixes are reconciled; never scan a shared bucket globally.
    let removed = 0;
    if (this.storage.list) {
      const due = await Document.find({ status: { $in: ['uploaded', 'failed'] }, $or: [{ reconciledAt: null }, { reconciledAt: { $lt: new Date(now - 3600000) } }] }).sort({ reconciledAt: 1 }).limit(5).lean();
      for (const source of due) {
        try {
          for (const prefix of [`documents/${source.user}/${source._id}/`, `pending/${source.user}/${source._id}/`]) {
            for (const object of await this.storage.list(prefix)) {
              if (object.key !== source.objectKey && object.modifiedAt < new Date(now - INDEXING_LEASE_MS * 2)
                  && (prefix.startsWith('documents/') || source.uploadExpiresAt < new Date(now - 30000))) {
                await this.storage.remove(object.key); removed++;
              }
            }
          }
          await Document.updateOne({ _id: source._id, sourceVersion: source.sourceVersion }, { $set: { reconciledAt: now } });
        } catch {
          // Reconciliation is retried; a storage outage must not block note indexing.
          continue;
        }
      }
    }
    return { queued, removed_objects: removed };
  }

  async auditCandidates(modelId) {
    const candidates = [];
    for (const [type, model] of [['document', Document], ['note', Note]]) {
      const available = type === 'document' ? { status: 'uploaded' } : { deletedAt: null };
      const rows = await query(model, model.find({ ...available, 'indexing.status': 'ready', 'indexing.embeddingModel': modelId,
        $expr: { $and: [{ $eq: ['$user', '$indexing.user'] }, { $eq: ['$sourceVersion', '$indexing.sourceVersion'] }] },
      }).sort({ 'indexing.lastAuditedAt': 1, _id: 1 }).limit(5)).lean();
      candidates.push(...rows.map(row => ({ source_id: String(row._id), source_type: type, user_id: String(row.user),
        source_version: row.sourceVersion, generation_id: row.indexing.activeGeneration, job_id: row.indexing.jobId,
        manifest_digest: row.indexing.manifestDigest, chunk_ids: (row.indexing.passages || []).map(p => p.citation.chunk_id) })));
    }
    return { sources: candidates };
  }

  async auditResult(body) {
    const model = modelFor(body?.source_type);
    const keys = ['source_id', 'source_type', 'user_id', 'source_version', 'generation_id', 'job_id', 'available'];
    if (!model || Object.keys(body).some(key => !keys.includes(key)) || typeof body.available !== 'boolean'
        || !mongoose.isObjectIdOrHexString(body.source_id) || !mongoose.isObjectIdOrHexString(body.user_id)
        || !['source_version', 'generation_id', 'job_id'].every(key => typeof body[key] === 'string' && body[key].length <= 200)) {
      throw new DocumentError(400, 'invalid_index_audit', 'Check the index verification fields.');
    }
    const available = model === Document ? { status: 'uploaded' } : { deletedAt: null };
    const now = this.clock();
    const fields = body.available ? { 'indexing.lastAuditedAt': now }
      : { indexing: createIndexingJob(body.user_id, body.source_version, now) };
    const result = await query(model, model.updateOne({ _id: body.source_id, user: body.user_id, ...available,
      sourceVersion: body.source_version, 'indexing.jobId': body.job_id, 'indexing.status': 'ready',
      'indexing.sourceVersion': body.source_version, 'indexing.user': body.user_id, 'indexing.activeGeneration': body.generation_id,
    }, { $set: fields }));
    return { disposition: result.modifiedCount ? 'applied' : 'stale' };
  }

  async check(records) {
    if (!Array.isArray(records) || records.length > 200) { throw new DocumentError(400, 'invalid_reconciliation', 'Use a bounded record list.'); }
    const stale = [];
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const model = modelFor(record?.source_type);
      if (!model || !mongoose.isObjectIdOrHexString(record.source_id) || !mongoose.isObjectIdOrHexString(record.user_id)) { stale.push(i); continue; }
      const row = await query(model, model.findOne({ _id: record.source_id, user: record.user_id })).lean();
      const live = row && (model === Note ? !row.deletedAt : row.status === 'uploaded') && row.sourceVersion === record.source_version
        && String(row.indexing?.user) === String(row.user) && row.indexing?.sourceVersion === row.sourceVersion;
      const published = live && row.indexing.status === 'ready' && row.indexing.activeGeneration === record.generation_id
        && row.indexing.embeddingModel === record.embedding_model;
      const working = live && row.indexing.status === 'processing' && row.indexing.generationId === record.generation_id
        && row.indexing.leaseUntil > this.clock();
      if (!published && !working) { stale.push(i); }
    }
    return { stale };
  }

  async claimCleanup() {
    const now = this.clock();
    for (const [type, model] of [['document', Document], ['note', Note]]) {
      const candidates = await query(model, model.find({ ...deleted(type), $and: [
        { $or: [{ cleanupAfter: null }, { cleanupAfter: { $lte: now } }] },
        { $or: [{ cleanupLeaseUntil: null }, { cleanupLeaseUntil: { $lte: now } }] },
      ] }).sort({ _id: 1 }).limit(5)).lean();
      for (const row of candidates) {
        const after = type === 'document' && row.uploadExpiresAt ? new Date(row.uploadExpiresAt.getTime() + 30000) : now;
        if (after > now) { continue; }
        const token = randomUUID();
        const claimed = await query(model, model.findOneAndUpdate({ _id: row._id, ...deleted(type),
          $or: [{ cleanupLeaseUntil: null }, { cleanupLeaseUntil: { $lte: now } }],
        }, { $set: { cleanupToken: token, cleanupLeaseUntil: new Date(now.getTime() + INDEXING_LEASE_MS) } }, { new: true })).lean();
        if (claimed) { return { source_id: String(row._id), source_type: type, user_id: String(row.user), cleanup_token: token }; }
      }
    }
    return null;
  }

  async finishCleanup(body) {
    const model = modelFor(body.source_type);
    if (!model || !mongoose.isObjectIdOrHexString(body.source_id) || typeof body.cleanup_token !== 'string') {
      throw new DocumentError(400, 'invalid_cleanup', 'Invalid cleanup acknowledgement.');
    }
    const row = await query(model, model.findOne({ _id: body.source_id, ...deleted(body.source_type), cleanupToken: body.cleanup_token,
      cleanupLeaseUntil: { $gt: this.clock() } })).lean();
    if (!row) { return { disposition: 'stale' }; }
    if (model === Document) {
      const keys = new Set([row.uploadKey, row.objectKey].filter(Boolean));
      if (this.storage.list) {
        for (const prefix of [`documents/${row.user}/${row._id}/`, `pending/${row.user}/${row._id}/`]) {
          for (const object of await this.storage.list(prefix)) { keys.add(object.key); }
        }
      }
      for (const key of keys) {
        if (key.startsWith(`documents/${row.user}/${row._id}/`) || key.startsWith(`pending/${row.user}/${row._id}/`)) { await this.storage.remove(key); }
      }
    }
    const result = await model.deleteOne({ _id: row._id, cleanupToken: body.cleanup_token, ...deleted(body.source_type) });
    return { disposition: result.deletedCount ? 'applied' : 'stale' };
  }
}
