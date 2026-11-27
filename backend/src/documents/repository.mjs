import { Document } from '../db.mjs';
import { createIndexingJob } from './indexing-policy.mjs';

export class DocumentRepository {
  constructor(model = Document) { this.model = model; }

  async create(values) { return (await this.model.create(values)).toObject(); }
  async list(user, before, limit, filter = {}) {
    return this.model.find({ ...filter, status: { $ne: 'deleted' }, user, ...(before && { _id: { $lt: before } }) }).sort({ _id: -1 }).limit(limit).lean();
  }
  async get(user, id) { return this.model.findOne({ _id: id, user, status: { $ne: 'deleted' } }).lean(); }

  async markDeleting(user, id) {
    return this.model.findOneAndUpdate({ _id: id, user, status: { $ne: 'deleted' } }, {
      $set: { status: 'deleting', validationToken: null, validationLeaseUntil: null },
    }, { new: true, runValidators: true }).lean();
  }

  async remove(user, id) { return this.model.updateOne({ _id: id, user, status: 'deleting' }, { $set: { status: 'deleted', deletedAt: new Date() } }); }

  async claim(user, id, token, now, leaseUntil) {
    return this.model.findOneAndUpdate({
      _id: id, user, finalizeUntil: { $gte: now },
      $or: [{ status: 'awaiting_upload' }, { status: 'validating', validationLeaseUntil: { $lte: now } }],
    }, { $set: { status: 'validating', validationToken: token, validationLeaseUntil: leaseUntil, error: null } },
    { new: true, runValidators: true }).lean();
  }

  async finalize(user, id, token, values, now = new Date()) {
    return this.model.findOneAndUpdate({ _id: id, user, status: 'validating', validationToken: token, validationLeaseUntil: { $gt: now } }, {
      $set: { ...values, status: 'uploaded', validationToken: null, validationLeaseUntil: null, error: null,
        indexing: createIndexingJob(user, values.sourceVersion, now) },
    }, { new: true, runValidators: true }).lean();
  }

  async release(user, id, token, error, terminal) {
    return this.model.findOneAndUpdate({ _id: id, user, status: 'validating', validationToken: token }, {
      $set: {
        status: terminal ? 'failed' : 'awaiting_upload', validationToken: null,
        validationLeaseUntil: null, error: { code: error.code, message: error.message },
      },
    }, { new: true, runValidators: true }).lean();
  }
}
