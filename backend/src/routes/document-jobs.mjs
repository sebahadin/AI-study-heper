import express from 'express';
import { serviceAuthentication } from '../internal-auth.mjs';
import { DocumentError } from '../documents/errors.mjs';

const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const invalid = () => new DocumentError(400, 'invalid_job_request', 'Check the document job request fields.');

export function emptyJobBody(body) {
  if (body !== undefined && (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length)) {
    throw invalid();
  }
}

function leaseBody(body, fail = false) {
  const allowed = fail ? ['lease_token', 'error_code', 'retryable'] : ['lease_token'];
  if (!body || Array.isArray(body) || typeof body !== 'object' || !uuid(body.lease_token)
      || Object.keys(body).some(key => !allowed.includes(key))
      || (fail && (typeof body.error_code !== 'string' || (body.retryable !== undefined && typeof body.retryable !== 'boolean')))) {
    throw invalid();
  }
  return body;
}

export function createDocumentJobsRouter(service, { token } = {}) {
  const router = express.Router();
  router.use(serviceAuthentication(token));
  router.use((req, _res, next) => {
    if ((Number(req.get('content-length')) > 0 || req.get('transfer-encoding')) && !req.is('application/json')) {
      return next(new DocumentError(415, 'unsupported_media_type', 'Send job requests as JSON.'));
    }
    next();
  });
  const small = express.json({ limit: '16kb' });
  const publication = express.json({ limit: '3mb' });
  const reconciliation = express.json({ limit: '128kb' });
  router.use((req, res, next) => ((req.path.endsWith('/complete') || req.path === '/passages') ? publication : req.path === '/reconcile' ? reconciliation : small)(req, res, next));
  router.param('jobId', (_req, _res, next, value) => next(uuid(value) ? undefined : invalid()));
  router.post('/passages', async (req, res) => res.json(await service.passages(req.body)));
  router.post('/maintenance', async (req, res) => {
    if (typeof req.body?.embedding_model !== 'string' || req.body.embedding_model.length > 1024) { throw invalid(); }
    const profile = service.profile ? await service.profile() : null;
    if (profile && profile.embedding_model !== req.body.embedding_model) {
      throw new DocumentError(409, 'index_model_mismatch', 'Use the active embedding configuration.');
    }
    res.json(await service.maintenance.prepare(req.body.embedding_model, profile?.index_version));
  });
  router.post('/audit/candidates', async (req, res) => {
    if (typeof req.body?.embedding_model !== 'string' || req.body.embedding_model.length > 1024) { throw invalid(); }
    res.json(await service.maintenance.auditCandidates(req.body.embedding_model));
  });
  router.post('/audit/result', async (req, res) => res.json(await service.maintenance.auditResult(req.body)));
  router.post('/reconcile', async (req, res) => res.json(await service.maintenance.check(req.body?.records)));
  router.post('/cleanup/claim', async (req, res) => {
    emptyJobBody(req.body);
    const cleanup = await service.maintenance.claimCleanup();
    if (!cleanup) { return res.status(204).end(); }
    res.json(cleanup);
  });
  router.post('/cleanup/complete', async (req, res) => res.json(await service.maintenance.finishCleanup(req.body || {})));
  router.post('/claim', async (req, res) => {
    emptyJobBody(req.body);
    const job = await service.claim();
    if (!job) { return res.status(204).end(); }
    res.json(job);
  });
  router.post('/:jobId/heartbeat', async (req, res) => {
    const body = leaseBody(req.body);
    res.json(await service.heartbeat(req.params.jobId, body.lease_token));
  });
  router.post('/:jobId/source', async (req, res) => {
    const body = leaseBody(req.body);
    res.json(await service.source(req.params.jobId, body.lease_token));
  });
  router.post('/:jobId/complete', async (req, res) => {
    if (!req.body || !uuid(req.body.lease_token)) { throw invalid(); }
    res.json(await service.complete(req.params.jobId, req.body));
  });
  router.post('/:jobId/fail', async (req, res) => {
    const body = leaseBody(req.body, true);
    res.json(await service.fail(req.params.jobId, body.lease_token, body.error_code, body.retryable ?? false));
  });
  router.use((_req, res) => res.status(404).json({ error: 'Internal endpoint not found.', code: 'not_found' }));
  router.use((error, _req, res, _next) => {
    if (error instanceof DocumentError) { return res.status(error.status).json({ error: error.message, code: error.code }); }
    if (error.type === 'entity.parse.failed') { return res.status(400).json({ error: 'Invalid JSON request.', code: 'invalid_job_request' }); }
    if (error.type === 'entity.too.large') { return res.status(413).json({ error: 'The job request is too large.', code: 'job_request_too_large' }); }
    res.status(503).json({ error: 'Document processing is temporarily unavailable.', code: 'indexing_unavailable' });
  });
  return router;
}
