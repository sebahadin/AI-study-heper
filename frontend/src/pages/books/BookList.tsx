import { CourseDiscovery, groupByCourse } from '../../components/CourseDiscovery';
import { CourseBadges, effectiveCourses } from '../../components/CourseFields';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useResource } from '../../hooks/useResource';
import type { Book } from '../../types';
import { Loading, LoadError } from '../../components/Feedback';
import { ItemActions } from '../../components/ItemActions';
import { BookCover, EmptyState, PageHeader, SearchField } from '../../components/PageElements';
import { Icon } from '../../components/Icon';

export function BookList() {
  const [params, setParams] = useSearchParams();
  const course = params.get('course') || '';
  const courseQuery = course && course !== 'none' ? `?course=${encodeURIComponent(course)}` : '';
  const changeCourse = (value: string) => { const next = new URLSearchParams(params); if (value) { next.set('course', value); } else { next.delete('course'); } setParams(next); setCategory(''); };
  const { data, loading, error, reload } = useResource<{ books: Book[] }>(`/books${course ? `?course=${encodeURIComponent(course)}` : ''}`);
  const [layout, setLayout] = useState<'courses' | 'all'>('courses');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  if (loading) { return <Loading />; }
  if (error || !data) { return <LoadError message={error || 'Could not load books.'} retry={reload} />; }
  const categories = [...new Set(data.books.map(book => book.category))].filter(Boolean).sort();
  const search = query.trim().toLowerCase();
  const filtered = data.books.filter(book => (!category || book.category === category) && `${book.title} ${book.author} ${book.category} ${book.description || ''}`.toLowerCase().includes(search));
  const groups = groupByCourse(filtered);
  const grouped = layout === 'courses' && !course && !search && !category && groups.some(group => group.course);
  function renderBook(book: Book, featuredCard = false, shelfCourse = course) {
    const shelfQuery = shelfCourse && shelfCourse !== 'none' ? `?course=${encodeURIComponent(shelfCourse)}` : '';

      const featured = featuredCard;
      return <article className={`book-card collection-card study-book-card${featured ? ' study-book-card--featured' : ''}`} key={book._id}>
        <div className="study-card-options"><ItemActions title={book.title} kind="book" editTo={`/books/${book._id}/edit${shelfQuery}`} deletePath={`/books/${book._id}`} description="Its notes and flashcards will be kept, with their book links removed." onDeleted={reload} /></div>
        <Link to={`/books/${book._id}${shelfQuery}`} className="book-card-cover" aria-label={`Open ${book.title}`}><BookCover book={book} /></Link>
        <div className="book-card-body">{featured && <p className="study-feature-label">On your reading desk</p>}<span className="category-label">{book.category}</span><h3><Link to={`/books/${book._id}${shelfQuery}`}>{book.title}</Link></h3><p className="study-book-author">{book.author}</p>{book.description && <p className="study-book-description">{book.description}</p>}<CourseBadges courses={effectiveCourses(book)} /><div className="study-book-links"><Link className={featured ? 'btn primary' : 'study-open-link'} to={`/books/${book._id}${shelfQuery}`}>Open book</Link><Link className="study-note-link" to={`/notes/add?book=${book._id}${shelfQuery ? `&course=${encodeURIComponent(shelfCourse)}` : ''}`} aria-label={`Take notes on ${book.title}`}><Icon name="note" size={17} /><span>Take notes</span></Link></div></div>
      </article>;

  }
  return <>
    <PageHeader eyebrow="Your reading space" title="Books" description="Find a reference, follow an idea, and turn your reading into understanding." />
    <CourseDiscovery kind="books" value={course} onChange={changeCourse} />
    <div className="collection-toolbar"><SearchField label="Search books" value={query} onChange={setQuery} /><label className="filter-select"><span className="sr-only">Filter by category</span><select value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label><span className="collection-count">{filtered.length} {filtered.length === 1 ? 'book' : 'books'}</span></div>
    {data.books.length > 0 && !course && <div className="collection-layout-choice"><div role="group" aria-label="Book layout"><button aria-pressed={layout === 'courses'} onClick={() => setLayout('courses')}>By course</button><button aria-pressed={layout === 'all'} onClick={() => setLayout('all')}>All books</button></div><span>Shared books can appear in more than one course.</span></div>}
    {!data.books.length ? <EmptyState icon="book" title="Build your own little library" description="Add a book or study resource, then connect notes and flashcards to it." to={`/books/add${courseQuery}`} label="Add your first book" /> : !filtered.length ? <div className="panel"><EmptyState icon="search" title="No books found" description="Try a different title, author, or category." /><button className="btn secondary" onClick={() => { setQuery(''); setCategory(''); }}>Clear filters</button></div> : grouped ? <div className="material-course-sections">{groups.map(group => <section className="material-course-section" key={group.course?._id || 'none'}><header><div><span className="eyebrow">{group.course?.code || (group.course ? 'Course reading' : 'Your own space')}</span><h3>{group.course?.title || 'Unassigned books'}</h3></div><div className="actions">{group.items.length > 3 && <button className="text-link" onClick={() => changeCourse(group.course?._id || 'none')}>See all books</button>}{group.course && <Link className="study-secondary-action" to={`/courses/${group.course._id}`}>Explore course<Icon name="connections" size={17} /></Link>}</div></header><div className="library-grid course-books-grid">{group.items.slice(0, 3).map(book => renderBook(book, false, group.course?._id || ''))}</div></section>)}</div> : <div className="library-grid study-library-grid">{filtered.map((book, index) => renderBook(book, index === 0 && !search && !category))}</div>}

  </>;
}
