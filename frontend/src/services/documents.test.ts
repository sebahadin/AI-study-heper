import { beforeEach, describe, expect, it, vi } from 'vitest';
import { documentCourses, pdfSelectionError, uploadPdf } from './documents';
import type { DocumentUploadIntent } from '../types';

export class FakeXHR {
  static requests: FakeXHR[] = [];
  static auto = true;
  status = 0; timeout = 0; withCredentials = true;
  headers: Record<string, string> = {};
  method = ''; url = ''; file?: File;
  upload = { onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() { FakeXHR.requests.push(this); }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(file: File) { this.file = file; if (FakeXHR.auto) queueMicrotask(() => this.succeed()); }
  succeed() { this.status = 200; this.upload.onprogress?.({ lengthComputable: true, loaded: this.file!.size, total: this.file!.size }); this.onload?.(); }
  abort() { this.onabort?.(); }
}

const intent = { upload: { url: 'https://private.example/signed-put', method: 'PUT', headers: { 'Content-Type': 'application/pdf' } } } as DocumentUploadIntent;
beforeEach(() => { FakeXHR.requests = []; FakeXHR.auto = true; vi.stubGlobal('XMLHttpRequest', FakeXHR); });
describe('document upload boundaries', () => {
  it('checks file type, empty files and effective size before an upload', () => {
    const policy = { maxPages: 5, maxBytes: 10 };
    expect(pdfSelectionError(new File(['pdf'], 'lecture.pdf'), policy)).toBe('');
    expect(pdfSelectionError(new File(['text'], 'note.txt'), policy)).toMatch(/PDF/);
    expect(pdfSelectionError(new File([], 'empty.pdf'), policy)).toMatch(/empty/);
    expect(pdfSelectionError(new File(['x'.repeat(11)], 'large.pdf'), policy)).toMatch(/smaller/);
  });
  it('sends the file directly without app credentials or a manually assigned content length', async () => {
    const file = new File(['real PDF bytes'], 'lecture.pdf');
    const progress = vi.fn();
    await uploadPdf(intent, file, new AbortController().signal, progress);
    const request = FakeXHR.requests[0];
    expect(request.method).toBe('PUT'); expect(request.url).toBe(intent.upload.url);
    expect(request.file).toBe(file); expect(request.withCredentials).toBe(false);
    expect(request.headers).toEqual({ 'Content-Type': 'application/pdf' });
    expect(progress).toHaveBeenLastCalledWith(100);
  });
  it('aborts an in-flight transfer', async () => {
    FakeXHR.auto = false;
    const controller = new AbortController();
    const pending = uploadPdf(intent, new File(['PDF'], 'file.pdf'), controller.signal, vi.fn());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('does not expose raw object-store error payloads for denied uploads', async () => {
    FakeXHR.auto = false;
    const pending = uploadPdf(intent, new File(['PDF'], 'file.pdf'), new AbortController().signal, vi.fn());
    FakeXHR.requests[0].status = 403; FakeXHR.requests[0].onload?.();
    await expect(pending).rejects.toMatchObject({ status: 403, code: 'upload_failed' });
  });
  it('resolves inherited course labels only from current owned material options', () => {
    const courses = documentCourses({ courses: ['removed-course'], book: null, note: 'note' }, {
      courses: [{ _id: 'biology', title: 'Biology' }],
      books: [{ _id: 'book', title: 'Textbook', courses: ['biology'] }],
      notes: [{ _id: 'note', title: 'Lecture', courses: [], book: 'book' }],
    });
    expect(courses.map(course => course._id)).toEqual(['biology']);
  });
});
