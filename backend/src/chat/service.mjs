import { randomUUID } from 'node:crypto';
import { Book, Course, Document, Note } from '../db.mjs';
import { settings } from '../config.mjs';
import { parseSelection, plainObject, objectId, sourceKey } from '../retrieval/scope.mjs';
import { createStudySearchService } from '../retrieval/service.mjs';
import { AiChatClient } from '../integrations/ai-chat.mjs';
import { ChatRepository } from './repository.mjs';
import { CHAT_MAX_MESSAGES, CHAT_MAX_INPUT, CHAT_MAX_ANSWER, ChatError, chatFailures, uuid, citationKey, referencedNumbers } from './policy.mjs';

const unavailable = () => new ChatError(503, 'chat_unavailable', chatFailures.chat_unavailable);
const missing = () => new ChatError(404, 'conversation_not_found', 'Conversation not found.');
const modes = new Set(['grounded', 'general', 'mixed', 'clarification', 'insufficient_evidence']);
export const publicMessage = entry => ({ id: entry.id, requestId: entry.requestId, sequence: entry.sequence, role: entry.role, content: entry.content,
  status: entry.status, mode: entry.mode, citations: entry.citations || [], createdAt: entry.createdAt, model: entry.model,
  error: entry.errorCode ? chatFailures[entry.errorCode] || chatFailures.chat_unavailable : null });
export const publicConversation = convo => ({ _id: String(convo._id), title: convo.title, selection: convo.selection, topic: convo.topic,
  allowGeneral: convo.allowGeneral, updatedAt: convo.updatedAt, messageCount: convo.messageCount, busy: !!convo.activeRun, activeRunId: convo.activeRun?.id || null,
  messages: (convo.messages || []).map(publicMessage), limitReached: convo.messageCount >= CHAT_MAX_MESSAGES });

export class ChatService {
  constructor({ repository, search, client, dailyTurns = 50, globalTurns = 200 }) {
    Object.assign(this, { repository, search, client, dailyTurns, globalTurns }); this.controllers = new Map();
  }
  async owned(user, id, tail = 200) {
    if (!objectId(id)) { throw missing(); }
    const convo = await this.repository.get(user, id, tail);
    if (!convo) { throw missing(); }
    return convo;
  }
  async fields(user, body, partial = false) {
    if (!plainObject(body) || Object.keys(body).some(key => !['title', 'selection', 'topic', 'allowGeneral'].includes(key))) {
      throw new ChatError(400, 'invalid_conversation', 'Check the conversation settings.');
    }
    const fields = {};
    for (const [key, max] of [['title', 100], ['topic', 120]]) {
      if (body[key] !== undefined) {
        if (typeof body[key] !== 'string' || body[key].length > max || /[\uD800-\uDFFF]/u.test(body[key])) { throw new ChatError(400, 'invalid_conversation', 'Check the conversation settings.'); }
        fields[key] = body[key].trim();
      }
    }
    if (body.allowGeneral !== undefined) {
      if (typeof body.allowGeneral !== 'boolean') { throw new ChatError(400, 'invalid_conversation', 'Choose a valid explanation preference.'); }
      fields.allowGeneral = body.allowGeneral;
    }
    if (!partial || body.selection !== undefined) {
      fields.selection = parseSelection(body.selection);
      for (const [kind, model] of [['notes', Note], ['documents', Document], ['books', Book], ['courses', Course]]) {
        const ids = fields.selection[kind];
        if (ids.length && await model.countDocuments({ _id: { $in: ids }, user, ...(kind === 'documents' ? { status: { $nin: ['deleted', 'deleting'] } } : {}) }) !== ids.length) {
          throw new ChatError(404, 'material_not_found', 'A selected study material is no longer available.');
        }
      }
    }
    return fields;
  }
  async create(user, body) { return publicConversation(await this.repository.create(user, await this.fields(user, body))); }
  async patch(user, id, body) {
    await this.owned(user, id);
    const updated = await this.repository.patch(user, id, await this.fields(user, body, true));
    if (!updated) { throw new ChatError(409, 'conversation_busy', 'Stop the current response before changing the conversation.'); }
    return publicConversation(updated);
  }
  async remove(user, id) {
    const convo = await this.owned(user, id);
    if (convo.activeRun) { this.controllers.get(convo.activeRun.id)?.abort(); }
    if (!(await this.repository.remove(user, id)).deletedCount) { throw missing(); }
  }
  async cancel(user, id, runId) {
    await this.owned(user, id);
    if (!uuid(runId)) { throw new ChatError(400, 'invalid_run', 'Choose the active response.'); }
    const result = await this.repository.cancel(user, id, runId);
    this.controllers.get(runId)?.abort();
    return result ? publicConversation(result) : publicConversation(await this.owned(user, id));
  }
  async options(user) {
    const [courses, books, notes, documents] = await Promise.all([
      Course.find({ user }).select('title code').sort({ title: 1 }).limit(500).lean(),
      Book.find({ user }).select('title author').sort({ title: 1 }).limit(500).lean(),
      Note.find({ user }).select('title').sort({ title: 1 }).limit(500).lean(),
      Document.find({ user, status: 'uploaded' }).select('title filename').sort({ title: 1 }).limit(500).lean(),
    ]);
    return { courses, books, notes, documents };
  }
  async prepare(user, id, body) {
    if (!plainObject(body) || Object.keys(body).some(key => !['requestId', 'content'].includes(key)) || !uuid(body.requestId)
        || typeof body.content !== 'string' || !body.content.trim() || body.content.length > CHAT_MAX_INPUT || /[\uD800-\uDFFF]/u.test(body.content)) {
      throw new ChatError(400, 'invalid_message', 'Write a message of up to 4,000 characters.');
    }
    const conversation = await this.owned(user, id, 12);
    const previous = await this.repository.previous(user, id, body.requestId);
    if (previous) {
      if (previous.questionContent !== body.content.trim()) { throw new ChatError(409, 'request_conflict', 'Use a new request for a different message.'); }
      if (previous.status === 'generating') { throw new ChatError(409, 'conversation_busy', 'This message is already being answered.'); }
      return { duplicate: previous, conversation };
    }
    if (conversation.messageCount >= CHAT_MAX_MESSAGES) { throw new ChatError(409, 'conversation_full', 'This conversation has reached its limit. Start a new chat to continue.'); }
    if (conversation.activeRun) { throw new ChatError(409, 'conversation_busy', 'Wait for the current response or stop it first.'); }
    const started = await this.repository.begin(user, conversation, body.requestId, body.content.trim());
    if (!started) { throw new ChatError(409, 'conversation_busy', 'The conversation changed. Refresh and try again.'); }
    return { ...started, history: conversation.messages };
  }
  history(messages, refs, allowGeneral) {
    const allowed = new Set(refs.map(sourceKey));
    const result = messages.filter(entry => entry.status === 'completed').map(entry => {
      const unavailableSource = entry.role === 'assistant' && ((entry.citations || []).some(c => !allowed.has(sourceKey(c.source)))
        || !allowGeneral && ['general', 'mixed'].includes(entry.mode));
      return { role: entry.role, content: unavailableSource ? '[An earlier answer is outside the current source scope. Retrieve fresh evidence.]' : entry.content,
        citations: unavailableSource ? [] : (entry.citations || []).map(({ number, ...citation }) => ({ number, ...citation })) };
    }).slice(-12);
    while (result.length && Buffer.byteLength(JSON.stringify(result)) > 60000) { result.shift(); }
    return result;
  }
  async final(user, conversation, context, result) {
    if (!plainObject(result) || typeof result.answer !== 'string' || !result.answer.trim() || result.answer.length > CHAT_MAX_ANSWER
        || !modes.has(result.mode) || !Array.isArray(result.citations) || result.citations.length > 12
        || !conversation.allowGeneral && ['general', 'mixed'].includes(result.mode)) { throw new ChatError(503, 'response_invalid', chatFailures.response_invalid); }
    const references = referencedNumbers(result.answer);
    if (references.some(number => !result.citations.some(c => c.number === number))
        || ['grounded', 'mixed'].includes(result.mode) && !references.length
        || ['general', 'clarification', 'insufficient_evidence'].includes(result.mode) && result.citations.length) {
      throw new ChatError(503, 'response_invalid', chatFailures.response_invalid);
    }
    if (!references.length) { return { content: result.answer, mode: result.mode, citations: [] }; }
    const current = await this.search.resolver.resolve(user, conversation.selection);
    const allowed = new Map(current.sources.map(ref => [sourceKey(ref), ref]));
    const chosen = result.citations.filter(c => references.includes(c.number));
    if (new Set(chosen.map(c => c.number)).size !== references.length || chosen.some(c => !allowed.has(sourceKey(c.source)))) {
      throw new ChatError(409, 'source_changed', chatFailures.source_changed);
    }
    const refs = [...new Map(chosen.map(c => [sourceKey(c.source), allowed.get(sourceKey(c.source))])).values()];
    const canonical = await this.search.passages.fetch({ context: { ...context, scope: { ...context.scope, sources: refs } }, chunk_ids: chosen.map(c => c.chunk_id) });
    const approved = new Set(canonical.passages.map(c => citationKey(c.citation)));
    if (chosen.some(c => !approved.has(citationKey(c)))) { throw new ChatError(409, 'source_changed', chatFailures.source_changed); }
    const info = new Map(current.descriptors.map(source => [sourceKey(source), source]));
    return { content: result.answer, mode: result.mode, citations: chosen.map(c => ({ number: c.number,
      ...canonical.passages.find(p => citationKey(p.citation) === citationKey(c)).citation,
      title: String(info.get(sourceKey(c.source)).title).slice(0, 200), href: info.get(sourceKey(c.source)).href,
    })) };
  }
  async *answer(user, started, signal) {
    const { conversation, run } = started, id = String(conversation._id);
    if (started.duplicate) { yield { type: 'done', message: publicMessage(started.duplicate) }; return; }
    if (signal.aborted) { await this.repository.cancel(user, id, run.id); return; }
    const controller = new AbortController(); this.controllers.set(run.id, controller);
    const cancel = () => controller.abort(); signal.addEventListener('abort', cancel, { once: true });
    let completed = false, total = 0, heartbeat;
    try {
      await this.repository.quota(user, this.dailyTurns, this.globalTurns);
      const resolved = await this.search.resolver.resolve(user, conversation.selection);
      const context = { user_id: String(user), conversation_id: id, run_id: run.id,
        scope: { scope_id: `${id}:${conversation.revision}`, selection: conversation.selection, topics: conversation.topic ? [conversation.topic] : [], sources: resolved.sources } };
      heartbeat = setInterval(() => { void this.repository.heartbeat(user, id, run.id).then(record => { if (!record.modifiedCount) {controller.abort();} }).catch(() => controller.abort()); }, 10000);
      let receivedFinal = false;
      for await (const event of this.client.stream({ message: started.question.content, history: this.history(started.history, resolved.sources, conversation.allowGeneral), context,
        topic: conversation.topic, allow_general: conversation.allowGeneral }, controller.signal)) {
        if (controller.signal.aborted) { break; }
        if (event.type === 'delta') {
          if (typeof event.text !== 'string' || event.text.length > 8192 || (total += event.text.length) > CHAT_MAX_ANSWER) { throw unavailable(); }
          yield { type: 'delta', text: event.text };
        } else if (event.type === 'status' && ['planning', 'searching', 'reading', 'writing', 'checking'].includes(event.phase)) {
          yield { type: 'status', phase: event.phase };
        } else if (event.type === 'mode' && modes.has(event.mode)) { yield { type: 'mode', mode: event.mode }; }
        else if (event.type === 'error') { throw new ChatError(503, Object.hasOwn(chatFailures, event.code) ? event.code : 'chat_unavailable', chatFailures.chat_unavailable); }
        else if (event.type === 'final') {
          const verified = await this.final(user, conversation, context, event);
          const record = await this.repository.finish(user, id, run, { ...verified, status: 'completed', model: typeof event.model === 'string' ? event.model.slice(0, 100) : '',
            usage: event.usage && { inputTokens: Number(event.usage.input_tokens) || 0, outputTokens: Number(event.usage.output_tokens) || 0 } });
          if (!record) { throw new ChatError(409, 'source_changed', chatFailures.source_changed); }
          completed = receivedFinal = true;
          yield { type: 'done', message: publicMessage(record.messages.find(entry => entry.id === run.assistantId)), title: record.title };
          break;
        }
      }
      if (!receivedFinal && !controller.signal.aborted) { throw unavailable(); }
    } catch (error) {
      const cancelled = controller.signal.aborted;
      const code = cancelled ? 'cancelled' : Object.hasOwn(chatFailures, error.code) ? error.code : 'chat_unavailable';
      await this.repository.finish(user, id, run, { content: '', citations: [], status: cancelled ? 'cancelled' : 'failed', errorCode: code }).catch(() => {});
      if (!cancelled) { yield { type: 'error', code, message: chatFailures[code] }; }
    } finally {
      if (heartbeat) {clearInterval(heartbeat);}
      signal.removeEventListener('abort', cancel); controller.abort(); this.controllers.delete(run.id);
      if (!completed) { await this.repository.cancel(user, id, run.id).catch(() => {}); }
    }
  }
  async source(user, id, messageId, number) {
    const convo = await this.owned(user, id), entry = convo.messages.find(m => m.id === messageId && m.role === 'assistant' && m.status === 'completed');
    const citation = entry?.citations?.find(c => c.number === number);
    if (!citation) { throw missing(); }
    const resolved = await this.search.resolver.resolve(user, convo.selection);
    const ref = resolved.sources.find(r => sourceKey(r) === sourceKey(citation.source));
    if (!ref) { throw new ChatError(410, 'source_changed', 'This source changed or is outside the current scope. The historical answer is kept in your conversation.'); }
    const context = { user_id: String(user), run_id: randomUUID(), scope: { scope_id: randomUUID(), selection: convo.selection, sources: [ref] } };
    const result = await this.search.passages.fetch({ context, chunk_ids: [citation.chunk_id] });
    if (!result.passages.length) { throw new ChatError(410, 'source_changed', 'This source is no longer available in its cited version.'); }
    return { passage: result.passages[0], title: citation.title, href: citation.href };
  }
}
export const createChatService = search => new ChatService({ repository: new ChatRepository(), search: search || createStudySearchService(),
  client: new AiChatClient({ baseUrl: settings.aiServiceUrl, token: settings.aiServiceToken }),
  dailyTurns: settings.chatDailyTurns, globalTurns: settings.chatGlobalDailyTurns });
