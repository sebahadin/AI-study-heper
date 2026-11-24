import { FlashcardFlip } from '../../components/FlashcardFlip';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useResource } from '../../hooks/useResource';
import { api, ApiError, errorMessage } from '../../services/api';
import type { BookRef, Course, CourseDetailData, CourseRef, FieldErrors, Flashcard } from '../../types';
import { ErrorBanner, Field, Loading, LoadError } from '../../components/Feedback';
import { BookCover, EmptyState, PageHeader, SearchField } from '../../components/PageElements';
import { Icon } from '../../components/Icon';
import { ItemActions } from '../../components/ItemActions';
import { ActionMenu } from '../../components/ActionMenu';
import { FlashcardReview } from '../../components/FlashcardReview';
import { courseIds, effectiveCourses } from '../../components/CourseFields';

const colors = ['violet', 'blue', 'mint', 'peach', 'rose'];
type MaterialKind = 'books' | 'notes' | 'flashcards';
const materialKinds: MaterialKind[] = ['books', 'notes', 'flashcards'];
const materialLabels = { books: 'Books', notes: 'Notes', flashcards: 'Flashcards' };
const materialIcons = { books: 'book', notes: 'note', flashcards: 'cards' } as const;
const addPath = (kind: MaterialKind, course: string) => `${kind === 'flashcards' ? '/flashcards/new' : `/${kind}/add`}?course=${encodeURIComponent(course)}`;
const removeDescription = 'Your books, notes, and flashcards will be kept. Only their association with this course will be removed.';

export function CourseList() {
  const { data, loading, error, reload } = useResource<{ courses: Course[] }>('/courses');
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  if (loading) { return <Loading />; }
  if (error || !data) { return <LoadError message={error || 'Could not load courses.'} retry={reload} />; }
  const terms = [...new Set(data.courses.map(course => course.term).filter(Boolean))].sort();
  const filtered = data.courses.filter(course => (!term || course.term === term) && `${course.title} ${course.code} ${course.term} ${course.instructor}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <PageHeader eyebrow="One place for every subject" title="Courses" description="Bring your books, notes, and practice together around what you’re learning." />
    <div className="course-intro"><div className="course-intro-icon"><Icon name="courses" size={30} /></div><div><h3>What would you like to explore?</h3><p>Open a course and settle into its reading, notes, and practice.</p></div></div>
    <div className="collection-toolbar"><SearchField label="Search courses" value={query} onChange={setQuery} /><label className="filter-select"><span className="sr-only">Filter courses by term</span><select value={term} onChange={event => setTerm(event.target.value)}><option value="">All terms</option>{terms.map(value => <option key={value} value={value}>{value}</option>)}</select></label><span className="collection-count">{filtered.length} {filtered.length === 1 ? 'course' : 'courses'}</span></div>
    {!data.courses.length ? <EmptyState icon="courses" title="Start with a subject" description="Add your first course, then bring its books, notes, and flashcards together." to="/courses/add" label="Add your first course" /> : !filtered.length ? <div className="panel"><EmptyState icon="search" title="No matching courses" description="Try a different name, code, or term." /><button className="btn secondary" onClick={() => { setQuery(''); setTerm(''); }}>Clear filters</button></div> : <div className="course-grid">{filtered.map(course => <article aria-label={course.title} className={`course-card course-tone--${course.color || 'violet'}`} key={course._id}><Link to={`/courses/${course._id}`} className="course-card-main"><div className="course-card-top"><span className="course-card-icon"><Icon name="courses" size={28} /></span><span>{course.code || 'Course'}</span></div><h3>{course.title}</h3><p className="course-card-term">{[course.term, course.instructor].filter(Boolean).join(' · ') || 'Your space to learn'}</p><p className="course-card-description">{course.description || 'Bring your reading, ideas, and practice into one place.'}</p><div className="course-card-counts">{materialKinds.map(kind => <span key={kind}><Icon name={materialIcons[kind]} size={15} /><strong>{course.counts?.[kind] || 0}</strong>{course.counts?.[kind] === 1 ? kind.slice(0, -1) : kind}</span>)}</div></Link><footer><Link className="text-link" to={`/courses/${course._id}`}>Open course</Link><ItemActions title={course.title} kind="course" editTo={`/courses/${course._id}/edit`} deletePath={`/courses/${course._id}`} description={removeDescription} onDeleted={reload} /></footer></article>)}</div>}
  </>;
}
function CourseForm({ course }: { course?: Course }) {
  const navigate = useNavigate();
  const [values, setValues] = useState({ title: course?.title || '', code: course?.code || '', term: course?.term || '', instructor: course?.instructor || '', description: course?.description || '', color: course?.color || 'violet' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<FieldErrors>({});
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setFields({});
    try {
      const result = await api<{ course: Course }>(course ? `/courses/${course._id}` : '/courses', { method: course ? 'PATCH' : 'POST', body: values });
      navigate(`/courses/${result.course._id}`);
    } catch (reason) { setError(errorMessage(reason)); if (reason instanceof ApiError) { setFields(reason.fields); } }
    finally { setBusy(false); }
  }
  return <><PageHeader eyebrow="Make room for a new subject" title={course ? 'Edit course' : 'Add a course'} description="Start with a name. Add the details that help you find your way back." /><form className="form-container course-form" onSubmit={submit}><ErrorBanner message={error} />
    <Field name="course-title" label="Course name" error={fields.title}><input id="course-title" required maxLength={160} placeholder="e.g. Introduction to Psychology" value={values.title} onChange={event => setValues({ ...values, title: event.target.value })} /></Field>
    <div className="grid-2"><Field name="course-code" label="Course code (optional)" error={fields.code}><input id="course-code" maxLength={160} placeholder="e.g. PSY 101" value={values.code} onChange={event => setValues({ ...values, code: event.target.value })} /></Field><Field name="course-term" label="Term (optional)" error={fields.term}><input id="course-term" maxLength={160} placeholder="e.g. Fall 2026" value={values.term} onChange={event => setValues({ ...values, term: event.target.value })} /></Field></div>
    <Field name="course-instructor" label="Instructor (optional)" error={fields.instructor}><input id="course-instructor" maxLength={160} value={values.instructor} onChange={event => setValues({ ...values, instructor: event.target.value })} /></Field>
    <Field name="course-description" label="About this course (optional)" error={fields.description}><textarea id="course-description" maxLength={3000} placeholder="What are you exploring in this course?" value={values.description} onChange={event => setValues({ ...values, description: event.target.value })} /></Field>
    <fieldset className="course-color-picker"><legend>Course color</legend><div>{colors.map(color => <label key={color} className={`course-color-choice course-tone--${color}`}><input type="radio" name="course-color" value={color} checked={values.color === color} onChange={() => setValues({ ...values, color })} /><span className="course-color-swatch" /><span>{color}</span></label>)}</div></fieldset><ErrorBanner message={fields.color} />
    <div className="actions"><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save course'}</button><Link className="btn secondary" to={course ? `/courses/${course._id}` : '/courses'}>Cancel</Link></div>
  </form></>;
}
export function CourseEditor() {
  const { id } = useParams();
  const { data, loading, error, reload } = useResource<{ course: Course }>(id ? `/courses/${id}` : null);
  if (loading) { return <Loading />; }
  if (error || id && !data) { return <LoadError message={error || 'Course not found.'} retry={reload} />; }
  return <CourseForm key={id || 'new'} course={data?.course} />;
}
interface Material { _id: string; title?: string; question?: string; courses?: (CourseRef | string)[]; book?: BookRef | string | null; tags?: (BookRef | string)[] }
function MaterialSelection({ items, kind, course, onClose, onSaved, setBusy }: { items: Material[]; kind: MaterialKind; course: Course; onClose: () => void; onSaved: () => void; setBusy: (value: boolean) => void }) {
  const [selected, setSelected] = useState(items.filter(item => courseIds(item.courses).includes(course._id)).map(item => item._id));
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setBusy(true); setError('');
    try { await api(`/courses/${course._id}/materials`, { method: 'PATCH', body: { kind, ids: selected } }); onSaved(); onClose(); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setSaving(false); setBusy(false); }
  }
  return <form onSubmit={save}><p>Choose the {kind} to include in {course.title}. Your materials will stay available in All materials.</p><SearchField label={`Search existing ${kind}`} value={query} onChange={setQuery} /><ErrorBanner message={error} /><fieldset className="course-material-options" disabled={saving}><legend className="sr-only">Existing {kind}</legend>{items.filter(item => `${item.title || item.question}`.toLowerCase().includes(query.trim().toLowerCase())).map(item => {
    const inherited = !courseIds(item.courses).includes(course._id) && effectiveCourses({ ...item, courses: [] }).some(ref => ref._id === course._id);
    return <label className={`course-material-choice${inherited ? ' is-inherited' : ''}`} key={item._id}><input type="checkbox" checked={inherited || selected.includes(item._id)} disabled={inherited} onChange={event => setSelected(event.target.checked ? [...selected, item._id] : selected.filter(id => id !== item._id))} /><span><strong>{item.title || item.question}</strong><small>{inherited ? 'Included through a related book. Change the book’s courses to remove it here.' : 'Direct course assignment'}</small></span></label>;
  })}{!items.length && <p>No {kind} yet. <Link to={addPath(kind, course._id)}>Create your first one</Link>.</p>}</fieldset><p className="course-manager-help">Notes and flashcards from this course’s books also appear automatically. Unchecking an item removes its direct assignment to this course.</p><div className="modal-actions"><button type="button" className="btn secondary" disabled={saving} onClick={onClose}>Cancel</button><button className="btn primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save assignments'}</button></div></form>;
}
function ManageMaterials({ kind, course, onClose, onSaved }: { kind: MaterialKind; course: Course; onClose: () => void; onSaved: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useResource<Partial<Record<MaterialKind, Material[]>>>(`/${kind}`);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog className="course-manager-dialog" ref={ref} aria-labelledby="course-manager-title" onCancel={event => { if (busy) { event.preventDefault(); } else { onClose(); } }} onClose={onClose}><h2 id="course-manager-title">Manage {kind}</h2>{loading ? <Loading /> : error || !data ? <LoadError message={error || 'Could not load materials.'} retry={reload} /> : <MaterialSelection items={data[kind] || []} kind={kind} course={course} onClose={onClose} onSaved={onSaved} setBusy={setBusy} />}{(loading || error) && <button type="button" className="btn secondary" onClick={onClose}>Close</button>}</dialog>;
}

export function CourseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const requested = params.get('tab') || 'overview';
  const tab = ['overview', ...materialKinds].includes(requested) ? requested : 'overview';
  const [manage, setManage] = useState<MaterialKind | null>(null);
  const [review, setReview] = useState<Flashcard[] | null>(null);
  const [query, setQuery] = useState('');
  const { data, loading, error, reload } = useResource<CourseDetailData>(`/courses/${id}`);
  if (loading) { return <Loading />; }
  if (error || !data) { return <LoadError message={error || 'Course not found.'} retry={reload} />; }
  const { course, books, notes, flashcards } = data;
  const quizTo = `/flashcards/quiz?course=${course._id}`;
  function materialSection(kind: MaterialKind, overview = false) {
    if (!data) { return null; }
    const search = overview ? '' : query.trim().toLowerCase();
    const items = data[kind].filter(item => `${'title' in item ? item.title : item.question} ${'content' in item ? item.content : ''}`.toLowerCase().includes(search));
    return <section className="panel course-material-section study-course-materials" key={kind}>
      <header className="panel-heading"><div><span className="eyebrow">{kind === 'books' ? 'Your course references' : kind === 'notes' ? 'Ideas and understanding' : 'Ready for recall'}</span><h3>{materialLabels[kind]} <span className="course-section-count">{data[kind].length}</span></h3></div>
        <div className="actions">{overview ? <Link className="text-link" to={`?tab=${kind}`}>View all {kind}</Link> : <>
          {kind === 'notes' && data.notes.length > 0 && <Link className="study-secondary-action" to={addPath('notes', course._id)}><Icon name="edit" size={17} />Write a note</Link>}
          {kind === 'flashcards' && data.flashcards.length > 0 && <button className="btn primary small" disabled={!items.length} onClick={() => setReview(data.flashcards.filter(card => card.question.toLowerCase().includes(search)))}><Icon name="cards" size={17} />Review this selection</button>}
          <ActionMenu label={`Organize course ${kind}`} items={[{ label: `Connect existing ${kind}`, icon: 'courses', onSelect: () => setManage(kind) }, { label: kind === 'books' ? 'Add a book' : kind === 'notes' ? 'Write a note' : 'Create a flashcard', icon: 'plus', to: addPath(kind, course._id) }]} />
        </>}</div>
      </header>
      {!data[kind].length ? <div className="course-empty-material"><span><Icon name={materialIcons[kind]} size={25} /></span><h4>No {kind} in this course yet</h4><p>{kind === 'books' ? 'Keep your reading list here, ready for your next session.' : kind === 'notes' ? 'A space for lecture notes, ideas, and connections.' : 'Turn what you learn into a little recall practice.'}</p><div className="actions">{overview ? <Link className="study-open-link" to={`?tab=${kind}`}>Set up {kind}</Link> : <><button className="btn secondary small" onClick={() => setManage(kind)}>Connect existing {kind}</button><Link className="btn primary small" to={addPath(kind, course._id)}>{kind === 'notes' ? 'Write your first note' : 'Create new'}</Link></>}</div></div> : !items.length ? <p className="course-no-results">No matching {kind}. Try another search.</p> : <div className={`course-material-grid course-material-grid--${kind}`}>{(overview ? items.slice(0, 3) : items).map(item => {
        const inherited = !courseIds(item.courses).includes(course._id);
        const isCard = 'question' in item;
        const title = isCard ? item.question : item.title;
        const edit = isCard ? `/flashcards/edit/${item._id}` : `/${kind}/${item._id}/edit`;
        return <article className="course-material-card" key={item._id}>
          {kind === 'books' && 'author' in item && <Link className="course-reading-cover" to={`/books/${item._id}?course=${course._id}`} aria-label={`Explore ${item.title}`}><BookCover book={item} compact /></Link>}
          <div className="course-material-card-top"><span className="study-course-material-label"><Icon name={materialIcons[kind]} size={18} /><span>{inherited ? 'Via related book' : 'In this course'}</span></span><ItemActions title={title} kind={isCard ? 'flashcard' : kind === 'books' ? 'book' : 'note'} editTo={`${edit}?course=${course._id}`} extra={[{ label: 'Course assignments', icon: 'courses', onSelect: () => setManage(kind) }]} /></div>
          {isCard ? <FlashcardFlip card={item} headingLevel={4} /> : <h4><Link to={`/${kind}/${item._id}?course=${course._id}`}>{title}</Link></h4>}
          {'author' in item && <p>{item.author}</p>}{'content' in item && <p className="course-material-preview">{item.content.replace(/\s+/g, ' ').slice(0, 160)}</p>}
          {'book' in item && typeof item.book === 'object' && item.book && <Link className="course-material-book" to={`/books/${item.book._id}?course=${course._id}`}><Icon name="book" size={15} />{item.book.title}</Link>}
          {isCard && item.tags.length > 0 && <div className="course-material-book-links">{item.tags.map(book => typeof book === 'object' && <Link className="course-material-book" key={book._id} to={`/books/${book._id}?course=${course._id}`}><Icon name="book" size={15} />{book.title}</Link>)}</div>}
          {!isCard && <footer><Link to={`/${kind}/${item._id}?course=${course._id}`} className="study-open-link">{kind === 'notes' ? 'Read note' : 'Open book'}</Link></footer>}
        </article>;
      })}</div>}
    </section>;
  }
  return <>
    <Link className="course-back-link" to="/courses"><Icon name="courses" size={16} />All courses</Link>
    <section className={`course-hero course-tone--${course.color} study-course-hero`}>
      <div className="study-course-options"><ItemActions title={course.title} kind="course" editTo={`/courses/${course._id}/edit`} deletePath={`/courses/${course._id}`} description={removeDescription} onDeleted={() => navigate('/courses')} /></div>
      <div className="course-hero-copy"><span className="course-hero-kicker"><Icon name="courses" size={20} />{course.code || 'Your course'}</span><h2>{course.title}</h2><div className="course-hero-meta">{course.term && <span>{course.term}</span>}{course.instructor && <span>{course.instructor}</span>}</div><p>{course.description || 'Your books, notes, and practice. Connected around one subject.'}</p>
        <div className="actions">{flashcards.length > 0 ? <><button className="btn primary" onClick={() => setReview(flashcards)}><Icon name="cards" size={18} />Review cards</button><Link className="study-secondary-action" to={quizTo}><Icon name="play" size={18} />Take a quiz</Link></> : notes.length > 0 ? <Link className="btn primary" to="?tab=notes">Explore your notes</Link> : books.length > 0 ? <Link className="btn primary" to="?tab=books">Explore your reading</Link> : <p className="study-course-welcome">Start with your reading list, a thought, or something worth remembering.</p>}</div>
      </div><div className="course-hero-symbol" aria-hidden="true"><Icon name="courses" size={98} /><i /><i /></div>
    </section>
    <nav className="course-learning-path" aria-label="Explore this course">{materialKinds.map((kind, index) => <Link key={kind} className="course-path-step" to={`?tab=${kind}`} onClick={() => setQuery('')}><span className="course-path-number">0{index + 1}</span><span className={`stat-icon stat-icon--${kind}`}><Icon name={materialIcons[kind]} size={23} /></span><div><strong>{kind === 'books' ? 'Read & explore' : kind === 'notes' ? 'Think & connect' : 'Recall & practice'}</strong><p>{data[kind].length} {materialLabels[kind].toLowerCase()} to {kind === 'books' ? 'discover' : kind === 'notes' ? 'revisit' : 'review'}</p></div><Icon name="connections" size={18} /></Link>)}</nav>
    <nav className="course-tabs" aria-label="Course materials">{['overview', ...materialKinds].map(name => <Link key={name} to={name === 'overview' ? '.' : `?tab=${name}`} onClick={() => setQuery('')} aria-current={tab === name ? 'page' : undefined}>{name === 'overview' ? 'Overview' : materialLabels[name as MaterialKind]}</Link>)}</nav>
    {tab !== 'overview' && <div className="course-material-search"><SearchField label={`Search course ${tab}`} value={query} onChange={setQuery} /></div>}
    {tab === 'overview' ? <div className="course-overview">{materialKinds.map(kind => materialSection(kind, true))}</div> : materialSection(tab as MaterialKind)}
    {manage && <ManageMaterials kind={manage} course={course} onClose={() => setManage(null)} onSaved={reload} />}
    {review && review.length > 0 && <FlashcardReview cards={review} quizTo={quizTo} onClose={() => setReview(null)} />}
    {(notes.length > 0 || flashcards.length > 0 || books.length > 0) && <p className="course-footnote">Shared materials stay connected across courses. Notes and flashcards from a related book are included automatically.</p>}
  </>;
}
