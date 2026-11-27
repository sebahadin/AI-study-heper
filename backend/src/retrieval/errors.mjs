import { DocumentError } from '../documents/errors.mjs';
export class RetrievalError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, code }); }
}
export const unavailable = () => new RetrievalError(503, 'retrieval_unavailable', 'Study search is temporarily unavailable. Please try again.');
export function retrievalErrorHandler(error, _req, res, _next) {
  if (error instanceof RetrievalError || error instanceof DocumentError) { return res.status(error.status).json({ error: error.message, code: error.code }); }
  if (error.type === 'entity.parse.failed') { return res.status(400).json({ error: 'Send a valid JSON search request.', code: 'invalid_search' }); }
  if (error.type === 'entity.too.large') { return res.status(413).json({ error: 'The search request is too large.', code: 'invalid_search' }); }
  res.status(503).json({ error: 'Study search is temporarily unavailable. Please try again.', code: 'retrieval_unavailable' });
}
