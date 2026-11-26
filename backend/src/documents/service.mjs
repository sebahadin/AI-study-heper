import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { Book, Note } from '../db.mjs';
import { courseFields } from '../course-materials.mjs';
import { DocumentError } from './errors.mjs';
import { documentFilter, documentOptions } from './filters.mjs';

export const UPLOAD_URL_SECONDS = 300;
export const FINALIZE_GRACE_MS = 15 * 60 * 1000;
export const VALIDATION_LEASE_MS = 2 * 60 * 1000;
const DOCUMENT_PAGE_SIZE = 50;
const notFound = () => new DocumentError(404, 'document_not_found', 'Document not found.');

function uploadFields(body) {
  const allowed = ['title', 'filename', 'byteCount', 'courses', 'book', 'note'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) {
    throw new DocumentError(400, 'invalid_upload', 'Check the upload fields.');
  }
  const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
  if (!filename || filename.length > 255 || /[/\\\p{Cc}]/u.test(filename) || !/\.pdf$/i.test(filename)) {
    throw new DocumentError(400, 'invalid_filename', 'Choose a PDF filename without path characters.');
  }
  const title = body.title === undefined ? filename.replace(/\.pdf$/i, '') : body.title;
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 200) {
    throw new DocumentError(400, 'invalid_title', 'Enter a title of at most 200 characters.');
  }
  if (!Number.isSafeInteger(body.byteCount) || body.byteCount < 1) {
    throw new DocumentError(400, 'invalid_size', 'Provide the PDF file size in bytes.');
  }
  return { ...body, filename, title: title.trim() };
}

export async function resolveDocumentAssociations(body, user) {
  const fields = await courseFields(body, user);
  for (const [field, model] of [['book', Book], ['note', Note]]) {
    const id = body[field] ?? null;
    if (id !== null && (typeof id !== 'string' || !mongoose.isObjectIdOrHexString(id) || !await model.exists({ _id: id, user }))) {
      throw new DocumentError(400, 'invalid_association', 'Choose only materials from your workspace.');
    }
    fields[field] = id;
  }
  return fields;
}

export function publicDocument(document) {
  return {
    _id: String(document._id), title: document.title, filename: document.filename,
    status: document.status, courses: (document.courses || []).map(String),
    book: document.book ? String(document.book) : null, note: document.note ? String(document.note) : null,
    byteCount: document.byteCount ?? null, pageCount: document.pageCount ?? null,
    sourceVersion: document.sourceVersion ?? null, error: document.error ?? null,
    uploadExpiresAt: document.uploadExpiresAt, createdAt: document.createdAt, updatedAt: document.updatedAt,
  };
}

export class DocumentService {
  constructor({ repository, storage, inspector, associations = resolveDocumentAssociations, clock = () => new Date() }) {
    Object.assign(this, { repository, storage, inspector, associations, clock });
  }

  async policy() { return this.inspector.policy(); }
  async options(user) { return documentOptions(user); }
  async list(user, before, query = {}) {
    if (before !== undefined && (typeof before !== 'string' || !mongoose.isObjectIdOrHexString(before))) {
      throw new DocumentError(400, 'invalid_cursor', 'Invalid document page cursor.');
    }
    const filter = await documentFilter(user, query);
    const rows = await this.repository.list(user, before, DOCUMENT_PAGE_SIZE + 1, filter);
    const page = rows.slice(0, DOCUMENT_PAGE_SIZE);
    return {
      documents: page.map(publicDocument),
      nextCursor: rows.length > DOCUMENT_PAGE_SIZE ? String(page.at(-1)._id) : null,
    };
  }
  async get(user, id) {
    const document = await this.repository.get(user, id);
    if (!document) { throw notFound(); }
    return publicDocument(document);
  }

  async file(user, id) {
    const document = await this.repository.get(user, id);
    if (!document) { throw notFound(); }
    if (document.status !== 'uploaded' || !document.objectKey) {
      throw new DocumentError(409, 'document_unavailable', 'This PDF is not available to read yet.');
    }
    return this.storage.signDownload(document.objectKey, 60);
  }

  async remove(user, id) {
    // Revoke access/validation first; failed cleanup remains visible and retryable.
    const document = await this.repository.markDeleting(user, id);
    if (!document) { throw notFound(); }
    for (const key of new Set([document.uploadKey, document.objectKey].filter(Boolean))) {
      await this.storage.remove(key);
    }
    await this.repository.remove(user, id);
  }

  async begin(user, body) {
    const fields = uploadFields(body);
    const associations = await this.associations(fields, user);
    const policy = await this.policy();
    if (fields.byteCount > policy.maxBytes) {
      throw new DocumentError(413, 'pdf_too_large', 'The PDF exceeds the file-size limit.');
    }
    const id = new mongoose.Types.ObjectId();
    const uploadKey = `pending/${user}/${id}/${randomUUID()}.pdf`;
    const now = this.clock();
    const uploadExpiresAt = new Date(now.getTime() + UPLOAD_URL_SECONDS * 1000);
    const url = await this.storage.signUpload(uploadKey, fields.byteCount, UPLOAD_URL_SECONDS);
    const document = await this.repository.create({
      _id: id, user, title: fields.title, filename: fields.filename, ...associations,
      expectedBytes: fields.byteCount, maxBytes: policy.maxBytes,
      status: 'awaiting_upload', uploadKey, uploadExpiresAt,
      finalizeUntil: new Date(uploadExpiresAt.getTime() + FINALIZE_GRACE_MS),
    });
    return {
      document: publicDocument(document), policy,
      upload: { url, method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, expiresAt: uploadExpiresAt },
    };
  }

  async complete(user, id) {
    const token = randomUUID();
    const now = this.clock();
    const document = await this.repository.claim(user, id, token, now, new Date(now.getTime() + VALIDATION_LEASE_MS));
    if (!document) {
      const current = await this.repository.get(user, id);
      if (!current) { throw notFound(); }
      if (current.status === 'uploaded') { return publicDocument(current); }
      if (current.status === 'failed') {
        throw new DocumentError(422, current.error.code, current.error.message);
      }
      if (current.status === 'validating' && current.validationLeaseUntil > now) {
        throw new DocumentError(409, 'validation_in_progress', 'This document is already being validated.');
      }
      if (current.finalizeUntil < now) {
        throw new DocumentError(410, 'upload_expired', 'This upload expired. Start a new upload.');
      }
      throw new DocumentError(409, 'upload_conflict', 'The document changed. Refresh and try again.');
    }

    const objectKey = `documents/${user}/${id}/${token}.pdf`;
    let snapshotWritten = false;
    try {
      const currentPolicy = await this.policy();
      const policy = { ...currentPolicy, maxBytes: Math.min(currentPolicy.maxBytes, document.maxBytes) };
      const data = await this.storage.download(document.uploadKey, {
        maxBytes: policy.maxBytes, expectedBytes: document.expectedBytes,
      });
      const inspection = await this.inspector.inspect(data, policy);
      // Write exactly the bytes that were inspected, rather than copying a mutable upload object.
      await this.storage.putValidated(objectKey, data);
      snapshotWritten = true;
      const updated = await this.repository.finalize(user, id, token, {
        objectKey, sourceVersion: randomUUID(), ...inspection,
      });
      if (!updated) {
        await this.storage.remove(objectKey).catch(() => {});
        throw new DocumentError(409, 'upload_conflict', 'The document changed. Refresh and try again.');
      }
      await this.storage.remove(document.uploadKey).catch(() => {});
      return publicDocument(updated);
    } catch (error) {
      if (!snapshotWritten) {
        const safe = error instanceof DocumentError ? error : new DocumentError(503, 'upload_unavailable', 'Upload confirmation is temporarily unavailable.');
        const terminal = [400, 413, 415, 422].includes(safe.status);
        await this.repository.release(user, id, token, safe, terminal).catch(() => {});
        throw safe;
      }
      // A database timeout may mean the write committed but its acknowledgement
      // was lost. Keep the snapshot; deleting it could destroy a committed source.
      if (error instanceof DocumentError) { throw error; }
      throw new DocumentError(503, 'upload_unavailable', 'Upload confirmation is temporarily unavailable.');
    }
  }
}
