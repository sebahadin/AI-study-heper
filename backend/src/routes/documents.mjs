import express from 'express';
import { settings } from '../config.mjs';
import { requireAuth, validateId } from '../http.mjs';
import { AiPdfClient } from '../integrations/ai-pdfs.mjs';
import { R2Storage } from '../integrations/r2.mjs';
import { DocumentRepository } from '../documents/repository.mjs';
import { DocumentService } from '../documents/service.mjs';
import { DocumentError } from '../documents/errors.mjs';

export function createDocumentsRouter(service = new DocumentService({
  repository: new DocumentRepository(), storage: new R2Storage(settings.r2),
  inspector: new AiPdfClient({ baseUrl: settings.aiServiceUrl, token: settings.aiServiceToken }),
})) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use(requireAuth);
  router.param('id', validateId);
  router.get('/policy', async (_req, res) => res.json({ policy: await service.policy() }));
  router.get('/', async (req, res) => res.json(await service.list(req.user._id, req.query.before)));
  router.post('/uploads', async (req, res) => res.status(201).json(await service.begin(req.user._id, req.body)));
  router.get('/:id', async (req, res) => res.json({ document: await service.get(req.user._id, req.params.id) }));
  router.post('/:id/complete', async (req, res) => {
    if (req.body && (Array.isArray(req.body) || typeof req.body !== 'object' || Object.keys(req.body).length)) {
      throw new DocumentError(400, 'invalid_confirmation', 'Confirm using the document ID only.');
    }
    res.json({ document: await service.complete(req.user._id, req.params.id) });
  });
  router.use((error, _req, res, next) => {
    if (!(error instanceof DocumentError)) { return next(error); }
    res.status(error.status).json({ error: error.message, code: error.code });
  });
  return router;
}
