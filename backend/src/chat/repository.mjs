import { Conversation, ChatQuota } from '../db.mjs';
import { CHAT_MAX_MESSAGES, CHAT_RUN_LEASE_MS, ChatError, message } from './policy.mjs';
import { randomUUID } from 'node:crypto';

export class ChatRepository {
  constructor({ clock = () => new Date() } = {}) { this.clock = clock; }
  async recover(user, id) {
    return Conversation.updateOne({ _id: id, user, 'activeRun.leaseUntil': { $lte: this.clock() } }, {
      $set: { 'messages.$[entry].status': 'interrupted', 'messages.$[entry].errorCode': 'interrupted', activeRun: null },
    }, { arrayFilters: [{ 'entry.status': 'generating' }] });
  }
  async get(user, id, tail = 200) {
    await this.recover(user, id);
    return Conversation.findOne({ _id: id, user }).select({ messages: { $slice: -tail } }).select('+activeRun').lean();
  }
  async list(user, cursor) {
    const filter = { user };
    if (cursor !== undefined) {
      try {
        if (typeof cursor !== 'string' || cursor.length > 180 || !/^[A-Za-z0-9_-]+$/.test(cursor)) { throw new Error('Invalid cursor'); }
        const [date, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        if (typeof date !== 'string' || !/^[a-f0-9]{24}$/i.test(id) || !Number.isFinite(new Date(date).getTime())) { throw new Error('Invalid cursor'); }
        filter.$or = [{ updatedAt: { $lt: new Date(date) } }, { updatedAt: new Date(date), _id: { $lt: id } }];
      } catch { throw new ChatError(400, 'invalid_cursor', 'Reload the conversation list.'); }
    }
    const rows = await Conversation.find(filter).select('_id title selection topic allowGeneral updatedAt messageCount').sort({ updatedAt: -1, _id: -1 }).limit(51).lean();
    const hasMore = rows.length > 50; if (hasMore) { rows.pop(); }
    const last = rows.at(-1);
    return { conversations: rows, nextCursor: hasMore ? Buffer.from(JSON.stringify([last.updatedAt.toISOString(), String(last._id)])).toString('base64url') : null };
  }
  async create(user, fields) { return Conversation.create({ user, ...fields }); }
  async patch(user, id, fields) {
    await this.recover(user, id);
    return Conversation.findOneAndUpdate({ _id: id, user, activeRun: null }, { $set: fields, $inc: { revision: 1 } }, { new: true, runValidators: true }).lean();
  }
  async remove(user, id) { return Conversation.deleteOne({ _id: id, user }); }
  async previous(user, id, requestId) {
    const rows = await Conversation.findOne({ _id: id, user }).select({ messages: { $slice: -CHAT_MAX_MESSAGES } }).lean();
    const answer = rows?.messages.find(entry => entry.requestId === requestId && entry.role === 'assistant');
    return answer && { ...answer, questionContent: rows.messages.find(entry => entry.requestId === requestId && entry.role === 'user')?.content };
  }
  async begin(user, conversation, requestId, content) {
    const now = this.clock(), runId = randomUUID();
    const question = message('user', content, requestId, conversation.messageCount + 1, now);
    const answer = message('assistant', '', requestId, conversation.messageCount + 2, now);
    const run = { id: runId, requestId, assistantId: answer.id, userMessageId: question.id, leaseUntil: new Date(now.getTime() + CHAT_RUN_LEASE_MS) };
    const result = await Conversation.findOneAndUpdate({ _id: conversation._id, user, activeRun: null,
      revision: conversation.revision, messageCount: conversation.messageCount,
      'messages.requestId': { $ne: requestId }, $expr: { $lte: ['$messageCount', CHAT_MAX_MESSAGES - 2] },
    }, { $push: { messages: { $each: [question, answer] } }, $inc: { messageCount: 2 },
      $set: { activeRun: run, ...(conversation.messageCount === 0 && conversation.title === 'New conversation' ? { title: content.replace(/\s+/g, ' ').slice(0, 70) } : {}) },
    }, { new: true }).select('+activeRun').lean();
    return result ? { run, question, answer, conversation: result } : null;
  }
  fence(user, id, runId) { return { _id: id, user, 'activeRun.id': runId, 'activeRun.leaseUntil': { $gt: this.clock() } }; }
  async heartbeat(user, id, runId) {
    return Conversation.updateOne(this.fence(user, id, runId), { $set: { 'activeRun.leaseUntil': new Date(this.clock().getTime() + CHAT_RUN_LEASE_MS) } });
  }
  async finish(user, id, run, values) {
    const fields = Object.fromEntries(Object.entries(values).map(([key, value]) => [`messages.$[entry].${key}`, value]));
    return Conversation.findOneAndUpdate(this.fence(user, id, run.id), { $set: { ...fields, activeRun: null } }, {
      new: true, arrayFilters: [{ 'entry.id': run.assistantId, 'entry.status': 'generating' }],
    }).lean();
  }
  async cancel(user, id, runId) {
    return Conversation.findOneAndUpdate({ _id: id, user, 'activeRun.id': runId }, { $set: { activeRun: null,
      'messages.$[entry].status': 'cancelled', 'messages.$[entry].errorCode': 'cancelled',
    } }, { new: true, arrayFilters: [{ 'entry.status': 'generating' }] }).lean();
  }
  async quota(user, perUser, globalLimit) {
    const now = this.clock(), date = now.toISOString().slice(0, 10), expiresAt = new Date(now.getTime() + 2 * 86400000);
    for (const [key, limit] of [[`user:${user}:${date}`, perUser], [`global:${date}`, globalLimit]]) {
      try { await ChatQuota.updateOne({ _id: key }, { $setOnInsert: { count: 0, expiresAt } }, { upsert: true }); }
      catch (error) { if (error.code !== 11000) { throw error; } }
      const record = await ChatQuota.findOneAndUpdate({ _id: key, count: { $lt: limit } }, { $inc: { count: 1 } }, { new: true });
      if (!record) { throw new ChatError(429, 'daily_limit', 'The daily chat limit has been reached. Please try again tomorrow.'); }
    }
  }
}
