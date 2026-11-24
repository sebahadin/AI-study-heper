import { CourseDiscovery, groupByCourse } from '../../components/CourseDiscovery';
import { CourseBadges, effectiveCourses } from '../../components/CourseFields';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useResource } from '../../hooks/useResource';
import type { BookRef, Note } from '../../types';
import { Loading, LoadError } from '../../components/Feedback';
import { ItemActions } from '../../components/ItemActions';
import { EmptyState, PageHeader, SearchField } from '../../components/PageElements';
import { Icon } from '../../components/Icon';

export function NoteList() {
  const [params, setParams] = useSearchParams();
  const course = params.get('course') || '';
  const courseQuery = course && course !== 'none' ? `?course=${encodeURIComponent(course)}` : '';
  const changeCourse = (value: string) => { const next = new URLSearchParams(params); if (value) { next.set('course', value); } else { next.delete('course'); } setParams(next); setBookFilter(''); };
  const { data, loading, error, reload } = useResource<{ notes: Note[] }>(`/notes${course ? `?course=${encodeURIComponent(course)}` : ''}`);
  const [layout, setLayout] = useState<'courses' | 'all'>('courses');
  const [query, setQuery] = useState('');
  const [bookFilter, setBookFilter] = useState('');
  if (loading) { return <Loading />; }
  if (error || !data) { return <LoadError message={error || 'Could not load notes.'} retry={reload} />; }
  const bookOf = (note: Note): BookRef | null => typeof note.book === 'object' ? note.book : null;
  const books = [...new Map(data.notes.map(bookOf).filter((book): book is BookRef => Boolean(book)).map(book => [book._id, book])).values()];
  const filtered = data.notes.filter(note => {
    const book = bookOf(note);
    return (!bookFilter || (bookFilter === 'standalone' ? !book : book?._id === bookFilter)) && `${note.title} ${note.content} ${book?.title || ''}`.toLowerCase().includes(query.trim().toLowerCase());
  });
  const groups = groupByCourse(filtered);
  const grouped = layout === 'courses' && !course && !query.trim() && !bookFilter && groups.some(group => group.course);
  function renderNote(note: Note) {

      const book = bookOf(note);
      return <article className="note-card collection-card study-note-card" key={note._id}>
        <div className="note-card-top"><span className="note-card-icon"><Icon name="note" /></span><span className={`tag${book ? '' : ' tag--muted'}`}>{book?.title || 'Personal notebook'}</span><ItemActions title={note.title} kind="note" editTo={`/notes/${note._id}/edit${courseQuery}`} deletePath={`/notes/${note._id}`} onDeleted={reload} /></div>
        <h3><Link to={`/notes/${note._id}${courseQuery}`}>{note.title}</Link></h3><CourseBadges courses={effectiveCourses(note)} /><p className="note-preview">{note.content}</p>
        <footer className="note-card-footer"><span>{note.content.trim().split(/\s+/).filter(Boolean).length} words</span><Link className="study-open-link" to={`/notes/${note._id}${courseQuery}`}>Read note</Link></footer>
      </article>;

  }
  return <>
    <PageHeader eyebrow="Think it through" title="Notes" description="Revisit an idea. Make a connection. Give your next thought some space." action={<Link className="btn primary" to={`/notes/add${courseQuery}`}><Icon name="edit" size={17} />Write a note</Link>} />
    <CourseDiscovery kind="notes" value={course} onChange={changeCourse} />
    <div className="collection-toolbar"><SearchField label="Search notes" value={query} onChange={setQuery} /><label className="filter-select"><span className="sr-only">Filter notes by book</span><select value={bookFilter} onChange={event => setBookFilter(event.target.value)}><option value="">All notes</option><option value="standalone">Standalone notes</option>{books.map(book => <option key={book._id} value={book._id}>{book.title}</option>)}</select></label><span className="collection-count">{filtered.length} {filtered.length === 1 ? 'note' : 'notes'}</span></div>
    {data.notes.length > 0 && !course && <div className="collection-layout-choice"><div role="group" aria-label="Note layout"><button aria-pressed={layout === 'courses'} onClick={() => setLayout('courses')}>By course</button><button aria-pressed={layout === 'all'} onClick={() => setLayout('all')}>All notes</button></div><span>Notes follow their own courses and their related book.</span></div>}
    {!data.notes.length ? <EmptyState icon="note" title="Start with a thought" description="Write freely, capture an insight, or take notes on a book. This space is yours." to={`/notes/add${courseQuery}`} label="Write your first note" /> : !filtered.length ? <div className="panel"><EmptyState icon="search" title="No matching notes" description="Try another phrase or change the book filter." /><button className="btn secondary" onClick={() => { setQuery(''); setBookFilter(''); }}>Clear filters</button></div> : grouped ? <div className="material-course-sections">{groups.map(group => <section className="material-course-section" key={group.course?._id || 'none'}><header><div><span className="eyebrow">{group.course?.code || (group.course ? 'Course notes' : 'Your own space')}</span><h3>{group.course?.title || 'Personal notebook'}</h3></div><div className="actions">{group.items.length > 3 && <button className="text-link" onClick={() => changeCourse(group.course?._id || 'none')}>See all notes</button>}{group.course && <Link className="study-secondary-action" to={`/courses/${group.course._id}`}>Explore course<Icon name="connections" size={17} /></Link>}</div></header><div className="notes-grid study-notes-grid">{group.items.slice(0, 3).map(renderNote)}</div></section>)}</div> : <div className="notes-grid study-notes-grid">{filtered.map(renderNote)}</div>}

  </>;
}
