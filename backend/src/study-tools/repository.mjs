import { randomUUID } from 'node:crypto';
import { StudyArtifact } from '../db.mjs';
import { CHAT_RUN_LEASE_MS } from '../chat/policy.mjs';
export class StudyRepository {
  constructor({ clock = () => new Date() } = {}) { this.clock = clock; }
  async get(user, id, deleted = false) {
    await StudyArtifact.updateOne({ _id: id, user, status: 'generating', 'activeRun.leaseUntil': { $lte: this.clock() } }, { $set: { status: 'failed', errorCode: 'interrupted', activeRun: null } });
    return StudyArtifact.findOne({ _id: id, user, ...(!deleted && { status: { $ne: 'deleted' } }) }).select('+activeRun +confirmation +lastAction').lean();
  }
  async create(user, requestId, request, conversationId = null) {
    try { return await StudyArtifact.create({ user, requestId, kind: request.kind, request, conversationId }); }
    catch (error) { if (error.code !== 11000) { throw error; } return StudyArtifact.findOne({ user, requestId }).lean(); }
  }
  async list(user, { status, kind, cursor }, association) {
    const filter = { user, status: status === 'saved' ? 'saved' : status === 'drafts' ? { $in: ['queued', 'generating', 'draft', 'failed', 'cancelled'] } : { $ne: 'deleted' } };
    if (kind) { filter.kind = kind; }
    if (association) { filter.$and = [association]; }
    if (cursor) {
      try {
        if (typeof cursor !== 'string' || cursor.length > 180 || !/^[A-Za-z0-9_-]+$/.test(cursor)) { throw new Error(); }
        const [date, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString());
        if (!/^[a-f0-9]{24}$/i.test(id) || !Number.isFinite(new Date(date).getTime())) { throw new Error(); }
        filter.$or = [{ updatedAt: { $lt: new Date(date) } }, { updatedAt: new Date(date), _id: { $lt: id } }];
      } catch { const error = new Error('Invalid cursor'); error.code = 'invalid_cursor'; throw error; }
    }
    const rows = await StudyArtifact.find(filter).select('kind title status revision savedRevision updatedAt draft.title draft.cards draft.questions content.title content.cards content.questions request.selection').sort({ updatedAt: -1, _id: -1 }).limit(31).lean();
    const more = rows.length > 30; if (more) { rows.pop(); }
    const last = rows.at(-1);
    return { rows, nextCursor: more ? Buffer.from(JSON.stringify([last.updatedAt.toISOString(), String(last._id)])).toString('base64url') : null };
  }
  async begin(user, row) {
    const run = { id: randomUUID(), leaseUntil: new Date(this.clock().getTime() + CHAT_RUN_LEASE_MS) };
    const result = await StudyArtifact.findOneAndUpdate({ _id: row._id, user, revision: row.revision, status: { $in: ['queued', 'failed', 'cancelled'] }, activeRun: null },
      { $set: { status: 'generating', activeRun: run, errorCode: null } }, { new: true }).select('+activeRun').lean();
    return result && { row: result, run };
  }
  fence(user, id, run) { return { _id: id, user, status: 'generating', 'activeRun.id': run.id, 'activeRun.leaseUntil': { $gt: this.clock() } }; }
  async heartbeat(user, id, run) { return StudyArtifact.updateOne(this.fence(user, id, run), { $set: { 'activeRun.leaseUntil': new Date(this.clock().getTime() + CHAT_RUN_LEASE_MS) } }); }
  async finish(user, id, run, fields) { return StudyArtifact.findOneAndUpdate(this.fence(user, id, run), { $set: { ...fields, activeRun: null }, $inc: { revision: 1 } }, { new: true }).lean(); }
  async cancel(user, id, runId) { if (!runId) { return null; } return StudyArtifact.findOneAndUpdate({ _id: id, user, 'activeRun.id': runId, status: 'generating' }, { $set: { status: 'cancelled', activeRun: null, errorCode: 'cancelled' } }, { new: true }).lean(); }
  async edit(user, row, draft) {
    return StudyArtifact.findOneAndUpdate({ _id: row._id, user, revision: row.revision, status: { $in: ['draft', 'saved'] } }, { $set: { draft, confirmation: null }, $inc: { revision: 1 } }, { new: true }).lean();
  }
}
