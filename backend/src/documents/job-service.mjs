import { CanonicalPassages } from '../retrieval/passages.mjs';
import { StudyScopeResolver } from '../retrieval/scope.mjs';
import { randomUUID } from 'node:crypto';
import { IndexMaintenance } from './maintenance.mjs';
import { AiPdfClient } from '../integrations/ai-pdfs.mjs';
import { Document, Note } from '../db.mjs';
import { noteSourceText, textDigest, validatePublication } from './publication.mjs';
import { settings } from '../config.mjs';
import { R2Storage } from '../integrations/r2.mjs';
import { DocumentJobRepository } from './job-repository.mjs';
import { DocumentError } from './errors.mjs';
import {
  createIndexingJob, indexingFailures, publicIndexing, leaseHash,
  INDEXING_LEASE_MS, INDEXING_RETRY_BASE_MS, INDEXING_SOURCE_URL_SECONDS,
} from './indexing-policy.mjs';

const leaseLost = () => new DocumentError(409, 'indexing_lease_lost', 'This worker lease is no longer current.');
const snapshotValid = doc => doc.objectKey?.startsWith(`documents/${doc.user}/${doc._id}/`)
  && /^[a-f0-9]{64}$/.test(doc.sha256 || '') && typeof doc.sourceVersion === 'string'
  && doc.sourceVersion.length > 0 && Number.isSafeInteger(doc.byteCount) && doc.byteCount > 0
  && Number.isSafeInteger(doc.pageCount) && doc.pageCount > 0
  && Number.isSafeInteger(doc.maxBytes) && doc.byteCount <= doc.maxBytes;

async function guarded(operation) {
  try { return await operation(); } catch (error) {
    if (error instanceof DocumentError) { throw error; }
    throw new DocumentError(503, 'indexing_unavailable', 'Document processing is temporarily unavailable.');
  }
}

export class DocumentJobService {
  constructor({ repository, storage, clock = () => new Date(), notesRepository, profile }) { Object.assign(this, { repository, storage, clock, profile }); this.notesRepository = notesRepository; this.cursor = 0; this.maintenance = new IndexMaintenance({ storage, clock }); }

  async status(user, id) {
    return guarded(async () => {
      const doc = await this.repository.get(user, id);
      if (!doc) { throw new DocumentError(404, 'document_not_found', 'Document not found.'); }
      return publicIndexing(doc);
    });
  }

  async retry(user, id) {
    return guarded(async () => {
      const doc = await this.repository.get(user, id);
      if (!doc) { throw new DocumentError(404, 'document_not_found', 'Document not found.'); }
      if ((this.repository.sourceType !== 'note' && (doc.status !== 'uploaded' || !snapshotValid(doc))) || doc.deletedAt) {
        throw new DocumentError(409, 'document_unavailable', 'Save a valid PDF before requesting indexing.');
      }
      const status = publicIndexing(doc).status;
      if (['queued', 'processing', 'ready'].includes(status)) { return publicIndexing(doc); }
      const updated = await this.repository.queue(user, doc, createIndexingJob(user, doc.sourceVersion || randomUUID(), this.clock()));
      if (!updated) { throw new DocumentError(409, 'indexing_conflict', 'The document changed. Refresh and try again.'); }
      return publicIndexing(updated);
    });
  }

  async claim() {
    return guarded(async () => {
      const now = this.clock();
      const stores = this.notesRepository ? [this.repository, this.notesRepository] : [this.repository];
      let doc;
      let store;
      for (let offset = 0; offset < stores.length; offset++) {
        store = stores[(this.cursor + offset) % stores.length];
        await store.expireExhausted(now);
        doc = await store.claim(randomUUID(), now, new Date(now.getTime() + INDEXING_LEASE_MS), randomUUID());
        if (doc) { this.cursor = (this.cursor + offset + 1) % stores.length; break; }
      }
      if (!doc) { return null; }
      const kind = store.sourceType || 'document';
      if (kind === 'document' && !snapshotValid(doc)) {
        await this.fail(doc.indexing.jobId, doc.indexing.leaseToken, 'source_unavailable', false);
        return null;
      }
      const source = { source_id: String(doc._id), source_type: kind, source_version: doc.sourceVersion, index_generation: doc.indexing.generationId };
      return {
        job: {
          job_id: doc.indexing.jobId, document_id: String(doc._id), source_version: doc.sourceVersion,
          storage_key: kind === 'document' ? doc.objectKey : `notes/${doc.user}/${doc._id}`, source_type: kind,
          limits: { max_pages: doc.pageCount || 1, max_bytes: doc.byteCount || Buffer.byteLength(noteSourceText(doc)) },
        },
        context: {
          user_id: String(doc.user), run_id: `${doc.indexing.jobId}:${doc.indexing.attempts}`,
          scope: { scope_id: doc.indexing.jobId, sources: [source] },
        },
        snapshot: { source, sha256: kind === 'note' ? textDigest(noteSourceText(doc)) : doc.sha256 },
        lease: { token: doc.indexing.leaseToken, expires_at: doc.indexing.leaseUntil },
        attempt: doc.indexing.attempts, max_attempts: doc.indexing.maxAttempts,
      };
    });
  }

  async locate(jobId) {
    for (const repository of [this.repository, this.notesRepository].filter(Boolean)) {
      const doc = await repository.getJob(jobId);
      if (doc) { return { repository, doc }; }
    }
    return { repository: this.repository, doc: null };
  }

  async heartbeat(jobId, token) {
    return guarded(async () => {
      const now = this.clock();
      const { repository } = await this.locate(jobId);
      const doc = await repository.heartbeat(jobId, token, now, new Date(now.getTime() + INDEXING_LEASE_MS));
      if (!doc) { throw leaseLost(); }
      return { expires_at: doc.indexing.leaseUntil };
    });
  }

  async source(jobId, token) {
    return guarded(async () => {
      const now = this.clock();
      const { repository } = await this.locate(jobId);
      const doc = await repository.lease(jobId, token, now);
      if (!doc) { throw leaseLost(); }
      if (repository.sourceType === 'note') { return { text: noteSourceText(doc), sha256: textDigest(noteSourceText(doc)) }; }
      if (!snapshotValid(doc)) { throw new DocumentError(409, 'source_unavailable', 'The saved PDF is no longer available.'); }
      const seconds = Math.min(INDEXING_SOURCE_URL_SECONDS, Math.floor((doc.indexing.leaseUntil - now) / 1000));
      if (seconds < 1) { throw leaseLost(); }
      return { url: await this.storage.signDownload(doc.objectKey, seconds), expires_at: new Date(now.getTime() + seconds * 1000) };
    });
  }

  async fail(jobId, token, errorCode, requestedRetryable) {
    return guarded(async () => {
      if (!Object.hasOwn(indexingFailures, errorCode)) {
        throw new DocumentError(400, 'invalid_indexing_error', 'Use a supported indexing error code.');
      }
      const now = this.clock();
      const { repository } = await this.locate(jobId);
      const doc = await repository.lease(jobId, token, now);
      if (!doc) {
        const current = await repository.getJob(jobId);
        if (current?.indexing.lastFailureTokenHash === leaseHash(token)
            && current.indexing.lastFailureCode === errorCode
            && current.indexing.lastFailureRetryable === requestedRetryable) {
          return { job_id: jobId, disposition: 'duplicate' };
        }
        return { job_id: jobId, disposition: 'stale' };
      }
      const failure = indexingFailures[errorCode];
      const retry = requestedRetryable && failure.retryable && doc.indexing.attempts < doc.indexing.maxAttempts;
      const updated = await repository.fail(jobId, token, now, {
        status: retry ? 'queued' : 'failed',
        availableAt: new Date(now.getTime() + INDEXING_RETRY_BASE_MS * 2 ** (doc.indexing.attempts - 1)),
        error: { code: errorCode, message: failure.message },
        lastFailureTokenHash: leaseHash(token), lastFailureCode: errorCode, lastFailureRetryable: requestedRetryable,
      });
      return { job_id: jobId, disposition: updated ? 'applied' : 'stale' };
    });
  }
  async passages(body) {
    return guarded(() => new CanonicalPassages({ resolver: new StudyScopeResolver({ profile: this.profile }) }).fetch(body));
  }

  async complete(jobId, body) {
    return guarded(async () => {
      const { repository, doc } = await this.locate(jobId);
      const ack = disposition => ({ job_id: jobId, document_id: body.report?.document_id || '', source_version: body.report?.source_version || '', disposition });
      if (!doc || body.generation_id !== doc.indexing.generationId || body.report?.source_version !== doc.sourceVersion) { return ack('stale'); }
      const values = validatePublication(body, doc, repository.sourceType || 'document');
      if (doc.indexing.status === 'ready' && doc.indexing.completionTokenHash === leaseHash(body.lease_token)
          && doc.indexing.manifestDigest === values.manifestDigest && doc.indexing.activeGeneration === body.generation_id) { return ack('duplicate'); }
      if (this.profile) {
        const profile = await this.profile();
        if (profile.embedding_model !== body.report.embedding_model || profile.index_version !== body.report.index_version) {
          throw new DocumentError(409, 'index_model_mismatch', 'The active embedding configuration changed.');
        }
      }
      const updated = await repository.complete(jobId, body.lease_token, this.clock(), {
        ...values, completionTokenHash: leaseHash(body.lease_token),
      });
      return ack(updated ? 'applied' : 'stale');
    });
  }

}

export const createDocumentJobService = (sourceType = 'document') => new DocumentJobService({
  repository: new DocumentJobRepository(sourceType === 'note' ? Note : Document),
  notesRepository: sourceType === 'document' ? new DocumentJobRepository(Note) : undefined,
  storage: new R2Storage(settings.r2),
  profile: () => new AiPdfClient({ baseUrl: settings.aiServiceUrl, token: settings.aiServiceToken }).request('/internal/retrieval/profile'),
});
