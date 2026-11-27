import express from 'express';
import { once } from 'node:events';
import { requireAuth } from '../http.mjs';
import { ChatError } from '../chat/policy.mjs';
import { kinds, safeErrors } from '../study-tools/validation.mjs';
import { publicStudy } from '../study-tools/service.mjs';
export function createStudyToolsRouter(service) {
  const router = express.Router(); router.use(requireAuth);
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/config', async (_req, res) => res.json(await service.client.config()));
  router.get('/', async (req, res) => {
    if (req.query.kind && !kinds.includes(req.query.kind) || req.query.status && !['saved', 'drafts', 'all'].includes(req.query.status)) { throw new ChatError(400, 'invalid_filter', 'Choose a valid study-set filter.'); }
    const page = await service.list(req.user._id, req.query);
    res.json({ artifacts: page.rows.map(row => publicStudy(row, true)), nextCursor: page.nextCursor });
  });
  router.post('/', async (req, res) => res.status(201).json({ artifact: await service.create(req.user._id, req.body) }));
  router.get('/:id', async (req, res) => res.json({ artifact: publicStudy(await service.owned(req.user._id, req.params.id)) }));
  router.patch('/:id', async (req, res) => res.json({ artifact: await service.edit(req.user._id, req.params.id, req.body) }));
  router.post('/:id/confirmations', async (req, res) => res.json(await service.confirmation(req.user._id, req.params.id, req.body)));
  router.post('/:id/actions', async (req, res) => res.json(await service.action(req.user._id, req.params.id, req.body)));
  router.post('/:id/cancel', async (req, res) => res.json({ artifact: await service.cancel(req.user._id, req.params.id) }));
  router.get('/:id/sources/:number', async (req, res) => res.json(await service.source(req.user._id, req.params.id, Number(req.params.number))));
  router.get('/:id/practice', async (req, res) => res.json(await service.practice(req.user._id, req.params.id)));
  router.post('/:id/feedback', async (req, res) => res.json(await service.feedback(req.user._id, req.params.id, req.body)));
  router.post('/:id/generate', async (req, res) => {
    const started = await service.prepare(req.user._id, req.params.id), controller = new AbortController();
    const stop = () => controller.abort(); res.once('close', stop); req.once('aborted', stop);
    res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' }); res.flushHeaders();
    const ping = setInterval(() => { if (!res.destroyed) { res.write(': heartbeat\n\n'); } }, 10000);
    try {
      for await (const event of service.generate(req.user._id, started, controller.signal)) {
        if (res.destroyed) { break; }
        if (!res.write(`data: ${JSON.stringify(event)}\n\n`)) { await once(res, 'drain', { signal: controller.signal }); }
      }
    } finally { clearInterval(ping); controller.abort(); res.off('close', stop); req.off('aborted', stop); res.end(); }
  });
  router.use((error, _req, res, _next) => {
    if (res.headersSent) { return res.end(); }
    const status = error.status || (error.code === 'invalid_cursor' ? 400 : 503);
    const safe = error instanceof ChatError || ['RetrievalError', 'DocumentError'].includes(error.constructor?.name);
    res.status(status < 500 ? status : 503).json({ error: safe && status < 500 ? error.message : safeErrors[error.code] || safeErrors.chat_unavailable, code: error.code && (safe || error.code === 'invalid_cursor') ? error.code : 'chat_unavailable' });
  });
  return router;
}
