import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DocumentLibrary } from './DocumentLibrary';
import { DocumentUpload } from './DocumentUpload';
import { DocumentDetail } from './DocumentDetail';
import type { StudyDocument } from '../../types';

class UploadXHR {
  static calls = 0;
  status = 200; timeout = 0; withCredentials = false;
  upload = { onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
  onload: (() => void) | null = null;
  open() {} setRequestHeader() {}
  send(file: File) { UploadXHR.calls++; queueMicrotask(() => { this.upload.onprogress?.({ lengthComputable: true, loaded: file.size, total: file.size }); this.onload?.(); }); }
  abort() {}
}
const course = { _id: 'course', title: 'Biology', code: 'BIO 101', color: 'mint' };
const options = { courses: [course], books: [{ _id: 'book', title: 'Biology textbook', courses: ['course'] }], notes: [{ _id: 'note', title: 'Cell notes', book: 'book', courses: [] }] };
const saved: StudyDocument = {
  _id: 'pdf-one', title: 'Cell biology handout', filename: 'cells.pdf', status: 'uploaded', courses: ['course'],
  book: 'book', note: 'note', byteCount: 2048, pageCount: 3, sourceVersion: 'v1', error: null,
  uploadExpiresAt: new Date(Date.now() + 300000).toISOString(), createdAt: '2026-11-25T12:00:00Z', updatedAt: '2026-11-25T12:00:00Z',
};
let failures = 0;
let terminal = false;

beforeEach(() => {
  UploadXHR.calls = 0; failures = 0; terminal = false;
  vi.stubGlobal('XMLHttpRequest', UploadXHR);
  vi.stubGlobal('fetch', vi.fn(async (input, init) => {
    const path = String(input);
    if (path === '/api/documents/options') return Response.json(options);
    if (path === '/api/documents/policy') return Response.json({ policy: { maxPages: 5, maxBytes: 10485760 } });
    if (path === '/api/documents/uploads') return Response.json({ document: { ...saved, status: 'awaiting_upload' }, policy: { maxPages: 5, maxBytes: 10485760 }, upload: { url: 'https://private.example/signed', method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, expiresAt: new Date(Date.now() + 300000).toISOString() } }, { status: 201 });
    if (path.endsWith('/complete')) {
      if (terminal) return Response.json({ error: 'The PDF exceeds the allowed page limit.', code: 'pdf_page_limit_exceeded' }, { status: 422 });
      if (failures-- > 0) return Response.json({ error: 'Validation is temporarily unavailable.', code: 'validation_unavailable' }, { status: 503 });
      return Response.json({ document: saved });
    }
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    if (path === '/api/documents/pdf-one') return Response.json({ document: saved });
    const url = new URL(path, 'http://test');
    const query = url.searchParams.get('q');
    return Response.json({ documents: !query || saved.title.toLowerCase().includes(query.toLowerCase()) ? [saved] : [], nextCursor: null });
  }));
});

function app(path: string) {
  return <MemoryRouter initialEntries={[path]}><Routes><Route path="/documents" element={<DocumentLibrary />} /><Route path="/documents/upload" element={<DocumentUpload />} /><Route path="/documents/:id" element={<DocumentDetail />} /></Routes></MemoryRouter>;
}

describe('PDF library and upload experience', () => {
  it('loads saved PDFs with original-file links and searches the whole library through Express', async () => {
    const user = userEvent.setup(); render(app('/documents'));
    expect(await screen.findByRole('heading', { name: saved.title })).toBeVisible();
    expect(screen.getByRole('link', { name: /Open PDF.*Cell biology handout/ })).toHaveAttribute('href', '/api/documents/pdf-one/file');
    await user.type(screen.getByRole('searchbox'), 'unmatched');
    expect(await screen.findByRole('heading', { name: 'No matching PDFs' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByRole('heading', { name: saved.title })).toBeVisible();
  });
  it('uploads a PDF with course/book context and navigates to its saved detail page', async () => {
    const user = userEvent.setup(); render(app('/documents/upload?course=course&book=book'));
    const input = await screen.findByLabelText('PDF file');
    expect(screen.getByRole('checkbox', { name: /BIO 101.*Biology/ })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Related book' })).toHaveValue('book');
    await user.upload(input, new File(['PDF bytes'], 'cells.pdf', { type: 'application/pdf' }));
    await user.click(screen.getByRole('button', { name: 'Upload PDF' }));
    expect(await screen.findByRole('heading', { name: saved.title })).toBeVisible();
    expect(screen.getByRole('link', { name: /Open PDF/ })).toHaveAttribute('target', '_blank');
    const begin = vi.mocked(fetch).mock.calls.find(([path]) => path === '/api/documents/uploads');
    expect(JSON.parse(String(begin?.[1]?.body))).toMatchObject({ courses: ['course'], book: 'book', note: null, filename: 'cells.pdf' });
    expect(UploadXHR.calls).toBe(1);
  });
  it('retries confirmation using the same intent and already-uploaded bytes', async () => {
    failures = 1;
    const user = userEvent.setup(); render(app('/documents/upload'));
    await user.upload(await screen.findByLabelText('PDF file'), new File(['PDF bytes'], 'cells.pdf', { type: 'application/pdf' }));
    await user.click(screen.getByRole('button', { name: 'Upload PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Validation is temporarily unavailable.');
    await user.click(screen.getByRole('button', { name: 'Retry confirmation' }));
    expect(await screen.findByRole('heading', { name: saved.title })).toBeVisible();
    expect(UploadXHR.calls).toBe(1);
    expect(vi.mocked(fetch).mock.calls.filter(([path]) => path === '/api/documents/uploads')).toHaveLength(1);
  });
  it('requires a new attempt after a terminal page-limit rejection', async () => {
    terminal = true;
    const user = userEvent.setup(); render(app('/documents/upload'));
    await user.upload(await screen.findByLabelText('PDF file'), new File(['six pages'], 'six.pdf', { type: 'application/pdf' }));
    await user.click(screen.getByRole('button', { name: 'Upload PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('page limit');
    expect(screen.getByRole('button', { name: 'Retry confirmation' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start over' })).toBeVisible();
  });
  it('rejects oversized PDFs before requesting an upload URL', async () => {
    const user = userEvent.setup(); render(app('/documents/upload'));
    const file = new File(['small'], 'large.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'size', { value: 10485761 });
    await user.upload(await screen.findByLabelText('PDF file'), file);
    expect(await screen.findByRole('alert')).toHaveTextContent('smaller than 10 MiB');
    expect(vi.mocked(fetch).mock.calls.some(([path]) => path === '/api/documents/uploads')).toBe(false);
  });
  it('shows linked materials in the detail view without any stored signed URL', async () => {
    render(app('/documents/pdf-one'));
    expect(await screen.findByRole('heading', { name: saved.title })).toBeVisible();
    expect(await screen.findByRole('link', { name: /Related book.*Biology textbook/ })).toHaveAttribute('href', '/books/book');
    expect(screen.getByRole('link', { name: /Related note.*Cell notes/ })).toHaveAttribute('href', '/notes/note');
    expect(screen.queryByText(/signed/)).toBeNull();
  });
});
