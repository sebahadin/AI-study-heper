import express from 'express';
import { once } from 'node:events';
import { requireAuth } from '../http.mjs';
import { ChatError } from '../chat/policy.mjs';
import { publicConversation, publicMessage } from '../chat/service.mjs';

async function send(res, event, signal) {
  if (signal.aborted || res.destroyed) { return; }
  if (!res.write(`data: ${JSON.stringify(event)}\n\n`)) { await once(res, 'drain', { signal }); }
}
export function createChatRouter(service) {
  const router = express.Router();
  router.use(requireAuth);
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/config', async (_req, res) => res.json(await service.client.config()));
  router.get('/options', async (req, res) => res.json(await service.options(req.user._id)));
  router.get('/', async (req, res) => {
    const page = await service.repository.list(req.user._id, req.query.cursor);
    res.json({ conversations: page.conversations.map(publicConversation), nextCursor: page.nextCursor });
  });
  router.post('/', async (req, res) => res.status(201).json({ conversation: await service.create(req.user._id, req.body) }));
  router.get('/:id', async (req, res) => res.json({ conversation: publicConversation(await service.owned(req.user._id, req.params.id)) }));
  router.patch('/:id', async (req, res) => res.json({ conversation: await service.patch(req.user._id, req.params.id, req.body) }));
  router.delete('/:id', async (req, res) => { await service.remove(req.user._id, req.params.id); res.status(204).end(); });
  router.post('/:id/cancel', async (req, res) => {
    if (!req.body || Object.keys(req.body).some(key => key !== 'runId')) { throw new ChatError(400, 'invalid_run', 'Choose the active response.'); }
    res.json({ conversation: await service.cancel(req.user._id, req.params.id, req.body.runId) });
  });
  router.get('/:id/sources/:messageId/:number', async (req, res) => {
    const number = Number(req.params.number);
    if (!Number.isInteger(number) || number < 1 || number > 12) { throw new ChatError(404, 'source_not_found', 'Source not found.'); }
    res.json(await service.source(req.user._id, req.params.id, req.params.messageId, number));
  });
  router.post('/:id/messages', async (req, res) => {
    const started = await service.prepare(req.user._id, req.params.id, req.body);
    const controller = new AbortController();
    const disconnect = () => controller.abort();
    req.once('aborted', disconnect); res.once('close', disconnect);
    res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' }); res.flushHeaders();
    const ping = setInterval(() => { if (!res.destroyed) {res.write(': heartbeat\n\n');} }, 10000);
    try {
      await send(res, { type: 'start', runId: started.run?.id, requestId: req.body.requestId,
        ...(started.question && { question: publicMessage(started.question), answer: publicMessage(started.answer) }), duplicate: !!started.duplicate }, controller.signal);
      for await (const event of service.answer(req.user._id, started, controller.signal)) { await send(res, event, controller.signal); }
    } catch {
      if (!controller.signal.aborted) { await send(res, { type: 'error', code: 'chat_unavailable', message: 'The response was interrupted. Your conversation is saved.' }, controller.signal).catch(() => {}); }
    } finally {
      clearInterval(ping); controller.abort(); req.off('aborted', disconnect); res.off('close', disconnect); res.end();
    }
  });
  router.use((error, _req, res, _next) => {
    const safe = error instanceof ChatError || ['RetrievalError', 'DocumentError'].includes(error.constructor?.name);
    if (safe && error.status < 500) { return res.status(error.status).json({ error: error.message, code: error.code }); }
    res.status(503).json({ error: 'The assistant is temporarily unavailable. Your saved conversations are safe.', code: 'chat_unavailable' });
  });
  return router;
}
