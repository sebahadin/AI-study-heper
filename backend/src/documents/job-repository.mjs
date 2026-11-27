import { Document, Note } from '../db.mjs';
import { indexingFailures } from './indexing-policy.mjs';

const sameSource = { $and: [
  { $eq: ['$user', '$indexing.user'] }, { $eq: ['$sourceVersion', '$indexing.sourceVersion'] },
] };
const uploaded = { status: 'uploaded', $expr: sameSource };
const activeLease = (jobId, token, now) => ({
  ...uploaded, 'indexing.jobId': jobId, 'indexing.status': 'processing',
  'indexing.leaseToken': token, 'indexing.leaseUntil': { $gt: now },
});

export class DocumentJobRepository {
  constructor(model = Document) {
    this.model = model;
    this.sourceType = model === Note ? 'note' : 'document';
    this.available = this.sourceType === 'note' ? { deletedAt: null } : { status: 'uploaded' };
  }
  query(query) {
    if (this.sourceType === 'note') { query.setOptions({ includeDeleted: true }).select('+indexing +sourceVersion'); }
    return query;
  }
  live(filter) { return { ...filter, ...this.available }; }
  fence(jobId, token, now) {
    const filter = activeLease(jobId, token, now);
    delete filter.status;
    return { ...filter, ...this.available };
  }
  async get(user, id) { return this.query(this.model.findOne({ _id: id, user, ...(this.sourceType === 'note' ? { deletedAt: null } : { status: { $ne: 'deleted' } }) })).lean(); }
  async getJob(jobId) { return this.query(this.model.findOne({ ...this.available, $expr: sameSource, 'indexing.jobId': jobId })).lean(); }

  async queue(user, document, indexing) {
    return this.query(this.model.findOneAndUpdate({
      _id: document._id, user, ...this.available, sourceVersion: document.sourceVersion ?? { $exists: false },
      $or: [{ indexing: { $exists: false } }, { indexing: null }, { 'indexing.status': 'failed' },
        { $expr: { $not: [sameSource] } }],
    }, { $set: { indexing, sourceVersion: indexing.sourceVersion } }, { new: true, runValidators: true })).lean();
  }

  async expireExhausted(now) {
    return this.query(this.model.updateMany({
      ...this.available, 'indexing.status': 'processing', 'indexing.leaseUntil': { $lte: now },
      $expr: { $and: [...sameSource.$and, { $gte: ['$indexing.attempts', '$indexing.maxAttempts'] }] },
    }, { $set: {
      'indexing.status': 'failed', 'indexing.leaseToken': null, 'indexing.leaseUntil': null,
      'indexing.updatedAt': now, 'indexing.error': { code: 'worker_timeout', message: indexingFailures.worker_timeout.message },
    } }));
  }

  async claim(token, now, leaseUntil, generationId) {
    return this.query(this.model.findOneAndUpdate({
      ...this.available,
      $expr: { $and: [...sameSource.$and, { $lt: ['$indexing.attempts', '$indexing.maxAttempts'] }] },
      $or: [
        { 'indexing.status': 'queued', 'indexing.availableAt': { $lte: now } },
        { 'indexing.status': 'processing', 'indexing.leaseUntil': { $lte: now } },
      ],
    }, { $set: {
      'indexing.status': 'processing', 'indexing.leaseToken': token,
      'indexing.leaseUntil': leaseUntil, 'indexing.updatedAt': now, 'indexing.error': null,
      'indexing.generationId': generationId,
    }, $inc: { 'indexing.attempts': 1 } }, {
      sort: { 'indexing.availableAt': 1, _id: 1 }, new: true, runValidators: true,
    })).lean();
  }

  async lease(jobId, token, now) { return this.query(this.model.findOne(this.fence(jobId, token, now))).lean(); }

  async heartbeat(jobId, token, now, leaseUntil) {
    return this.query(this.model.findOneAndUpdate(this.fence(jobId, token, now), {
      $set: { 'indexing.leaseUntil': leaseUntil, 'indexing.updatedAt': now },
    }, { new: true, runValidators: true })).lean();
  }

  async fail(jobId, token, now, values) {
    const fields = Object.fromEntries(Object.entries(values).map(([key, value]) => [`indexing.${key}`, value]));
    return this.query(this.model.findOneAndUpdate(this.fence(jobId, token, now), {
      $set: { ...fields, 'indexing.leaseToken': null, 'indexing.leaseUntil': null, 'indexing.updatedAt': now },
    }, { new: true, runValidators: true })).lean();
  }
  async complete(jobId, token, now, values) {
    const fields = Object.fromEntries(Object.entries(values).map(([key, value]) => [`indexing.${key}`, value]));
    return this.query(this.model.findOneAndUpdate(this.fence(jobId, token, now), {
      $set: { ...fields, 'indexing.status': 'ready', 'indexing.leaseToken': null,
        'indexing.leaseUntil': null, 'indexing.error': null, 'indexing.updatedAt': now },
    }, { new: true, runValidators: true })).lean();
  }

}
