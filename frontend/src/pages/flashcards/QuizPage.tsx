import { SavedStudySets } from '../../components/SavedStudySets';
import { CourseFilter, courseIds } from '../../components/CourseFields';
import { useReducer, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useResource } from '../../hooks/useResource';
import { api, errorMessage } from '../../services/api';
import type { Book, Flashcard } from '../../types';
import { ErrorBanner, Loading, LoadError } from '../../components/Feedback';
import { BookTags } from '../../components/BookTags';
import { initialQuizState, quizReducer } from './quizState';
import { PageHeader } from '../../components/PageElements';
import { Icon } from '../../components/Icon';

export function QuizPage() {
  const [params] = useSearchParams();
  const [course, setCourse] = useState(params.get('course') || '');
  const books = useResource<{ books: Book[] }>('/books');
  const [tags, setTags] = useState<string[]>(() => (params.get('tags') || '').split(',').filter(Boolean));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [state, dispatch] = useReducer(quizReducer, initialQuizState);
  async function start() {
    setError('');
    if (!tags.length && !course) { setError('Select at least one book tag or a course to start the quiz.'); return; }
    setBusy(true);
    try {
      const { flashcards } = await api<{ flashcards: Flashcard[] }>(`/flashcards?${new URLSearchParams({ ...(tags.length ? { tags: tags.join(',') } : {}), ...(course ? { course } : {}) })}`);
      if (!flashcards.length) { setError('No flashcards found for these materials. Add some or choose a different course or book.'); return; }
      if (flashcards.some((card) => card.options.length < 2 || !Number.isInteger(card.correctIndex) || card.correctIndex < 0 || card.correctIndex >= card.options.length)) { setError('Some flashcards need their answers corrected. Edit them before starting this quiz.'); return; }
      dispatch({ type: 'start', cards: flashcards });
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }
  if (books.loading) { return <Loading />; }
  if (books.error || !books.data) { return <LoadError message={books.error || 'Could not load books.'} retry={books.reload} />; }
  const card = state.cards[state.index];
  return <section className="section quiz-section"><PageHeader eyebrow="A moment to focus" title="Take a quiz" description="Choose a course or books. Trust what you know. Learn something new." />
    {state.status === 'idle' && <SavedStudySets kind="quiz" course={course} />}
    <ErrorBanner message={error} />
    {state.status === 'idle' && <div className="controls"><div className="quiz-course-selector"><h3>Study by course</h3><p>Choose a course, or pick individual books below.</p><CourseFilter allLabel="Choose a course" value={course} onChange={value => { setCourse(value); setTags([]); }} /></div><BookTags label={course ? 'Narrow by books (optional)' : 'Filter by books'} emptyMessage={course ? 'No related books. This quiz can use the course’s flashcards.' : 'Add a book to start tagging flashcards.'} books={books.data.books.filter(book => !course || (course === 'none' ? !courseIds(book.courses).length : courseIds(book.courses).includes(course)))} selected={tags} onChange={setTags} disabled={busy} />{!books.data.books.length && <Link to="/books/add">Add your first book</Link>}<button type="button" className="btn primary" disabled={busy || !books.data.books.length && !course} onClick={start}>{busy ? 'Loading questions…' : 'Start quiz'}</button></div>}
    {state.status === 'active' && <>
      <div className="quiz-hud" aria-live="polite"><span>Score: <strong>{state.score}</strong></span><span>Question <strong>{state.index + 1}</strong> / {state.cards.length}</span></div>
      <progress className="quiz-progress" aria-label="Quiz progress" value={state.index + (state.chosenIndex === null ? 0 : 1)} max={state.cards.length} /><div className="question-box" key={card._id}><h3>{card.question}</h3><div className="options-list">{card.options.map((option, index) => <button key={index} type="button" disabled={state.chosenIndex !== null} className={state.chosenIndex === index ? (index === card.correctIndex ? 'correct' : 'incorrect') : ''} onClick={() => dispatch({ type: 'answer', index })}>{option}</button>)}</div>
        {state.chosenIndex !== null && <p role="status" className={state.chosenIndex === card.correctIndex ? 'answer-correct' : 'answer-incorrect'}>{state.chosenIndex === card.correctIndex ? 'Correct!' : `Correct answer: ${card.options[card.correctIndex]}`}</p>}
        <div className="actions quiz-actions"><button className="btn primary" disabled={state.chosenIndex === null} onClick={() => dispatch({ type: 'next' })}>{state.index === state.cards.length - 1 ? 'See results' : 'Next'}</button><button className="btn secondary" onClick={() => dispatch({ type: 'finish' })}>End quiz</button></div>
      </div>
    </>}
    {state.status === 'results' && <div className="result-box"><span className="results-icon"><Icon name="check" size={28} /></span><h3>Quiz results</h3><p className="result-score">{state.score} / {state.cards.length}</p>
      {state.misses.length ? <><h4>Review missed answers</h4><ul className="missed-list">{state.misses.map((miss, index) => <li key={index}><strong>{miss.question}</strong><div>Your answer: {miss.chosen}</div><div>Correct answer: <em>{miss.correct}</em></div></li>)}</ul></> : <p>{state.score === state.cards.length ? 'Perfect! You missed no questions.' : 'No incorrect answers recorded.'}</p>}
      <div className="actions quiz-actions"><button className="btn primary" disabled={busy} onClick={start}>{busy ? 'Loading questions…' : course ? 'Retry this course' : 'Retry same tags'}</button><button className="btn secondary" disabled={busy} onClick={() => { dispatch({ type: 'reset' }); setError(''); }}>{course ? 'Choose materials' : 'Choose different tags'}</button></div>
    </div>}
    <p className="back-link"><Link to="/dashboard">Back to dashboard</Link></p>
  </section>;
}
