import { randomUUID } from 'node:crypto';
export const CHAT_MAX_MESSAGES = 200;
export const CHAT_MAX_INPUT = 4000;
export const CHAT_MAX_ANSWER = 12000;
export const CHAT_RUN_LEASE_MS = 120000;
export const CHAT_TURN_TIMEOUT_MS = 95000;
export const chatFailures = Object.freeze({
  scope_too_large: 'Choose fewer materials or a more specific course before asking again.',
  material_not_found: 'A selected material is no longer available. Update the study scope and try again.',
  chat_context_too_long: 'Shorten the question or choose fewer materials before trying again.',
  chat_unavailable: 'The assistant is temporarily unavailable. Your message is saved; you can try again.',
  model_unavailable: 'The chat provider could not complete the response. Please try again.',
  cancelled: 'Response stopped before completion.',
  interrupted: 'This response was interrupted. Your conversation is saved; you can try again.',
  source_changed: 'Your materials changed while this answer was being prepared. Ask again to use the latest version.',
  daily_limit: 'The daily chat limit has been reached. Please try again tomorrow.',
  draft_invalid: 'The generated draft could not be validated. Try a narrower task.',
  response_invalid: 'The response could not be verified. Please try again.',
});
export class ChatError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}
export const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export const message = (role, content, requestId, sequence, now) => ({ id: randomUUID(), requestId, role, content, sequence,
  status: role === 'user' ? 'completed' : 'generating', mode: 'pending', citations: [], createdAt: now });
export const citationKey = citation => JSON.stringify([citation.chunk_id, citation.source?.source_type, citation.source?.source_id,
  citation.source?.source_version, citation.source?.index_generation, citation.locator, citation.page_start ?? null, citation.page_end ?? null]);
export const referencedNumbers = text => [...new Set([...text.replace(/```[\s\S]*?(?:```|$)|`[^`]*`/g, '').matchAll(/\[(\d{1,4})\]/g)].map(match => Number(match[1])))];
