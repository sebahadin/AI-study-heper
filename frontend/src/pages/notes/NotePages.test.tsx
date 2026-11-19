import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { NoteDetail, NoteEditor } from './NotePages';

const saved = { _id: 'note-one', title: 'Old title', content: 'Formatted thought', contentHtml: '<p><strong>Formatted</strong> thought</p>', book: null };
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input) => new Response(JSON.stringify(String(input) === '/api/books' ? { books: [] } : { note: saved }), { status: 200 })));
});
function mount(path: string) {
  render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/notes/add" element={<NoteEditor />} /><Route path="/notes/:id/edit" element={<NoteEditor />} /><Route path="/notes/:id" element={<NoteDetail />} /></Routes></MemoryRouter>);
}
describe('note reading and editing', () => {
  it('preserves unsaved changes when switching between Edit and Read preview', async () => {
    const user = userEvent.setup();
    mount('/notes/note-one/edit');
    const title = await screen.findByRole('textbox', { name: 'Note title' });
    await user.clear(title); await user.type(title, 'A better title');
    const mode = screen.getByRole('group', { name: 'Note mode' });
    await user.click(within(mode).getByRole('button', { name: 'Read' }));
    const preview = screen.getByRole('article', { name: 'Note reading preview' });
    expect(within(preview).getByRole('heading', { name: 'A better title' })).toBeVisible();
    expect(within(preview.querySelector('.note-reading-content') as HTMLElement).getByText('Formatted').tagName).toBe('STRONG');
    expect(screen.queryByRole('group', { name: 'Text formatting' })).toBeNull();
    await user.click(within(mode).getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('textbox', { name: 'Note title' })).toHaveValue('A better title');
    expect(screen.getByRole('textbox', { name: 'Note content' })).toHaveTextContent('Formatted thought');
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');
  });
  it('prevents saving a blank new note and provides useful validation', async () => {
    const user = userEvent.setup(); mount('/notes/add');
    await screen.findByRole('heading', { name: 'Add a note' });
    await user.click(screen.getByRole('button', { name: 'Save note' }));
    expect(screen.getByText('Give your note a title.')).toBeVisible();
    expect(screen.getByText('Write something in your note before saving.')).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Note content' })).toHaveAttribute('aria-invalid', 'true');
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
  });
  it('opens saved notes in read mode and provides a direct edit action', async () => {
    mount('/notes/note-one');
    await screen.findByRole('heading', { name: 'Old title' });
    expect(screen.getByText('Formatted').tagName).toBe('STRONG');
    expect(screen.getByRole('link', { name: 'Edit note' })).toHaveAttribute('href', '/notes/note-one/edit');
    expect(screen.queryByRole('textbox', { name: 'Note content' })).toBeNull();
  });
});
