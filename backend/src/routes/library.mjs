import express from 'express';
import { serviceAuthentication } from '../internal-auth.mjs';
import { ChatError } from '../chat/policy.mjs';
export function createInternalLibraryRouter(service, { token }) {
  const router = express.Router(); router.use(serviceAuthentication(token));
  router.use(express.json({ limit: '128kb' }));
  router.post('/query', async (req, res) => {
    const body = req.body;
    if (!body || Object.keys(body).some(k => !['context', 'operation', 'arguments'].includes(k))) { throw new ChatError(400, 'invalid_library_query', 'Use a valid library request.'); }
    res.json(await service.query(body.context, body.operation, body.arguments));
  });
  router.use((error, _req, res, _next) => res.status(error instanceof ChatError ? error.status : 503).json({ error: error instanceof ChatError ? error.message : 'The library could not be read.', code: error instanceof ChatError ? error.code : 'library_unavailable' }));
  return router;
}
