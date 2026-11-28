import { QuizAttempt, QuizDefinition } from './models.mjs';
import { invalid, missing, LEARNING_HISTORY_LIMIT } from './policy.mjs';
import { objectId } from '../retrieval/scope.mjs';
export class LearningRepository {
  constructor({ clock = () => new Date() } = {}) { this.clock = clock; }
  async owned(user, id) {
    if (!objectId(id)) { missing(); }
    const row = await QuizAttempt.findOne({ _id: id, user }).select('+questions').lean(); if (!row) { missing(); } return { ...row, answers: row.answers || {}, assessments: row.assessments || {} };
  }
  async define(user, fields) {
    try { return await QuizDefinition.create({ user, ...fields }); }
    catch (e) { if (e.code !== 11000) { throw e; } return QuizDefinition.findOne({ user, key: fields.key }).select('+questions').lean(); }
  }
  async start(user, definition, requestId) {
    const replay = await QuizAttempt.findOne({ user, requestId }).select('+questions').lean();
    if (replay) { if (String(replay.definition) !== String(definition._id)) { invalid('Use a new request to start a different quiz.'); } return replay; }
    const active = await QuizAttempt.findOne({ user, definition: definition._id, status: 'in_progress' }).select('+questions').lean();
    if (active) { return active; }
    const { title, origin, studyId, sourceRevision, selection, associations, questions, citations } = definition;
    try { return (await QuizAttempt.create({ user, requestId, definition: definition._id, title, origin, studyId, sourceRevision, selection, associations, questions, citations })).toObject(); }
    catch (e) {
      if (e.code !== 11000) { throw e; }
      const previous = await QuizAttempt.findOne({ user, requestId }).select('+questions').lean();
      if (previous) { if (String(previous.definition) !== String(definition._id)) { invalid('Use a new request to start a different quiz.'); } return previous; }
      const resumed = await QuizAttempt.findOne({ user, definition: definition._id, status: 'in_progress' }).select('+questions').lean();
      if (!resumed) { invalid(); } return resumed;
    }
  }
  async change(user, row, values) {
    const result = await QuizAttempt.findOneAndUpdate({ _id: row._id, user, revision: row.revision, status: 'in_progress' }, { $set: values, $inc: { revision: 1 } }, { new: true }).select('+questions').lean();
    if (!result) { const error = new Error('This attempt changed in another tab. Load the latest answers.'); Object.assign(error, { status: 409, code: 'attempt_changed' }); throw error; } return result;
  }
  async list(user, cursor) {
    const filter = { user };
    if (cursor) {
      try { if (typeof cursor !== 'string' || cursor.length > 180 || !/^[A-Za-z0-9_-]+$/.test(cursor)) { throw new Error(); } const [date, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString()); if (!objectId(id) || !Number.isFinite(Date.parse(date))) { throw new Error(); } filter.$or = [{ createdAt: { $lt: new Date(date) } }, { createdAt: new Date(date), _id: { $lt: id } }]; }
      catch { invalid('Reload your results history.'); }
    }
    const rows = await QuizAttempt.find(filter).select('+questions').sort({ createdAt: -1, _id: -1 }).limit(LEARNING_HISTORY_LIMIT + 1).lean(), more = rows.length > LEARNING_HISTORY_LIMIT;
    if (more) { rows.pop(); } const last = rows.at(-1);
    return { rows, nextCursor: more ? Buffer.from(JSON.stringify([last.createdAt.toISOString(), String(last._id)])).toString('base64url') : null };
  }
}
