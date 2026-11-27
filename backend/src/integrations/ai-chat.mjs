import { randomUUID } from 'node:crypto';
import { ChatError, CHAT_TURN_TIMEOUT_MS } from '../chat/policy.mjs';
import { readBoundedBody } from './bounded-body.mjs';

export class AiChatClient {
  constructor({ baseUrl, token, fetchImpl = fetch }) { Object.assign(this, { baseUrl, token, fetchImpl }); }
  options(signal) {
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(this.token || '')) { throw new ChatError(503, 'chat_unavailable', 'The assistant is temporarily unavailable.'); }
    return { headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', 'X-Request-ID': randomUUID() }, redirect: 'error', signal };
  }
  async config() {
    try {
      const response = await this.fetchImpl(new URL('/internal/chat/config', this.baseUrl), this.options(AbortSignal.timeout(5000)));
      if (!response.ok) { throw new Error('Unavailable'); }
      const result = JSON.parse((await readBoundedBody(response.body, 16384)).toString('utf8'));
      if (typeof result.enabled !== 'boolean' || typeof result.model !== 'string') { throw new Error('Invalid profile'); }
      return { enabled: result.enabled, model: result.model, provider: result.provider };
    } catch { return { enabled: false, model: '', provider: '' }; }
  }
  async *stream(body, signal) {
    const timeout = AbortSignal.timeout(CHAT_TURN_TIMEOUT_MS);
    let response;
    try {
      response = await this.fetchImpl(new URL('/internal/chat/stream', this.baseUrl), { ...this.options(AbortSignal.any([signal, timeout])), method: 'POST', body: JSON.stringify(body) });
      if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream') || !response.body) { throw new Error('Unavailable'); }
    } catch { throw new ChatError(503, 'chat_unavailable', 'The assistant is temporarily unavailable.'); }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', count = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done }); buffer = buffer.replace(/\r\n/g, '\n');
        if (buffer.length > 65536) { throw new Error('Frame limit'); }
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data) { continue; }
          if (++count > 5000) { throw new Error('Event limit'); }
          const event = JSON.parse(data);
          if (!event || typeof event !== 'object' || !['status', 'mode', 'delta', 'final', 'error', 'ping'].includes(event.type)) { throw new Error('Invalid event'); }
          yield event;
        }
        if (done) { break; }
      }
      if (buffer.trim()) { throw new Error('Incomplete frame'); }
    } catch (error) {
      if (error instanceof ChatError) { throw error; }
      throw new ChatError(503, 'chat_unavailable', 'The assistant response was interrupted.');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
}
