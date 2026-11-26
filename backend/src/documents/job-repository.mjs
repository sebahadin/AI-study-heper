import { Document } from '../db.mjs';
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
  constructor(model = Document) { this.model = model; }
  async get(user, id) { return this.model.findOne({ _id: id, user }).lean(); }
  async getJob(jobId) { return this.model.findOne({ ...uploaded, 'indexing.jobId': jobId }).lean(); }

  async queue(user, document, indexing) {
    return this.model.findOneAndUpdate({
      _id: document._id, user, status: 'uploaded', sourceVersion: document.sourceVersion,
      $or: [{ indexing: { $exists: false } }, { indexing: null }, { 'indexing.status': 'failed' },
        { $expr: { $not: [sameSource] } }],
    }, { $set: { indexing } }, { new: true, runValidators: true }).lean();
  }

  async expireExhausted(now) {
    return this.model.updateMany({
      status: 'uploaded', 'indexing.status': 'processing', 'indexing.leaseUntil': { $lte: now },
      $expr: { $and: [...sameSource.$and, { $gte: ['$indexing.attempts', '$indexing.maxAttempts'] }] },
    }, { $set: {
      'indexing.status': 'failed', 'indexing.leaseToken': null, 'indexing.leaseUntil': null,
      'indexing.updatedAt': now, 'indexing.error': { code: 'worker_timeout', message: indexingFailures.worker_timeout.message },
    } });
  }

  async claim(token, now, leaseUntil) {
    return this.model.findOneAndUpdate({
      status: 'uploaded',
      $expr: { $and: [...sameSource.$and, { $lt: ['$indexing.attempts', '$indexing.maxAttempts'] }] },
      $or: [
        { 'indexing.status': 'queued', 'indexing.availableAt': { $lte: now } },
        { 'indexing.status': 'processing', 'indexing.leaseUntil': { $lte: now } },
      ],
    }, { $set: {
      'indexing.status': 'processing', 'indexing.leaseToken': token,
      'indexing.leaseUntil': leaseUntil, 'indexing.updatedAt': now, 'indexing.error': null,
    }, $inc: { 'indexing.attempts': 1 } }, {
      sort: { 'indexing.availableAt': 1, _id: 1 }, new: true, runValidators: true,
    }).lean();
  }

  async lease(jobId, token, now) { return this.model.findOne(activeLease(jobId, token, now)).lean(); }

  async heartbeat(jobId, token, now, leaseUntil) {
    return this.model.findOneAndUpdate(activeLease(jobId, token, now), {
      $set: { 'indexing.leaseUntil': leaseUntil, 'indexing.updatedAt': now },
    }, { new: true, runValidators: true }).lean();
  }

  async fail(jobId, token, now, values) {
    const fields = Object.fromEntries(Object.entries(values).map(([key, value]) => [`indexing.${key}`, value]));
    return this.model.findOneAndUpdate(activeLease(jobId, token, now), {
      $set: { ...fields, 'indexing.leaseToken': null, 'indexing.leaseUntil': null, 'indexing.updatedAt': now },
    }, { new: true, runValidators: true }).lean();
  }
}
