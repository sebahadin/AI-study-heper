import { ChatError, referencedNumbers, citationKey } from '../chat/policy.mjs';
import { plainObject } from '../retrieval/scope.mjs';
export const kinds = ['summary', 'explanation', 'flashcards', 'quiz'];
export const formats = ['auto', 'choice', 'written', 'code'];
export const fail = (status = 400, code = 'invalid_draft', message = 'Check the draft fields and source references.') => { throw new ChatError(status, code, message); };
export function exact(value, keys) { if (!plainObject(value) || Object.keys(value).some(key => !keys.includes(key))) { fail(); } }
function text(value, max, required = true) {
  if (typeof value !== 'string' || value.length > max || required && !value.trim() || /[\uD800-\uDFFF]/u.test(value)) { fail(); }
  return value.trim();
}
const array = (value, max, min = 0) => { if (!Array.isArray(value) || value.length < min || value.length > max) { fail(); } return value; };
const integer = (value, min, max) => { if (!Number.isSafeInteger(value) || value < min || value > max) { fail(); } return value; };
function references(numbers, allowed) {
  array(numbers, 12, 1); if (new Set(numbers).size !== numbers.length || numbers.some(n => !Number.isInteger(n) || !allowed.has(n))) { fail(); }
  return numbers;
}
export function validateDraft(raw, kind, immutable) {
  exact(raw, ['kind', 'title', 'body', 'cards', 'questions', 'citations', 'coverage']);
  if (raw.kind !== kind || !kinds.includes(kind)) { fail(); }
  if (immutable && (raw.citations && JSON.stringify(raw.citations.map(c => [citationKey(c), c.number, c.title, c.href])) !== JSON.stringify(immutable.citations.map(c => [citationKey(c), c.number, c.title, c.href])) || raw.coverage && JSON.stringify(raw.coverage) !== JSON.stringify(immutable.coverage))) { fail(); }
  const citations = immutable?.citations || array(raw.citations, 12, 1);
  const coverage = immutable?.coverage || raw.coverage;
  if (!plainObject(coverage) || !Number.isInteger(coverage.totalSources) || coverage.totalSources < 1 || coverage.totalSources > 100
    || !Number.isInteger(coverage.coveredSources) || coverage.coveredSources < 1 || coverage.coveredSources > coverage.totalSources
    || !Number.isInteger(coverage.passages) || coverage.passages < 1 || coverage.passages > 12 || coverage.excerpted !== true) { fail(); }
  const allowed = new Set(citations.map(c => c?.number));
  if (allowed.size !== citations.length || [...allowed].some(n => !Number.isInteger(n) || n < 1 || n > 12)) { fail(); }
  const title = text(raw.title, 120), body = text(raw.body ?? '', 16000, ['summary', 'explanation'].includes(kind));
  const cards = array(raw.cards ?? [], 10).map(card => {
    exact(card, ['front', 'back', 'explanation', 'citationNumbers']);
    const result = { front: text(card.front, 1000), back: text(card.back, 3000), explanation: text(card.explanation, 1500, false), citationNumbers: references(card.citationNumbers, allowed) };
    return result;
  });
  const questions = array(raw.questions ?? [], 10).map(question => {
    exact(question, ['kind', 'prompt', 'options', 'correctIndex', 'explanation', 'referenceAnswer', 'rubric', 'language', 'starterCode', 'citationNumbers']);
    if (!['choice', 'written', 'code'].includes(question.kind)) { fail(); }
    const q = { kind: question.kind, prompt: text(question.prompt, 2000), options: array(question.options, 4).map(v => text(v, 500)), correctIndex: question.correctIndex,
      explanation: text(question.explanation, 2000), referenceAnswer: text(question.referenceAnswer, 4000, question.kind !== 'choice'),
      rubric: array(question.rubric, 5).map(row => { exact(row, ['description', 'maxPoints']); return { description: text(row.description, 500), maxPoints: integer(row.maxPoints, 1, 10) }; }),
      language: text(question.language, 30, question.kind === 'code'), starterCode: text(question.starterCode, 4000, false), citationNumbers: references(question.citationNumbers, allowed) };
    if (q.kind === 'choice') {
      integer(q.correctIndex, 0, q.options.length - 1);
      if (q.options.length < 2 || new Set(q.options.map(v => v.toLowerCase())).size !== q.options.length || q.referenceAnswer || q.rubric.length || q.language || q.starterCode) { fail(); }
    } else if (q.options.length || q.correctIndex !== null || !q.rubric.length || q.kind === 'written' && (q.language || q.starterCode)) { fail(); }
    return q;
  });
  if (['summary', 'explanation'].includes(kind)) { const used = referencedNumbers(body); if (!used.length || used.some(n => !allowed.has(n)) || cards.length || questions.length) { fail(); } }
  if (kind === 'flashcards' && (!cards.length || questions.length || body) || kind === 'quiz' && (!questions.length || cards.length || body)) { fail(); }
  return { kind, title, body, cards, questions, citations, coverage };
}
export const safeErrors = Object.freeze({
  insufficient_evidence: 'The selected excerpts cannot support this request. Choose different indexed materials or narrow the task.',
  source_changed: 'Your sources changed. Generate a new draft using the latest materials before saving.',
  draft_invalid: 'The generated draft could not be verified. Try again or choose a narrower task.',
  model_unavailable: 'The model could not complete this draft. Please try again.',
  chat_unavailable: 'Generation is temporarily unavailable. Your existing drafts are safe.',
  chat_context_too_long: 'Shorten the instruction or select fewer materials.',
  daily_limit: 'The daily AI limit has been reached. Try again tomorrow.',
  cancelled: 'Generation stopped. You can retry when ready.',
  interrupted: 'Generation was interrupted. You can retry this draft.',
});
