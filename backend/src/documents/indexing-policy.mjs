import { createHash, randomUUID } from 'node:crypto';

export const INDEXING_LEASE_MS = 2 * 60 * 1000;
export const INDEXING_MAX_ATTEMPTS = 3;
export const INDEXING_RETRY_BASE_MS = 5000;
export const INDEXING_SOURCE_URL_SECONDS = 60;

export const indexingFailures = Object.freeze({
  pdf_text_unavailable: { message: 'This PDF has no extractable text. OCR is not supported yet.', retryable: false },
  invalid_pdf: { message: 'Text could not be read from this PDF.', retryable: false },
  pdf_text_extraction_failed: { message: 'Text could not be extracted from this PDF.', retryable: false },
  pdf_page_limit_exceeded: { message: 'The PDF exceeds the current page limit.', retryable: false },
  pdf_too_large: { message: 'The PDF exceeds the current size limit.', retryable: false },
  pdf_text_limit_exceeded: { message: 'The PDF contains too much text to process.', retryable: false },
  pdf_content_limit_exceeded: { message: 'The PDF is too complex to process.', retryable: false },
  pdf_chunk_limit_exceeded: { message: 'The PDF produces too many passages to process.', retryable: false },
  source_snapshot_mismatch: { message: 'The saved PDF snapshot could not be verified.', retryable: false },
  source_unavailable: { message: 'The saved PDF is no longer available for indexing.', retryable: false },
  storage_unavailable: { message: 'File storage is temporarily unavailable.', retryable: true },
  embedding_unavailable: { message: 'Local embeddings are temporarily unavailable.', retryable: true },
  index_unavailable: { message: 'The retrieval index is temporarily unavailable.', retryable: true },
  index_incomplete: { message: 'Not every expected passage could be verified.', retryable: true },
  indexing_failed: { message: 'This PDF could not be indexed.', retryable: false },
  worker_timeout: { message: 'Indexing stopped after the worker did not respond.', retryable: false },
});

export function createIndexingJob(user, sourceVersion, now) {
  return {
    jobId: randomUUID(), user, sourceVersion, status: 'queued', attempts: 0,
    maxAttempts: INDEXING_MAX_ATTEMPTS, availableAt: now, updatedAt: now,
    leaseToken: null, leaseUntil: null, error: null,
  };
}

export const leaseHash = token => createHash('sha256').update(token).digest('hex');

export function publicIndexing(document, sourceType = document.filename ? 'document' : 'note') {
  if ((sourceType === 'document' && document.status !== 'uploaded') || document.deletedAt) {
    return { status: document.status === 'deleting' ? 'cancelled' : 'not_available', error: null, updatedAt: document.updatedAt };
  }
  const job = document.indexing;
  if (!job || String(job.user) !== String(document.user) || job.sourceVersion !== document.sourceVersion) {
    return { status: 'not_requested', error: null, updatedAt: document.updatedAt };
  }
  return { status: job.status, error: job.error || null, updatedAt: job.updatedAt, pagesWithoutText: job.pagesWithoutText || [] };
}
