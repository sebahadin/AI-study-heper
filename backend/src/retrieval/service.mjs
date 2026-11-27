import { randomUUID } from 'node:crypto';
import { settings } from '../config.mjs';
import { AiPdfClient } from '../integrations/ai-pdfs.mjs';
import { AiRetrievalClient } from '../integrations/ai-retrieval.mjs';
import { CanonicalPassages } from './passages.mjs';
import { StudyScopeResolver, parseSelection, plainObject, sourceKey } from './scope.mjs';
import { RetrievalError, unavailable } from './errors.mjs';

export const MAX_EVIDENCE_CHARACTERS = 12000;
const invalid = () => new RetrievalError(400, 'invalid_search', 'Use a question, a study scope, and a result limit from 1 to 12.');
export function parseSearch(body) {
  if (!plainObject(body) || Object.keys(body).some(key => !['query', 'scope', 'limit'].includes(key))
      || typeof body.query !== 'string' || !body.query.trim() || body.query.length > 2000 || /[\uD800-\uDFFF]/u.test(body.query)
      || body.limit !== undefined && (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 12)) { throw invalid(); }
  return { query: body.query.trim(), selection: parseSelection(body.scope), limit: body.limit ?? 6 };
}
const citationKey = c => JSON.stringify([c?.chunk_id, c?.source?.source_type, c?.source?.source_id,
  c?.source?.source_version, c?.source?.index_generation, c?.locator, c?.page_start ?? null, c?.page_end ?? null]);

export class StudySearchService {
  constructor({ resolver, client }) { Object.assign(this, { resolver, client }); this.passages = new CanonicalPassages({ resolver }); }
  async search(user, body) {
    const { query, selection, limit } = parseSearch(body);
    const resolved = await this.resolver.resolve(user, selection);
    if (!resolved.sources.length) { return { query, passages: [], sources: [] }; }
    const context = { user_id: String(user), run_id: randomUUID(), scope: { scope_id: randomUUID(), selection, sources: resolved.sources } };
    const result = await this.client.search({ query, limit, context });
    if (!plainObject(result) || result.query !== query || !Array.isArray(result.passages) || result.passages.length > limit
        || result.passages.some(p => !plainObject(p) || !plainObject(p.citation) || !plainObject(p.citation.source)
          || typeof p.text !== 'string' || !p.text.trim() || p.text.length > 20000 || typeof p.citation.locator !== 'string'
          || !/^[a-z]+-[a-f0-9]{64}$/.test(p.citation.chunk_id || '')
          || !['note', 'document'].includes(p.citation.source.source_type))) { throw unavailable(); }
    if (!result.passages.length) { return { query, passages: [], sources: [] }; }
    // Re-resolve after the remote call: course membership and text may have changed.
    let current;
    try { current = await this.resolver.resolve(user, selection); }
    catch (error) { if (error instanceof RetrievalError && error.status === 404) { return { query, passages: [], sources: [] }; } throw error; }
    const allowed = new Map(current.sources.map(ref => [sourceKey(ref), ref]));
    const candidates = result.passages.filter(p => allowed.has(sourceKey(p.citation.source)));
    if (!candidates.length) { return { query, passages: [], sources: [] }; }
    const refs = [...new Map(candidates.map(p => [sourceKey(p.citation.source), allowed.get(sourceKey(p.citation.source))])).values()];
    const ids = [...new Set(candidates.map(p => p.citation.chunk_id))];
    const canonical = await this.passages.fetch({ context: { ...context, scope: { ...context.scope, sources: refs } }, chunk_ids: ids });
    const approved = new Set(candidates.map(p => citationKey(p.citation)));
    let characters = 0;
    const passages = canonical.passages.filter(p => {
      if (!approved.has(citationKey(p.citation)) || characters + p.text.length > MAX_EVIDENCE_CHARACTERS) { return false; }
      characters += p.text.length; return true;
    });
    const used = new Set(passages.map(p => sourceKey(p.citation.source)));
    return { query, passages, sources: current.descriptors.filter(ref => used.has(sourceKey(ref))) };
  }
}

export function createStudySearchService() {
  const resolver = new StudyScopeResolver({ profile: async () => {
    try { return await new AiPdfClient({ baseUrl: settings.aiServiceUrl, token: settings.aiServiceToken }).request('/internal/retrieval/profile'); }
    catch { throw unavailable(); }
  } });
  return new StudySearchService({ resolver, client: new AiRetrievalClient({ baseUrl: settings.aiServiceUrl, token: settings.aiServiceToken }) });
}
