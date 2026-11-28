import mongoose from 'mongoose';
const ref = { type: mongoose.Schema.Types.ObjectId, required: true };
// Definitions and question snapshots are immutable. Answers never accept browser-supplied keys or scores.
const definition = new mongoose.Schema({
  user: ref, key: { type: String, required: true }, title: String,
  origin: { type: String, enum: ['manual', 'generated'], required: true }, studyId: mongoose.Schema.Types.ObjectId,
  sourceRevision: Number, selection: mongoose.Schema.Types.Mixed, associations: mongoose.Schema.Types.Mixed,
  questions: { type: [mongoose.Schema.Types.Mixed], required: true, select: false },
  citations: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { timestamps: true });
definition.index({ user: 1, key: 1 }, { unique: true });
const attempt = new mongoose.Schema({
  user: ref, definition: ref, requestId: { type: String, required: true }, title: String,
  origin: String, studyId: mongoose.Schema.Types.ObjectId, sourceRevision: Number,
  selection: mongoose.Schema.Types.Mixed, associations: mongoose.Schema.Types.Mixed,
  questions: { type: [mongoose.Schema.Types.Mixed], required: true, select: false },
  citations: { type: [mongoose.Schema.Types.Mixed], default: [] },
  status: { type: String, enum: ['in_progress', 'completed'], default: 'in_progress' },
  revision: { type: Number, default: 0 }, position: { type: Number, default: 0 },
  marked: { type: [String], default: [] }, answers: { type: mongoose.Schema.Types.Mixed, default: {} },
  assessments: { type: mongoose.Schema.Types.Mixed, default: {} }, completedAt: Date,
}, { timestamps: true });
attempt.index({ user: 1, requestId: 1 }, { unique: true });
attempt.index({ user: 1, definition: 1 }, { unique: true, partialFilterExpression: { status: 'in_progress' } });
attempt.index({ user: 1, createdAt: -1, _id: -1 });
const profile = new mongoose.Schema({
  user: ref, contextHash: String, result: mongoose.Schema.Types.Mixed, generatedAt: Date,
  run: { type: mongoose.Schema.Types.Mixed, default: null }, error: String,
}, { timestamps: true });
profile.index({ user: 1 }, { unique: true });
export const QuizDefinition = mongoose.model('QuizDefinition', definition);
export const QuizAttempt = mongoose.model('QuizAttempt', attempt);
export const LearningProfile = mongoose.model('LearningProfile', profile);
