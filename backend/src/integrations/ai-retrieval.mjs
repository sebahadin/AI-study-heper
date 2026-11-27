import { randomUUID } from 'node:crypto';
import { readBoundedBody } from './bounded-body.mjs';
import { RetrievalError, unavailable } from '../retrieval/errors.mjs';

export class AiRetrievalClient {
  constructor({ baseUrl, token, fetchImpl = fetch }) { Object.assign(this, { baseUrl, token, fetchImpl }); }
  async search(body) {
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(this.token || '')) { throw unavailable(); }
    let url;
    try {
      url = new URL('/internal/retrieval/search', this.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) { throw unavailable(); }
    } catch { throw unavailable(); }
    try {
      const response = await this.fetchImpl(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(40000),
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', 'X-Request-ID': randomUUID() }, body: JSON.stringify(body) });
      const result = JSON.parse((await readBoundedBody(response.body, 1024 * 1024)).toString('utf8'));
      if (!response.ok) {
        if (response.status === 422 && result?.error?.code === 'embedding_input_too_long') {
          throw new RetrievalError(422, 'query_too_long', 'Shorten your search so it fits the local embedding model.');
        }
        throw unavailable();
      }
      return result;
    } catch (error) {
      if (error instanceof RetrievalError) { throw error; }
      throw unavailable();
    }
  }
}
