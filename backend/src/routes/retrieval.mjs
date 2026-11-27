import express from 'express';
import { requireAuth } from '../http.mjs';
import { serviceAuthentication } from '../internal-auth.mjs';
import { retrievalErrorHandler } from '../retrieval/errors.mjs';

export function createInternalRetrievalRouter(service, { token }) {
  const router = express.Router();
  router.use(serviceAuthentication(token, { code: 'retrieval_unavailable', message: 'Study search is temporarily unavailable.' }));
  router.use((req, res, next) => {
    if (!req.is('application/json')) { return res.status(415).json({ error: 'Send retrieval requests as JSON.', code: 'unsupported_media_type' }); }
    next();
  });
  router.use(express.json({ limit: '128kb' }));
  router.post('/context', async (req, res) => res.json({ context: await service.resolver.refresh(req.body?.context) }));
  router.post('/passages', async (req, res) => res.json(await service.passages.fetch(req.body)));
  router.use((_req, res) => res.status(404).json({ error: 'Internal endpoint not found.', code: 'not_found' }));
  router.use(retrievalErrorHandler);
  return router;
}
export function createStudyRouter(service) {
  const router = express.Router();
  router.use(requireAuth);
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.post('/search', async (req, res) => res.json(await service.search(req.user._id, req.body)));
  router.use(retrievalErrorHandler);
  return router;
}
