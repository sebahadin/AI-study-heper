import express from 'express';
import { requireAuth } from '../http.mjs';
import { serviceAuthentication } from '../internal-auth.mjs';
import { ChatError } from '../chat/policy.mjs';
import { publicAttempt, exact } from '../learning/policy.mjs';
function errors(error, _req, res, _next) {
  const safe = error instanceof ChatError || error.code === 'attempt_changed';
  res.status(safe ? error.status : 503).json({ error: safe ? error.message : 'Learning history is temporarily unavailable. Your saved answers are kept.', code: safe ? error.code : 'learning_unavailable' });
}
export function createInternalLearningRouter(service, { token }) {
  const router = express.Router(); router.use(serviceAuthentication(token)); router.use(express.json({ limit: '128kb' }));
  router.post('/context', async (req, res) => { exact(req.body, ['context']); res.json(await service.chatContext(req.body.context)); }); router.use(errors); return router;
}
export function createLearningRouter(service) {
  const router = express.Router(); router.use(requireAuth); router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const show = row => ({ attempt: publicAttempt(row, { now: service.repository.clock() }) });
  router.get('/', async (req, res) => res.json(await service.dashboard(req.user._id)));
  router.post('/coaching', async (req, res) => { exact(req.body, []); res.json(await service.coach(req.user._id)); });
  router.get('/attempts', async (req, res) => { const page = await service.repository.list(req.user._id, req.query.cursor); res.json({ attempts: page.rows.map(row => publicAttempt(row, { brief: true })), nextCursor: page.nextCursor }); });
  router.post('/attempts', async (req, res) => res.status(201).json(show(await service.start(req.user._id, req.body))));
  router.get('/attempts/:id', async (req, res) => res.json(show(await service.repository.owned(req.user._id, req.params.id))));
  router.patch('/attempts/:id', async (req, res) => res.json(show(await service.edit(req.user._id, req.params.id, req.body))));
  router.post('/attempts/:id/answers/:question', async (req, res) => res.json(show(await service.submit(req.user._id, req.params.id, req.params.question, req.body))));
  router.post('/attempts/:id/assessments/:question', async (req, res) => { exact(req.body, []); res.json(show(await service.assess(req.user._id, req.params.id, req.params.question))); });
  router.post('/attempts/:id/complete', async (req, res) => res.json(show(await service.complete(req.user._id, req.params.id, req.body))));
  router.use(errors); return router;
}
