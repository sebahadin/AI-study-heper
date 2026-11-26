import type { DocumentOptions, DocumentPolicy, DocumentUploadIntent, StudyDocument } from '../types';
import { ApiError } from './api';

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MiB`;
}

export function pdfSelectionError(file: File, policy: DocumentPolicy) {
  if (!/\.pdf$/i.test(file.name)) return 'Choose a PDF file.';
  if (!file.size) return 'This file is empty. Choose another PDF.';
  if (file.size > policy.maxBytes) return `Choose a PDF smaller than ${fileSize(policy.maxBytes)}.`;
  if (file.name.length > 255 || /[/\\\p{Cc}]/u.test(file.name)) return 'Use a PDF filename without path characters, up to 255 characters.';
  return '';
}

export function documentCourses(document: Pick<StudyDocument, 'courses' | 'book' | 'note'>, options?: DocumentOptions | null) {
  if (!options) return [];
  const note = options.notes.find(item => item._id === document.note);
  const books = options.books.filter(item => item._id === document.book || item._id === note?.book);
  const ids = new Set([...document.courses, ...(note?.courses || []), ...books.flatMap(item => (item.courses || []).map(course => typeof course === 'string' ? course : course._id))]);
  return options.courses.filter(course => ids.has(course._id));
}

export const documentStatus = (status: StudyDocument['status']) => ({
  uploaded: 'Saved', awaiting_upload: 'Upload unfinished', validating: 'Checking PDF',
  failed: 'Needs attention', deleting: 'Removal pending',
})[status];

export function documentQuery(params: URLSearchParams) {
  const query = new URLSearchParams();
  for (const name of ['course', 'book', 'note', 'q', 'status']) {
    const value = params.get(name);
    if (value) query.set(name, value);
  }
  return query.toString();
}

export function uploadPdf(intent: DocumentUploadIntent, file: File, signal: AbortSignal, progress: (percent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Upload stopped.', 'AbortError')); return; }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const clean = () => signal.removeEventListener('abort', abort);
    xhr.open('PUT', intent.upload.url);
    xhr.withCredentials = false;
    xhr.timeout = 120000;
    // The browser supplies Content-Length. No app/service credentials go to R2.
    xhr.setRequestHeader('Content-Type', intent.upload.headers['Content-Type']);
    xhr.upload.onprogress = event => { if (event.lengthComputable) progress(Math.min(100, Math.round(event.loaded / event.total * 100))); };
    xhr.onload = () => {
      clean();
      if (xhr.status >= 200 && xhr.status < 300) { progress(100); resolve(); }
      else reject(new ApiError(xhr.status === 403 ? 'The upload link expired or was denied. Start a new upload.' : 'The PDF upload did not finish. Try again.', xhr.status, {}, 'upload_failed'));
    };
    xhr.onerror = xhr.ontimeout = () => { clean(); reject(new ApiError('The upload was interrupted. Check your connection and retry.', 0, {}, 'upload_interrupted')); };
    xhr.onabort = () => { clean(); reject(new DOMException('Upload stopped.', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    xhr.send(file);
  });
}
