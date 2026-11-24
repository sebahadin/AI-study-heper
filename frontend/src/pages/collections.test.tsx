import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { BookList } from './books/BookList';
import { NoteList } from './notes/NoteList';
import { FlashcardList } from './flashcards/FlashcardPages';

const books = [
  { _id: 'book-one', title: 'JavaScript Essentials', author: 'Alex', category: 'Programming' },
  { _id: 'book-two', title: 'How to Study', author: 'Taylor', category: 'Study skills' },
];
const notes = [
  { _id: 'note-one', title: 'Closure practice', content: 'A function keeps access to lexical scope.', book: books[0] },
  { _id: 'note-two', title: 'Weekly ideas', content: 'Plan a spaced review session.', book: null },
];
const flashcards = [
  { _id: 'card-one', question: 'What is a closure?', options: ['Lexical scope', 'A database'], correctIndex: 0, tags: [books[0]] },
  { _id: 'card-two', question: 'How do you review?', options: ['Active recall', 'Guess'], correctIndex: 0, tags: [books[1]] },
];
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input) => new Response(JSON.stringify(String(input) === '/api/books' ? { books } : String(input) === '/api/notes' ? { notes } : { flashcards }), { status: 200 })));
});
describe('organized collections', () => {
  it('searches books by author and filters by category', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><BookList /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'JavaScript Essentials' });
    await user.type(screen.getByRole('searchbox', { name: 'Search books' }), 'taylor');
    expect(screen.queryByRole('heading', { name: 'JavaScript Essentials' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'How to Study' })).toBeVisible();
    await user.clear(screen.getByRole('searchbox', { name: 'Search books' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by category' }), 'Programming');
    expect(screen.getByRole('heading', { name: 'JavaScript Essentials' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'How to Study' })).toBeNull();
  });
  it('finds notes by content and exposes standalone notes and the editor', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><NoteList /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Closure practice' });
    expect(screen.getByRole('link', { name: 'Write a note' })).toHaveAttribute('href', '/notes/add');
    await user.type(screen.getByRole('searchbox', { name: 'Search notes' }), 'lexical');
    expect(screen.getByRole('heading', { name: 'Closure practice' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Weekly ideas' })).toBeNull();
    await user.clear(screen.getByRole('searchbox', { name: 'Search notes' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter notes by book' }), 'standalone');
    expect(screen.getByRole('heading', { name: 'Weekly ideas' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Closure practice' })).toBeNull();
  });
  it('filters flashcards by book and reveals the correct answer', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FlashcardList /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'What is a closure?' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter flashcards by book' }), 'book-one');
    expect(screen.queryByRole('heading', { name: 'How do you review?' })).toBeNull();
    const card = screen.getByRole('article');
    await user.click(within(card).getByRole('button', { name: 'Reveal answer: What is a closure?' }));
    expect(within(card).getByRole('region', { name: 'Correct answer' })).toHaveTextContent('Lexical scope');
  });
  it('lets people recover from an empty search result', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><NoteList /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Closure practice' });
    await user.type(screen.getByRole('searchbox', { name: 'Search notes' }), 'no matching notes');
    expect(screen.getByRole('heading', { name: 'No matching notes' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('heading', { name: 'Closure practice' })).toBeVisible();
  });
});
