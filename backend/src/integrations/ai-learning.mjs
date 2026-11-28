import { AiChatClient } from './ai-chat.mjs';
import { readBoundedBody } from './bounded-body.mjs';
import { ChatError } from '../chat/policy.mjs';
export class AiLearningClient extends AiChatClient {
  async call(action, body) {
    try {
      const response = await this.fetchImpl(new URL(`/internal/learning/${action}`, this.baseUrl), { ...this.options(AbortSignal.timeout(90000)), method: 'POST', body: JSON.stringify(body) });
      if (!response.ok) { throw new Error(); }
      return JSON.parse((await readBoundedBody(response.body, 100000)).toString());
    } catch { throw new ChatError(503, 'assessment_unavailable', 'AI feedback is temporarily unavailable. Your answers are saved; you can retry.'); }
  }
}
