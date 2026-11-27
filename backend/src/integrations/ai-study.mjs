import { AiChatClient } from './ai-chat.mjs';
import { ChatError } from '../chat/policy.mjs';
import { readBoundedBody } from './bounded-body.mjs';
export class AiStudyClient extends AiChatClient {
  async config() {
    try {
      const response = await this.fetchImpl(new URL('/internal/study/config', this.baseUrl), this.options(AbortSignal.timeout(5000)));
      if (!response.ok) { throw new Error(); }
      const result = JSON.parse((await readBoundedBody(response.body, 16384)).toString());
      if (typeof result.enabled !== 'boolean' || !Number.isInteger(result.defaultCount) || result.defaultCount < 1 || result.defaultCount > 10) { throw new Error(); }
      return { enabled: result.enabled, model: String(result.model).slice(0, 100), defaultCount: result.defaultCount, maxCount: 10 };
    } catch { return { enabled: false, model: '', defaultCount: null, maxCount: 10 }; }
  }
  async *stream(body, signal) {
    // The base parser bounds frames and always closes the HTTP reader.
    const original = this.fetchImpl;
    const client = new AiChatClient({ baseUrl: this.baseUrl, token: this.token, fetchImpl: (url, options) => original(new URL('/internal/study/stream', url), options) });
    try { yield* client.stream(body, signal); }
    catch { throw new ChatError(503, 'chat_unavailable', 'Generation was interrupted.'); }
  }
}
