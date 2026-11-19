import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QuizPage } from './QuizPage';

const question = 'What does <img src=x onerror=alert(1)> mean?';
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: string) => new Response(JSON.stringify(input === '/api/books'
    ? { books: [{ _id: 'book-one', title: 'Algorithms' }] }
    : { flashcards: [{ _id: 'card-one', question, options: ['Right', 'Wrong'], correctIndex: 0, tags: ['book-one'] }] }), { status: 200 })));
});
describe('quiz interactions', () => {
  it('requires tags, scores answers, reviews misses, and retries cleanly', async () => {
    const user = userEvent.setup();
    const { container } = render(<MemoryRouter><QuizPage /></MemoryRouter>);
    const book = await screen.findByLabelText('Algorithms');
    await user.click(screen.getByRole('button', { name: 'Start quiz' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Select at least one book tag');
    await user.click(book);
    await user.click(screen.getByRole('button', { name: 'Start quiz' }));
    expect(await screen.findByRole('heading', { name: question })).toBeVisible();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: 'See results' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Wrong' }));
    expect(screen.getByRole('button', { name: 'Right' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'See results' }));
    expect(screen.getByText('0 / 1')).toBeVisible();
    expect(screen.getByText('Your answer: Wrong')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retry same tags' }));
    expect(await screen.findByRole('button', { name: 'Right' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Right' }));
    await user.click(screen.getByRole('button', { name: 'See results' }));
    expect(screen.getByText('1 / 1')).toBeVisible();
    expect(screen.queryByText('Your answer: Wrong')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Choose different tags' }));
    expect(screen.getByLabelText('Algorithms')).toBeChecked();
  });
  it('shows a useful empty result when selected books have no questions', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => new Response(JSON.stringify(String(input) === '/api/books'
      ? { books: [{ _id: 'book-one', title: 'Algorithms' }] } : { flashcards: [] }), { status: 200 }));
    const user = userEvent.setup();
    render(<MemoryRouter><QuizPage /></MemoryRouter>);
    await user.click(await screen.findByLabelText('Algorithms'));
    await user.click(screen.getByRole('button', { name: 'Start quiz' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No flashcards found');
  });
});
