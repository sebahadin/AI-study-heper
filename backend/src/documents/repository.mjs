import { Document } from '../db.mjs';

export class DocumentRepository {
  constructor(model = Document) { this.model = model; }

  async create(values) { return (await this.model.create(values)).toObject(); }
  async list(user, before, limit) {
    return this.model.find({ user, ...(before && { _id: { $lt: before } }) }).sort({ _id: -1 }).limit(limit).lean();
  }
  async get(user, id) { return this.model.findOne({ _id: id, user }).lean(); }

  async claim(user, id, token, now, leaseUntil) {
    return this.model.findOneAndUpdate({
      _id: id, user, finalizeUntil: { $gte: now },
      $or: [{ status: 'awaiting_upload' }, { status: 'validating', validationLeaseUntil: { $lte: now } }],
    }, { $set: { status: 'validating', validationToken: token, validationLeaseUntil: leaseUntil, error: null } },
    { new: true, runValidators: true }).lean();
  }

  async finalize(user, id, token, values) {
    return this.model.findOneAndUpdate({ _id: id, user, status: 'validating', validationToken: token }, {
      $set: { ...values, status: 'uploaded', validationToken: null, validationLeaseUntil: null, error: null },
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
