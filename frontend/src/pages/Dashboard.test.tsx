import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Dashboard } from './Dashboard';

describe('dashboard study entry points', () => {
  it('returns to the latest note and starts a review without changing the existing study routes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ courses: [], books: [], notes: [{ _id: 'my-latest-note', title: 'An idea worth revisiting', content: 'A connection I want to remember.' }], flashcardsCount: 3 }))));
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(await screen.findByRole('link', { name: /Your latest note/ })).toHaveAttribute('href', '/notes/my-latest-note');
    expect(screen.getByRole('link', { name: 'Start a review' })).toHaveAttribute('href', '/flashcards/list?review=1');
    expect(screen.getByRole('link', { name: 'Start a quiz' })).toHaveAttribute('href', '/flashcards/quiz');
  });
  it('keeps an empty library useful with writing and flashcard creation entry points', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ courses: [], books: [], notes: [], flashcardsCount: 0 }))));
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(await screen.findByRole('link', { name: 'Write a note' })).toHaveAttribute('href', '/notes/add');
    expect(screen.queryByRole('link', { name: /Your latest note/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Create a flashcard' })).toHaveAttribute('href', '/flashcards/new');
  });
});
