import { StudyChatLink } from '../../components/StudyChatLink';
import { CoursePicker, CourseBadges, courseIds, effectiveCourses } from '../../components/CourseFields';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useResource } from '../../hooks/useResource';
import { api, ApiError, errorMessage } from '../../services/api';
import type { Book, BookDetailData, FieldErrors, MaterialConnections } from '../../types';
import { ErrorBanner, Field, Loading, LoadError } from '../../components/Feedback';
import { BookCover, PageHeader } from '../../components/PageElements';
import { BookColorPicker } from '../../components/BookColorPicker';
import { CourseDoorways, LinkedNotes, RelatedReading, StudyDeck } from '../../components/ConnectedMaterials';
import { FlashcardFlip } from '../../components/FlashcardFlip';
import { FlashcardReview } from '../../components/FlashcardReview';
import { ItemActions } from '../../components/ItemActions';
import { Icon } from '../../components/Icon';
import { LinkedDocuments } from '../../components/documents/DocumentCards';

function BookForm({ book }: { book?: Book }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const context = params.get('course') || '';
  const [courses, setCourses] = useState(book ? courseIds(book.courses) : context && context !== 'none' ? [context] : []);
  const [values, setValues] = useState({ title: book?.title || '', author: book?.author || '', category: book?.category || '', description: book?.description || '', url: book?.url || '', color: book?.color ?? (book ? null : '#b5a4dc') });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<FieldErrors>({});
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setFields({});
    try {
      const result = await api<{ book: Book }>(book ? `/books/${book._id}` : '/books', { method: book ? 'PATCH' : 'POST', body: { ...values, courses } });
      navigate(context && context !== 'none' ? `/courses/${context}?tab=books` : `/books/${result.book._id}`);
    } catch (reason) { setError(errorMessage(reason)); if (reason instanceof ApiError) { setFields(reason.fields); } }
    finally { setBusy(false); }
  }
  const preview: Book = { ...values, _id: book?._id || 'book-preview', title: values.title || 'Your next chapter', author: values.author || 'Author', category: values.category || 'Your collection' };
  return <><PageHeader eyebrow="Make room on your shelf" title={book ? 'Edit book' : 'Add a book'} description="A reference, a color, and a connection to what you’re learning." />
    <div className="book-editor-layout"><form className="form-container book-editor-fields" onSubmit={submit}><ErrorBanner message={error} />
      {(['title', 'author', 'category'] as const).map(name => <Field key={name} name={name} label={name === 'title' ? 'Book title' : name === 'author' ? 'Author' : 'Category'} error={fields[name]}><input id={name} name={name} required value={values[name]} onChange={event => setValues({ ...values, [name]: event.target.value })} /></Field>)}
      <BookColorPicker value={values.color} onChange={color => setValues(previous => ({ ...previous, color }))} disabled={busy} error={fields.color} />
      <Field name="description" label="Description (optional)" error={fields.description}><textarea id="description" name="description" value={values.description} onChange={event => setValues({ ...values, description: event.target.value })} /></Field>
      <Field name="url" label="Book URL (optional)" error={fields.url}><input id="url" name="url" type="url" placeholder="https://example.com" value={values.url} onChange={event => setValues({ ...values, url: event.target.value })} /></Field>
      <CoursePicker selected={courses} onChange={setCourses} disabled={busy} error={fields.courses} />
      <div className="actions"><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save book'}</button><Link className="btn secondary" to={context && context !== 'none' ? `/courses/${context}?tab=books` : book ? `/books/${book._id}` : '/books'}>Cancel</Link></div>
    </form><aside className="book-live-preview" aria-label="Book cover preview"><span className="eyebrow">A little preview</span><BookCover book={preview} /><h3>Make it feel like your shelf.</h3><p>Your chosen color follows this book across your courses and study spaces.</p><span className="book-preview-color">{values.color || 'Automatic palette'}</span></aside></div>
  </>;
}
export function BookEditor() {
  const { id } = useParams();
  const { data, loading, error, reload } = useResource<{ book: Book }>(id ? `/books/${id}` : null);
  if (loading) return <Loading />;
  if (error || id && !data) return <LoadError message={error || 'Book not found.'} retry={reload} />;
  return <BookForm key={id || 'new'} book={data?.book} />;
}

export function BookDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [review, setReview] = useState(false);
  const requested = params.get('tab') || 'overview';
  const tab = ['overview', 'notes', 'practice', 'connections'].includes(requested) ? requested : 'overview';
  const { data, loading, error, reload } = useResource<BookDetailData>(`/books/${id}`);
  if (loading) return <Loading />;
  if (error || !data) return <LoadError message={error || 'Book not found.'} retry={reload} />;
  const { book } = data;
  const related: MaterialConnections = data.related || { book, courses: effectiveCourses(book), notes: [], flashcards: [], books: [] };
  const context = related.courses.find(course => course._id === params.get('course'))?._id || '';
  const contextQuery = context ? `?course=${context}` : '';
  const noteTo = `/notes/add?book=${book._id}${context ? `&course=${context}` : ''}`;
  const cardTo = `/flashcards/new?book=${book._id}${context ? `&course=${context}` : ''}`;
  const quizTo = `/flashcards/quiz?tags=${book._id}`;
  const safeUrl = book.url && /^https?:\/\//i.test(book.url) ? book.url : null;
  function selectTab(value: string) { const next = new URLSearchParams(params); if (value === 'overview') next.delete('tab'); else next.set('tab', value); setParams(next); }
  return <>
    <nav className="learning-trail" aria-label="Book location"><Link to="/courses">Courses</Link><span>/</span>{context && <><Link to={`/courses/${context}`}>{related.courses.find(course => course._id === context)?.title}</Link><span>/</span></>}<Link to={context ? `/books?course=${context}` : '/books'}>Books</Link><span>/</span><span>{book.title}</span></nav>
    <section className="book-hub-hero"><div className="book-hub-cover"><BookCover book={book} /></div><div className="book-hub-introduction"><div className="book-hub-kicker"><span className="eyebrow">{book.category}</span><ItemActions title={book.title} kind="book" editTo={`/books/${book._id}/edit${contextQuery}`} deletePath={`/books/${book._id}`} onDeleted={() => navigate(context ? `/courses/${context}?tab=books` : '/books')} description="Its notes and flashcards will be kept, with their book links removed." extra={[{ label: 'Create a flashcard', icon: 'cards', to: cardTo }]} /></div><h2>{book.title}</h2><p className="book-hub-author">by {book.author}</p><CourseBadges courses={effectiveCourses(book)} /><p className="book-hub-welcome">A place to follow this book’s ideas into your notes, your courses, and your own understanding.</p><div className="actions">{safeUrl ? <a className="btn primary" href={safeUrl} target="_blank" rel="noopener noreferrer"><Icon name="book" size={18} />Open reading</a> : related.notes.length ? <button className="btn primary" onClick={() => selectTab('notes')}>Explore book notes</button> : <Link className="btn primary" to={noteTo}>Start a book note</Link>}{(safeUrl || related.notes.length > 0) && <Link className="study-secondary-action" to={noteTo}><Icon name="edit" size={17} />Take notes</Link>}{related.flashcards.length > 0 && <button className="study-secondary-action hub-text-button" onClick={() => setReview(true)}><Icon name="cards" size={18} />Review cards</button>}</div><div className="book-hub-connections"><span><Icon name="note" size={16} />{related.notes.length} linked notes</span><span><Icon name="cards" size={16} />{related.flashcards.length} practice cards</span><span><Icon name="courses" size={16} />{related.courses.length} {related.courses.length === 1 ? 'course' : 'courses'}</span></div></div></section>
    <StudyChatLink kind="book" id={book._id} />
    <nav className="hub-tabs" aria-label="Book materials">{[{ id: 'overview', label: 'Overview' }, { id: 'notes', label: `Notes (${related.notes.length})` }, { id: 'practice', label: `Practice (${related.flashcards.length})` }, { id: 'connections', label: 'Connections' }].map(item => <button key={item.id} aria-current={tab === item.id ? 'page' : undefined} onClick={() => selectTab(item.id)}>{item.label}</button>)}</nav>
    {tab === 'overview' && <>
      <section className="next-study-steps" aria-label="Ways to explore this book"><Link className="next-study-step" to={related.notes.length ? `/notes/${related.notes[0]._id}${contextQuery}` : noteTo}><Icon name="note" size={24} /><strong>{related.notes.length ? 'Follow an idea' : 'Capture a thought'}</strong><span>{related.notes[0]?.title || 'Put something you learned into your own words.'}</span><small>{related.notes.length ? 'Read a connected note' : 'Open your writing space'}</small></Link>{related.flashcards.length ? <button className="next-study-step" onClick={() => setReview(true)}><Icon name="cards" size={24} /><strong>Make it stick</strong><span>{related.flashcards.length} cards connect to this book.</span><small>Start a focused review</small></button> : <Link className="next-study-step" to={cardTo}><Icon name="cards" size={24} /><strong>Turn an idea into practice</strong><span>A small question can make a stronger memory.</span><small>Create a flashcard</small></Link>}<Link className="next-study-step" to={related.courses.length ? `/courses/${related.courses[0]._id}` : `/books/${book._id}/edit`}><Icon name="connections" size={24} /><strong>{related.courses.length ? 'See the bigger picture' : 'Connect this book'}</strong><span>{related.courses[0]?.title || 'Give your reading a home in one of your courses.'}</span><small>{related.courses.length ? 'Dive into the course' : 'Choose your courses'}</small></Link></section>
      <details className="book-about" open><summary>About this book</summary><p>{book.description || 'No description yet. Your notes and connected materials will grow alongside this book.'}</p></details>
      <LinkedDocuments scope={{ book: book._id }} title="PDFs for this book" />
      {related.notes.length > 0 && <section className="explore-section"><header><div><span className="eyebrow">Ideas from these pages</span><h3>Connected notes</h3></div><button className="text-link" onClick={() => selectTab('notes')}>See all notes</button></header><LinkedNotes notes={related.notes.slice(0, 3)} context={context} /></section>}
      {related.flashcards.length > 0 && <section className="explore-section book-study-deck"><header><div><span className="eyebrow">Something to remember</span><h3>Your practice deck</h3></div><button className="text-link" onClick={() => selectTab('practice')}>Explore practice</button></header><StudyDeck count={related.flashcards.length} onReview={() => setReview(true)} /></section>}
      {related.courses.length > 0 && <section className="explore-section"><header><div><span className="eyebrow">This reading belongs here</span><h3>Step into a course</h3></div></header><CourseDoorways courses={related.courses} /></section>}
    </>}
    {tab === 'notes' && <section className="explore-section"><header><div><span className="eyebrow">In your own words</span><h3>Notes linked to this book</h3></div><Link className="study-secondary-action" to={noteTo}><Icon name="edit" size={17} />Write a book note</Link></header>{related.notes.length ? <LinkedNotes notes={related.notes} context={context} /> : <div className="connected-empty"><Icon name="note" size={32} /><h4>Start with one thought</h4><p>A question, a quote, a connection. Your reading notes will live here.</p><Link className="btn primary" to={noteTo}>Write your first book note</Link></div>}</section>}
    {tab === 'practice' && <section className="explore-section"><header><div><span className="eyebrow">Close the book. Trust your recall.</span><h3>Practice this reading</h3></div>{related.flashcards.length > 0 && <div className="actions"><button className="btn primary" onClick={() => setReview(true)}>Review this book</button><Link className="study-secondary-action" to={quizTo}>Take a book quiz</Link></div>}</header>{related.flashcards.length ? <><StudyDeck count={related.flashcards.length} onReview={() => setReview(true)} /><div className="book-practice-grid">{related.flashcards.map(card => <FlashcardFlip key={card._id} card={card} />)}</div></> : <div className="connected-empty"><Icon name="cards" size={32} /><h4>Give an idea a little practice</h4><p>Turn something you read into a question you can come back to.</p><Link className="btn primary" to={cardTo}>Create a book flashcard</Link></div>}</section>}
    {tab === 'connections' && <div className="book-connected-sections">{related.courses.length ? <section className="explore-section"><header><div><span className="eyebrow">The bigger picture</span><h3>Your connected courses</h3></div></header><CourseDoorways courses={related.courses} /></section> : <div className="connected-empty"><Icon name="courses" size={32} /><h4>Find a home for this book</h4><p>Connect it to a course to discover more related reading and notes.</p><Link className="btn secondary" to={`/books/${book._id}/edit`}>Organize book</Link></div>}{related.books.length > 0 && <section className="explore-section"><header><div><span className="eyebrow">From the same courses</span><h3>Keep following the subject</h3></div></header><RelatedReading books={related.books} /></section>}</div>}
    {review && related.flashcards.length > 0 && <FlashcardReview cards={related.flashcards} quizTo={quizTo} onClose={() => setReview(false)} />}
  </>;
}
