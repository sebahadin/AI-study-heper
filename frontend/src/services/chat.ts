import { ApiError } from './api';
export type ChatMode = 'pending' | 'grounded' | 'general' | 'mixed' | 'clarification' | 'insufficient_evidence' | 'draft' | 'coaching';
export interface ChatSelection { library: boolean; documents: string[]; notes: string[]; books: string[]; courses: string[] }
export const emptySelection = (): ChatSelection => ({ library: false, documents: [], notes: [], books: [], courses: [] });
export interface ChatCitation { number: number; chunk_id: string; source: { source_id: string; source_type: 'note' | 'document'; source_version: string; index_generation: string }; locator: string; page_start?: number | null; page_end?: number | null; title: string; href: string }
export interface ChatMessage { id: string; requestId: string; sequence: number; role: 'user' | 'assistant'; content: string; status: 'completed' | 'generating' | 'cancelled' | 'failed' | 'interrupted'; mode: ChatMode; citations: ChatCitation[]; createdAt: string; error?: string | null; model?: string; proposalId?: string | null; proposalKind?: string }
export interface Conversation { _id: string; title: string; selection: ChatSelection; topic: string; allowGeneral: boolean; updatedAt: string; messageCount: number; messages: ChatMessage[]; busy: boolean; activeRunId?: string | null; limitReached: boolean }
export interface ChatOptions { courses: { _id: string; title: string; code?: string }[]; books: { _id: string; title: string; author?: string }[]; notes: { _id: string; title: string; indexingStatus?: string }[]; documents: { _id: string; title: string; filename?: string; indexingStatus?: string; pageCount?: number }[] }
export interface ChatStreamEvent { type: 'start' | 'status' | 'mode' | 'delta' | 'done' | 'error'; runId?: string; requestId?: string; question?: ChatMessage; answer?: ChatMessage; message?: ChatMessage | string; phase?: string; mode?: ChatMode; text?: string; title?: string; code?: string }

export async function streamChat(id: string, content: string, requestId: string, onEvent: (event: ChatStreamEvent) => void, signal: AbortSignal) {
  const response = await fetch(`/api/chat/${id}/messages`, { method: 'POST', credentials: 'same-origin', signal,
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ content, requestId }) });
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('classmate:unauthenticated'));
    const result = await response.json().catch(() => ({}));
    throw new ApiError(result.error || 'The assistant could not start this response.', response.status, {}, result.code);
  }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('The assistant returned an unexpected response.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', finished = false;
  try {
    while (true) {
      const { value, done } = await reader.read(); buffer += decoder.decode(value, { stream: !done }); buffer = buffer.replace(/\r\n/g, '\n');
      if (buffer.length > 65536) throw new Error('The response was too large.');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        const event = JSON.parse(data) as ChatStreamEvent;
        if (!['start', 'status', 'mode', 'delta', 'done', 'error'].includes(event.type)) continue;
        onEvent(event); if (event.type === 'done' || event.type === 'error') finished = true;
      }
      if (done) break;
    }
    if (!finished && !signal.aborted) throw new Error('The reply was interrupted. Your message is saved; try again.');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
