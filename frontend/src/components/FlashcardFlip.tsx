import { useId, useState } from 'react';
import type { Flashcard } from '../types';
import { Icon } from './Icon';

export function FlashcardFlip({ card, headingLevel = 3 }: { card: Pick<Flashcard, 'question' | 'options' | 'correctIndex'>; headingLevel?: 3 | 4 }) {
  const [flipped, setFlipped] = useState(false);
  const id = useId();
  const answerId = `${id}-answer`;
  const answerTextId = `${id}-answer-text`;
  const Heading = headingLevel === 4 ? 'h4' : 'h3';
  const answer = card.options[card.correctIndex] || 'Edit this card to choose an answer.';

  return <div className={`flashcard-flip${flipped ? ' is-flipped' : ''}`}>
    <div className="flashcard-flip-rotator">
      <div className="flashcard-flip-face flashcard-flip-front" aria-hidden={flipped} inert={flipped}>
        <div className="flashcard-flip-face-heading"><span>Question</span><Icon name="cards" size={18} /></div>
        <Heading className="flashcard-flip-question">{card.question}</Heading>
        <span className="flashcard-flip-hint" aria-hidden="true"><Icon name="flip" size={17} />Flip for answer</span>
      </div>
      <div className="flashcard-flip-face flashcard-flip-back" id={answerId} role="region" aria-label="Correct answer" aria-hidden={!flipped} inert={!flipped}>
        <div className="flashcard-flip-face-heading"><span>Correct answer</span><Icon name="check" size={19} /></div>
        <p className="flashcard-flip-answer" id={answerTextId}>{answer}</p>
        <span className="flashcard-flip-hint" aria-hidden="true"><Icon name="flip" size={17} />Flip to question</span>
      </div>
    </div>
    <button type="button" className="flashcard-flip-trigger" aria-label={`${flipped ? 'Show question' : 'Reveal answer'}: ${card.question}`} aria-expanded={flipped} aria-controls={answerId} aria-describedby={flipped ? answerTextId : undefined} onClick={() => setFlipped(value => !value)} />
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{flipped ? `Correct answer: ${answer}` : ''}</span>
  </div>;
}
