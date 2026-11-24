import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Flashcard } from '../types';
import { FlashcardFlip } from './FlashcardFlip';
import { Icon } from './Icon';
import { CourseBadges, effectiveCourses } from './CourseFields';

export function FlashcardReview({ cards, quizTo, onClose }: { cards: Flashcard[]; quizTo: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [deck, setDeck] = useState(cards);
  const [round, setRound] = useState(0);
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const [direction, setDirection] = useState<'next' | 'previous' | 'shuffle'>('next');
  const title = useId();
  useEffect(() => { dialog.current?.showModal(); dialog.current?.querySelector<HTMLButtonElement>('.flashcard-flip-trigger')?.focus(); }, []);
  useEffect(() => {
    if (finished) { dialog.current?.querySelector<HTMLElement>('.review-finish h3')?.focus(); }
    else { dialog.current?.querySelector<HTMLButtonElement>('.flashcard-flip-trigger')?.focus(); }
  }, [index, finished, round]);
  function dismiss() { if (dialog.current?.open) { dialog.current.close(); } else { onClose(); } }
  function next() { setDirection('next'); if (index + 1 < deck.length) { setIndex(value => value + 1); } else { setFinished(true); } }
  function previous() { setDirection('previous'); setIndex(value => Math.max(0, value - 1)); }
  function shuffle() {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    setDirection('shuffle'); setDeck(shuffled); setRound(value => value + 1); setIndex(0); setFinished(false);
  }
  function keys(event: KeyboardEvent) {
    if (finished || event.ctrlKey || event.metaKey || event.altKey || (event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) { return; }
    if (event.key === 'ArrowRight') { event.preventDefault(); next(); }
    if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); previous(); }
  }
  return <dialog className="flashcard-review-dialog" ref={dialog} aria-labelledby={title} onCancel={event => { event.preventDefault(); dismiss(); }} onClose={onClose} onKeyDown={keys}>
    <header className="review-dialog-header"><div><p className="eyebrow">A little focus goes a long way</p><h2 id={title}>Review flashcards</h2></div><button type="button" className="icon-button" aria-label="Close review" onClick={dismiss}><Icon name="close" /></button></header>
    {finished ? <section className="review-finish"><span className="review-finish-icon"><Icon name="check" size={32} /></span><h3 tabIndex={-1}>End of the deck</h3><p>You went through {deck.length} {deck.length === 1 ? 'card' : 'cards'}. Go through them again, or put your recall to the test.</p><div className="actions"><button type="button" className="btn primary" onClick={() => { setDirection('previous'); setIndex(0); setRound(value => value + 1); setFinished(false); }}>Review again</button><Link className="btn secondary" to={quizTo} onClick={dismiss}>Take a quiz</Link><button type="button" className="text-link" onClick={dismiss}>Back to your cards</button></div></section> : <>
      <div className="review-session-meta"><span role="status">Card {index + 1} of {deck.length}</span><button type="button" className="review-shuffle" onClick={shuffle} disabled={deck.length < 2}><Icon name="shuffle" size={17} />Shuffle cards</button></div>
      <progress className="review-position" aria-label="Review position" value={index + 1} max={deck.length} />
      <div className="review-card-stage" data-remaining={Math.min(2, deck.length - index - 1)}><div className="review-card-motion" data-direction={direction} key={`${round}-${deck[index]._id}-${index}`}><FlashcardFlip card={deck[index]} /></div></div>
      {(effectiveCourses(deck[index]).length > 0 || deck[index].tags.length > 0) && <details key={`${round}-${deck[index]._id}`} className="review-material-context"><summary><Icon name="connections" size={17} />Explore where this idea belongs</summary><CourseBadges courses={effectiveCourses(deck[index])} /><div className="review-book-links">{deck[index].tags.map(book => typeof book === 'object' && <Link key={book._id} to={`/books/${book._id}`} onClick={dismiss}><Icon name="book" size={16} />{book.title}</Link>)}</div></details>}
      <footer className="review-session-footer"><button type="button" className="btn secondary" disabled={index === 0} onClick={previous}>Previous</button><span>Flip to check your answer. Move on when you’re ready.</span><button type="button" className="btn primary" onClick={next}>{index + 1 === deck.length ? 'Finish review' : 'Next card'}</button></footer>
      <p className="review-keyboard-hint">Space or Enter to flip · Left and right keys to move between cards</p>
    </>}
  </dialog>;
}
