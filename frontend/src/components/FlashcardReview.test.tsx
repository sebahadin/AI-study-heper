import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { FlashcardReview } from './FlashcardReview';

const cards = [
  { _id: 'one', question: 'First question?', options: ['First answer', 'Other'], correctIndex: 0, tags: [] },
  { _id: 'two', question: 'Second question?', options: ['Other', 'Second answer'], correctIndex: 1, tags: [] },
];
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; this.dispatchEvent(new Event('close')); } });
});
describe('focused flashcard review', () => {
  it('reviews one card at a time, resets the face between cards, and can start again', async () => {
    const user = userEvent.setup(); render(<MemoryRouter><FlashcardReview cards={cards} quizTo="/flashcards/quiz?course=one" onClose={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'First question?' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Second question?' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Reveal answer: First question?' }));
    expect(screen.getByRole('region', { name: 'Correct answer' })).toHaveTextContent('First answer');
    await user.click(screen.getByRole('button', { name: 'Next card' }));
    expect(screen.getByRole('heading', { name: 'Second question?' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reveal answer: Second question?' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Reveal answer: Second question?' }));
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByRole('button', { name: 'Reveal answer: First question?' })).toHaveFocus();
    expect(screen.queryByRole('region', { name: 'Correct answer' })).toBeNull();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Reveal answer: Second question?' })).toHaveFocus();
    expect(screen.queryByRole('region', { name: 'Correct answer' })).toBeNull();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '2');
    await user.click(screen.getByRole('button', { name: 'Finish review' }));
    expect(screen.getByRole('heading', { name: 'End of the deck' })).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Take a quiz' })).toHaveAttribute('href', '/flashcards/quiz?course=one');
    await user.click(screen.getByRole('button', { name: 'Review again' }));
    expect(screen.getByRole('heading', { name: 'First question?' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reveal answer: First question?' })).toHaveFocus();
  });
  it('supports arrow keys and shuffling without changing the deck size', async () => {
    const user = userEvent.setup(); render(<MemoryRouter><FlashcardReview cards={cards} quizTo="/flashcards/quiz" onClose={vi.fn()} /></MemoryRouter>);
    await user.keyboard('{ArrowRight}'); expect(screen.getByRole('heading', { name: 'Second question?' })).toBeVisible();
    await user.keyboard('{ArrowLeft}'); expect(screen.getByRole('heading', { name: 'First question?' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Shuffle cards' }));
    expect(screen.getByText('Card 1 of 2')).toBeVisible(); expect(screen.getByRole('progressbar')).toHaveAttribute('max', '2');
    expect(screen.getAllByRole('button', { name: /^Reveal answer:/ })).toHaveLength(1);
  });
});
