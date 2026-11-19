import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useResource } from '../../hooks/useResource';
import { api, ApiError, errorMessage } from '../../services/api';
import type { Book, FieldErrors, Flashcard } from '../../types';
import { ErrorBanner, Field, Loading, LoadError } from '../../components/Feedback';
import { DeleteButton } from '../../components/DeleteButton';
import { BookTags } from '../../components/BookTags';
import { EmptyState, PageHeader, SearchField } from '../../components/PageElements';
import { Icon } from '../../components/Icon';

export function FlashcardList() {
  const { data, loading, error, reload } = useResource<{ flashcards: Flashcard[] }>('/flashcards');
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  if (loading) { return <Loading />; }
  if (error || !data) { return <LoadError message={error || 'Could not load flashcards.'} retry={reload} />; }
  const tags = [...new Map(data.flashcards.flatMap((card) => card.tags.filter((tag): tag is { _id: string; title: string } => typeof tag === 'object').map((tag) => [tag._id, tag] as const))).values()];
  const filtered = data.flashcards.filter((card) => (!tagFilter || card.tags.some((tag) => (typeof tag === 'string' ? tag : tag._id) === tagFilter)) && `${card.question} ${card.options.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <PageHeader eyebrow="Make it stick" title="My flashcards" description="Small questions. Stronger connections. Better recall." action={<div className="actions"><Link className="btn secondary" to="/flashcards/quiz"><Icon name="play" size={17} />Take a quiz</Link><Link className="btn primary" to="/flashcards/new"><Icon name="plus" size={17} />Add flashcard</Link></div>} />
    <div className="collection-toolbar"><SearchField label="Search flashcards" value={query} onChange={setQuery} /><label className="filter-select"><span className="sr-only">Filter flashcards by book</span><select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}><option value="">All books</option>{tags.map((tag) => <option key={tag._id} value={tag._id}>{tag.title}</option>)}</select></label><span className="collection-count">{filtered.length} {filtered.length === 1 ? 'flashcard' : 'flashcards'}</span></div>
    {!data.flashcards.length ? <EmptyState icon="cards" title="Give your knowledge a little practice" description="Create a question from something you learned, then put it to the test." to="/flashcards/new" label="Create your first flashcard" /> : !filtered.length ? <div className="panel"><EmptyState icon="search" title="No matching flashcards" description="Try another question or book filter." /><button className="btn secondary" onClick={() => { setQuery(''); setTagFilter(''); }}>Clear filters</button></div> : <div className="flashcard-grid">{filtered.map((card) => <article className="flashcard collection-card" key={card._id}><div className="flashcard-top"><span className="flashcard-icon"><Icon name="cards" /></span><span className="flashcard-kind">Multiple choice</span></div><h3>{card.question}</h3><details className="answer-disclosure"><summary>Reveal answer</summary><p>{card.options[card.correctIndex] || 'Edit this card to choose an answer.'}</p></details><div className="tags-row">{card.tags.length ? card.tags.map((tag) => <span className="tag" key={typeof tag === 'string' ? tag : tag._id}>{typeof tag === 'string' ? 'Book' : tag.title}</span>) : <span className="tag tag--muted">No linked books</span>}</div><footer className="card-actions"><Link className="btn secondary small" to={`/flashcards/edit/${card._id}`}>Edit</Link><DeleteButton title={card.question} path={`/flashcards/${card._id}`} onDeleted={reload} /></footer></article>)}</div>}
  </>;
}

function FlashcardForm({ flashcard, books }: { flashcard?: Flashcard; books: Book[] }) {
  const navigate = useNavigate();
  const [question, setQuestion] = useState(flashcard?.question || '');
  const [options, setOptions] = useState(Array.from({ length: 4 }, (_, index) => flashcard?.options[index] || ''));
  const [correctIndex, setCorrectIndex] = useState(flashcard?.correctIndex ?? 0);
  const [tags, setTags] = useState((flashcard?.tags || []).map((tag) => typeof tag === 'string' ? tag : tag._id).filter((id) => books.some((book) => book._id === id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<FieldErrors>({});
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setFields({});
    if (!tags.length) { setFields({ tags: 'Select at least one related book.' }); return; }
    if (!options[correctIndex]?.trim()) { setFields({ correctIndex: 'The correct option must contain text.' }); return; }
    setBusy(true);
    try {
      await api(flashcard ? `/flashcards/${flashcard._id}` : '/flashcards', { method: flashcard ? 'PATCH' : 'POST', body: { question, options, correctIndex, tags } });
      navigate('/flashcards/list');
    } catch (reason) { setError(errorMessage(reason)); if (reason instanceof ApiError) { setFields(reason.fields); } }
    finally { setBusy(false); }
  }
  return <><PageHeader eyebrow="A little practice goes a long way" title={flashcard ? 'Edit flashcard' : 'Add a flashcard'} description="Turn what you’re learning into something you can remember." /><form className="form-container" onSubmit={submit}>
    <ErrorBanner message={error} />
    {!books.length && <p className="empty">You need a related book first. <Link to="/books/add">Add a book</Link>.</p>}
    <Field label="Question" name="question" error={fields.question}><input id="question" name="question" required value={question} onChange={(e) => setQuestion(e.target.value)} /></Field>
    <div className="grid-2">{options.map((option, index) => <Field key={index} name={`option${index + 1}`} label={`Option ${index + 1}${index > 1 ? ' (optional)' : ''}`}><input id={`option${index + 1}`} name={`option${index + 1}`} required={index < 2} value={option} onChange={(e) => setOptions(options.map((value, optionIndex) => optionIndex === index ? e.target.value : value))} /></Field>)}</div>
    <Field name="correctIndex" label="Correct answer" error={fields.correctIndex}><select id="correctIndex" value={correctIndex} onChange={(e) => setCorrectIndex(Number(e.target.value))}>{options.map((_option, index) => <option key={index} value={index}>Option {index + 1}</option>)}</select></Field>
    <BookTags books={books} selected={tags} onChange={setTags} disabled={busy} /><ErrorBanner message={fields.tags} />
    <div className="actions"><button type="submit" className="btn primary" disabled={busy || !books.length}>{busy ? 'Saving…' : 'Save flashcard'}</button><Link className="btn secondary" to="/flashcards/list">Cancel</Link></div>
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
