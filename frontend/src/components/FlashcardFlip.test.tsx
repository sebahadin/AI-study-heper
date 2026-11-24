import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FlashcardFlip } from './FlashcardFlip';

const card = { question: 'What is a closure?', options: ['A function with access to its creation scope', 'A database'], correctIndex: 0 };
describe('flippable flashcards', () => {
  it('reveals only the correct answer and flips back to the question', async () => {
    const user = userEvent.setup(); render(<FlashcardFlip card={card} />);
    expect(screen.getByRole('heading', { name: card.question })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Correct answer' })).toBeNull();
    const control = screen.getByRole('button', { name: `Reveal answer: ${card.question}` });
    expect(control).toHaveAttribute('aria-expanded', 'false');
    await user.click(control);
    expect(screen.getByRole('region', { name: 'Correct answer' })).toHaveTextContent(card.options[0]);
    expect(screen.queryByRole('heading', { name: card.question })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(`Correct answer: ${card.options[0]}`);
    await user.click(screen.getByRole('button', { name: `Show question: ${card.question}` }));
    expect(screen.getByRole('heading', { name: card.question })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Correct answer' })).toBeNull();
  });
  it('supports Space and Enter with a stable keyboard focus', async () => {
    const user = userEvent.setup(); render(<FlashcardFlip card={card} />);
    await user.tab();
    const control = screen.getByRole('button'); expect(control).toHaveFocus();
    await user.keyboard(' '); expect(control).toHaveAttribute('aria-expanded', 'true'); expect(control).toHaveFocus();
    await user.keyboard('{Enter}'); expect(control).toHaveAttribute('aria-expanded', 'false'); expect(control).toHaveFocus();
  });
  it('renders stored markup as text and handles an old card without a valid answer', async () => {
    const user = userEvent.setup();
    const { container } = render(<FlashcardFlip card={{ question: '<img src=x onerror=alert(1)>', options: ['<strong>Literal text</strong>'], correctIndex: 9 }} />);
    expect(container.querySelector('img')).toBeNull();
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('region', { name: 'Correct answer' })).toHaveTextContent('Edit this card to choose an answer.');
  });
});
