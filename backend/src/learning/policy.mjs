import { ChatError } from '../chat/policy.mjs';
export const MAX_MANUAL_QUESTIONS = 100;
export const ASSESSMENT_LEASE_MS = 100000;
export const LEARNING_HISTORY_LIMIT = 20;
export const invalid = (message = 'Check your quiz request.') => { throw new ChatError(400, 'invalid_learning_request', message); };
export const missing = () => { throw new ChatError(404, 'attempt_not_found', 'Quiz attempt not found.'); };
export function exact(body, keys) { if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !keys.includes(k))) { invalid(); } }
export function answerValue(q, value, empty = true) {
  if (value === null && empty) { return null; }
  if (q.kind === 'choice') {
    if (!Number.isInteger(value) || value < 0 || value >= q.options.length) { invalid('Choose one of the answer options.'); }
  } else if (typeof value !== 'string' || value.length > 12000 || !empty && !value.trim()) { invalid('Write an answer of up to 12,000 characters.'); }
  return value;
}
export const possible = q => q.kind === 'choice' ? 1 : q.rubric.reduce((sum, c) => sum + c.maxPoints, 0);
export function summarize(row) {
  const choice = { earned: 0, possible: 0, answered: 0, correct: 0 }, ai = { earned: 0, possible: 0, graded: 0, pending: 0 }, misses = [];
  let submitted = 0, revealed = 0;
  for (const q of row.questions) {
    const a = row.answers?.[q.id], assessment = row.assessments?.[q.id];
    const max = possible(q), done = a?.submitted === true;
    if (done) { submitted++; }
    if (a?.revealed) { revealed++; }
    let earned = 0, needsReview = row.status === 'completed' && !done, reason = needsReview ? 'Not answered' : '';
    if (q.kind === 'choice') {
      choice.possible++;
      if (done && !a.revealed) { choice.answered++; earned = a.value === q.correctIndex ? 1 : 0; choice.earned += earned; choice.correct += earned; needsReview = !earned; reason = earned ? '' : 'Incorrect choice'; }
    } else {
      ai.possible += max;
      if (done && !a.revealed) {
        if (assessment?.status === 'ready') { ai.graded++; earned = assessment.earned; ai.earned += earned; needsReview = earned < max * .7; reason = needsReview ? 'AI assessment suggests another look' : ''; }
        else { ai.pending++; }
      }
    }
    if (a?.revealed) { needsReview = true; reason = 'Reference answer revealed'; }
    if (needsReview) { misses.push({ questionId: q.id, topic: q.prompt.slice(0, 200), reason }); }
  }
  const earned = choice.earned + ai.earned, max = choice.possible + ai.possible;
  return { total: row.questions.length, submitted, revealed, skipped: row.status === 'completed' ? row.questions.length - submitted : 0,
    choice, ai, earned, possible: max, percentage: row.status === 'completed' && !ai.pending && max ? Math.round(earned / max * 100) : null, misses };
}
export function publicAttempt(row, { brief = false, now = new Date() } = {}) {
  const summary = summarize(row);
  return { _id: String(row._id), title: row.title, origin: row.origin, studyId: row.studyId ? String(row.studyId) : null,
    status: row.status, revision: row.revision, position: row.position, marked: row.marked, createdAt: row.createdAt, updatedAt: row.updatedAt, completedAt: row.completedAt || null, summary,
    ...(!brief && { citations: row.citations, questions: row.questions.map(q => ({ id: q.id, kind: q.kind, prompt: q.prompt, options: q.options, language: q.language || '', starterCode: q.starterCode || '', citationNumbers: q.citationNumbers || [], maxPoints: possible(q),
      ...(row.answers?.[q.id]?.submitted || row.status === 'completed' ? { correctIndex: q.correctIndex, referenceAnswer: q.referenceAnswer, rubric: q.rubric, explanation: q.explanation } : {}) })),
    answers: row.answers || {}, assessments: Object.fromEntries(Object.entries(row.assessments || {}).map(([id, a]) => [id, a.status === 'ready' ? { status: 'ready', earned: a.earned, criteria: a.criteria, feedback: a.feedback, model: a.model, assessedAt: a.assessedAt, label: 'AI assessment · may be imperfect' } : { status: a.status === 'processing' && new Date(a.leaseUntil) <= now ? 'interrupted' : a.status, error: a.error || null }])) }),
  };
}
