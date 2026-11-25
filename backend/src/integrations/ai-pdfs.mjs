import { createHash, randomUUID } from 'node:crypto';
import { DocumentError } from '../documents/errors.mjs';
import { readBoundedBody } from './bounded-body.mjs';

const unavailable = () => new DocumentError(503, 'validation_unavailable', 'PDF validation is temporarily unavailable.');
const pdfErrors = {
  invalid_pdf: 'Upload a valid PDF file.',
  empty_pdf: 'The PDF must contain at least one page.',
  encrypted_pdf: 'Upload an unencrypted PDF file.',
  pdf_page_limit_exceeded: 'The PDF exceeds the allowed page limit.',
  pdf_too_large: 'The PDF exceeds the file-size limit.',
};

export class AiPdfClient {
  constructor({ baseUrl, token, fetchImpl = fetch }) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async request(path, data) {
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(this.token || '')) { throw unavailable(); }
    let url;
    try {
      url = new URL(path, this.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) { throw unavailable(); }
    } catch { throw unavailable(); }
    let response;
    let result;
    try {
      response = await this.fetchImpl(url, {
        method: data ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`, 'X-Request-ID': randomUUID(),
          ...(data && { 'Content-Type': 'application/pdf' }),
        },
        ...(data && { body: data }),
        signal: AbortSignal.timeout(20000), redirect: 'error',
      });
      result = JSON.parse((await readBoundedBody(response.body, 16384)).toString('utf8'));
    } catch { throw unavailable(); }
    if (!response.ok) {
      const code = result?.error?.code;
      if ([413, 422].includes(response.status) && Object.hasOwn(pdfErrors, code)) {
        throw new DocumentError(response.status, code, pdfErrors[code]);
      }
      throw unavailable();
    }
    return result;
  }

  async policy() {
    const policy = await this.request('/internal/pdfs/policy');
    if (!Number.isSafeInteger(policy?.max_pages) || policy.max_pages < 1 ||
        !Number.isSafeInteger(policy?.max_bytes) || policy.max_bytes < 1) { throw unavailable(); }
    return { maxPages: policy.max_pages, maxBytes: policy.max_bytes };
  }

  async inspect(data, policy) {
    const result = await this.request('/internal/pdfs/inspect', data);
    if (!Number.isSafeInteger(result?.page_count) || result.page_count < 1 || result.page_count > policy.maxPages ||
        result.byte_count !== data.length || result.byte_count > policy.maxBytes ||
        result.sha256 !== createHash('sha256').update(data).digest('hex')) { throw unavailable(); }
    return { pageCount: result.page_count, byteCount: result.byte_count, sha256: result.sha256 };
  }
}
