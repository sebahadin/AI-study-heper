import { SavedStudySets } from '../../components/SavedStudySets';
import { FlashcardFlip } from '../../components/FlashcardFlip';
import { CourseFilter, CourseBadges, effectiveCourses, CoursePicker, courseIds } from '../../components/CourseFields';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useResource } from '../../hooks/useResource';
import { api, ApiError, errorMessage } from '../../services/api';
import type { Book, FieldErrors, Flashcard } from '../../types';
import { ErrorBanner, Field, Loading, LoadError } from '../../components/Feedback';
import { ItemActions } from '../../components/ItemActions';
import { FlashcardReview } from '../../components/FlashcardReview';
import { BookTags } from '../../components/BookTags';
import { EmptyState, PageHeader, SearchField } from '../../components/PageElements';
import { Icon } from '../../components/Icon';

export function FlashcardList() {
  const [params, setParams] = useSearchParams();
  const course = params.get('course') || '';
  const courseQuery = course && course !== 'none' ? `?course=${encodeURIComponent(course)}` : '';
  const changeCourse = (value: string) => { const next = new URLSearchParams(params); if (value) { next.set('course', value); } else { next.delete('course'); } setParams(next); setTagFilter(''); };
  const { data, loading, error, reload } = useResource<{ flashcards: Flashcard[] }>(`/flashcards${course ? `?course=${encodeURIComponent(course)}` : ''}`);
  const [reviewOpen, setReviewOpen] = useState(params.get('review') === '1');
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  if (loading) { return <Loading />; }
  if (error || !data) { return <LoadError message={error || 'Could not load flashcards.'} retry={reload} />; }
  const tags = [...new Map(data.flashcards.flatMap((card) => card.tags.filter((tag): tag is { _id: string; title: string } => typeof tag === 'object').map((tag) => [tag._id, tag] as const))).values()];
  const filtered = data.flashcards.filter((card) => (!tagFilter || card.tags.some((tag) => (typeof tag === 'string' ? tag : tag._id) === tagFilter)) && `${card.question} ${card.options.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  const quizParams = new URLSearchParams({ ...(course ? { course } : {}), ...(tagFilter ? { tags: tagFilter } : {}) });
  const quizTo = `/flashcards/quiz${quizParams.size ? `?${quizParams}` : ''}`;
  function closeReview() { setReviewOpen(false); if (params.has('review')) { const next = new URLSearchParams(params); next.delete('review'); setParams(next, { replace: true }); } }
  return <>
    <PageHeader eyebrow="Make it stick" title="My flashcards" description="Flip a card, recall the answer, and build a stronger memory." action={<Link className="study-secondary-action" to={quizTo}><Icon name="play" size={18} />Take a quiz</Link>} />
    <SavedStudySets kind="flashcards" course={course} />
    <div className="collection-toolbar"><SearchField label="Search flashcards" value={query} onChange={setQuery} /><CourseFilter value={course} onChange={changeCourse} /><label className="filter-select"><span className="sr-only">Filter flashcards by book</span><select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}><option value="">All books</option>{tags.map((tag) => <option key={tag._id} value={tag._id}>{tag.title}</option>)}</select></label><span className="collection-count">{filtered.length} {filtered.length === 1 ? 'flashcard' : 'flashcards'}</span></div>
    {data.flashcards.length > 0 && <section className="study-practice-banner"><div><span className="eyebrow">A moment for your memory</span><h3>Make a little time for recall.</h3><p>{filtered.length} {filtered.length === 1 ? 'card' : 'cards'} in this selection. Flip, think, and move at your own pace.</p><button className="btn primary" disabled={!filtered.length} onClick={() => setReviewOpen(true)}><Icon name="cards" size={18} />Review cards</button></div><div className="study-card-stack" aria-hidden="true"><i /><i /><i><Icon name="cards" size={64} /></i></div></section>}
    {!data.flashcards.length ? <EmptyState icon="cards" title="Give your knowledge a little practice" description="Create a question from something you learned, then put it to the test." to={`/flashcards/new${courseQuery}`} label="Create your first flashcard" /> : !filtered.length ? <div className="panel"><EmptyState icon="search" title="No matching flashcards" description="Try another question or book filter." /><button className="btn secondary" onClick={() => { setQuery(''); setTagFilter(''); }}>Clear filters</button></div> : <div className="flashcard-grid study-flashcard-grid">{filtered.map((card) => <article className="flashcard collection-card" key={card._id}><div className="flashcard-top"><span className="study-flashcard-label"><Icon name="cards" size={18} /><span>Recall practice</span></span><ItemActions title={card.question} kind="flashcard" editTo={`/flashcards/edit/${card._id}${courseQuery}`} deletePath={`/flashcards/${card._id}`} onDeleted={reload} /></div><FlashcardFlip card={card} /><CourseBadges courses={effectiveCourses(card)} /><div className="tags-row">{card.tags.length ? card.tags.map((tag) => typeof tag === 'string' ? <span className="tag" key={tag}>Book</span> : <Link className="tag" key={tag._id} to={`/books/${tag._id}`}>{tag.title}</Link>) : <span className="tag tag--muted">No linked books</span>}</div></article>)}</div>}
    {reviewOpen && filtered.length > 0 && <FlashcardReview cards={filtered} quizTo={quizTo} onClose={closeReview} />}
  </>;
}

function FlashcardForm({ flashcard, books }: { flashcard?: Flashcard; books: Book[] }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const context = params.get('course') || '';
  const [courses, setCourses] = useState(flashcard ? courseIds(flashcard.courses) : context && context !== 'none' ? [context] : []);
  const [question, setQuestion] = useState(flashcard?.question || '');
  const [options, setOptions] = useState(Array.from({ length: 4 }, (_, index) => flashcard?.options[index] || ''));
  const [correctIndex, setCorrectIndex] = useState(flashcard?.correctIndex ?? 0);
  const [tags, setTags] = useState((flashcard?.tags || (params.get('book') ? [params.get('book')!] : [])).map((tag) => typeof tag === 'string' ? tag : tag._id).filter((id) => books.some((book) => book._id === id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<FieldErrors>({});
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setFields({});
    if (!tags.length && !courses.length) { setFields({ courses: 'Select at least one course or related book.' }); return; }
    if (!options[correctIndex]?.trim()) { setFields({ correctIndex: 'The correct option must contain text.' }); return; }
    setBusy(true);
    try {
      await api(flashcard ? `/flashcards/${flashcard._id}` : '/flashcards', { method: flashcard ? 'PATCH' : 'POST', body: { question, options, correctIndex, tags, courses } });
      navigate(context && context !== 'none' ? `/courses/${context}?tab=flashcards` : '/flashcards/list');
    } catch (reason) { setError(errorMessage(reason)); if (reason instanceof ApiError) { setFields(reason.fields); } }
    finally { setBusy(false); }
  }
  return <><PageHeader eyebrow="A little practice goes a long way" title={flashcard ? 'Edit flashcard' : 'Add a flashcard'} description="Turn what you’re learning into something you can remember." /><form className="form-container" onSubmit={submit}>
    <ErrorBanner message={error} />
    {!books.length && <p className="empty">Assign this flashcard to a course below, or <Link to="/books/add">add a related book</Link>.</p>}
    <Field label="Question" name="question" error={fields.question}><input id="question" name="question" required value={question} onChange={(e) => setQuestion(e.target.value)} /></Field>
    <div className="grid-2">{options.map((option, index) => <Field key={index} name={`option${index + 1}`} label={`Option ${index + 1}${index > 1 ? ' (optional)' : ''}`}><input id={`option${index + 1}`} name={`option${index + 1}`} required={index < 2} value={option} onChange={(e) => setOptions(options.map((value, optionIndex) => optionIndex === index ? e.target.value : value))} /></Field>)}</div>
    <Field name="correctIndex" label="Correct answer" error={fields.correctIndex}><select id="correctIndex" value={correctIndex} onChange={(e) => setCorrectIndex(Number(e.target.value))}>{options.map((_option, index) => <option key={index} value={index}>Option {index + 1}</option>)}</select></Field>
    <CoursePicker selected={courses} onChange={setCourses} disabled={busy} inherited={effectiveCourses({ tags: books.filter(book => tags.includes(book._id)) })} error={fields.courses} />
    <BookTags label="Related books (optional if a course is selected)" books={books} selected={tags} onChange={setTags} disabled={busy} /><ErrorBanner message={fields.tags} />
    <div className="actions"><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save flashcard'}</button><Link className="btn secondary" to={context && context !== 'none' ? `/courses/${context}?tab=flashcards` : '/flashcards/list'}>Cancel</Link></div>
  </form></>;
}

export function FlashcardEditor() {
  const { id } = useParams();
  const cards = useResource<{ flashcard: Flashcard }>(id ? `/flashcards/${id}` : null);
  const books = useResource<{ books: Book[] }>('/books');
  if (cards.loading || books.loading) { return <Loading />; }
  const error = cards.error || books.error;
  if (error || !books.data || (id && !cards.data)) { return <LoadError message={error || 'Could not load flashcard editor.'} retry={() => { cards.reload(); books.reload(); }} />; }
  return <FlashcardForm key={id || 'new'} flashcard={cards.data?.flashcard} books={books.data.books} />;
}
