import {lazy,Suspense} from 'react';
import { Link } from 'react-router-dom';
import { useResource } from '../hooks/useResource';
import type { DashboardData } from '../types';
import { Loading, LoadError } from '../components/Feedback';
import { PageHeader, EmptyState, BookCover } from '../components/PageElements';
import { Icon } from '../components/Icon';
import { OrbitScene } from '../components/OrbitScene';

const LearningWidget=lazy(()=>import('./learning/LearningWidget'));
export function Dashboard() {
  const { data, loading, error, reload } = useResource<DashboardData>('/dashboard');
  if (loading) { return <Loading />; }
  if (error || !data) { return <LoadError message={error || 'Could not load dashboard.'} retry={reload} />; }
  const stats = [
    { title: 'Courses you’re exploring', value: data.courses?.length || 0, icon: 'courses' as const, to: '/courses', tone: 'blue' },
    { title: 'Books in your library', value: data.books.length, icon: 'book' as const, to: '/books', tone: 'violet' },
    { title: 'Notes & ideas', value: data.notes.length, icon: 'note' as const, to: '/notes', tone: 'peach' },
    { title: 'Flashcards to practice', value: data.flashcardsCount, icon: 'cards' as const, to: '/flashcards/list', tone: 'mint' },
  ];
  return <>
    <PageHeader title="Dashboard" description="A clear space for everything you’re learning." />
    <section className="welcome-hero"><div className="hero-grid" /><div className="hero-copy"><span className="eyebrow hero-eyebrow"><span />A little curiosity. A lot of possibility.</span><h3>Make your next<br />connection.</h3><p>Your reading, your ideas, a little practice.<br className="desktop-break" /> Pick up something worth understanding.</p>{data.notes[0] && <Link className="dashboard-resume" to={`/notes/${data.notes[0]._id}`}><span className="dashboard-resume-icon"><Icon name="note" size={22} /></span><span><small>Your latest note</small><strong>{data.notes[0].title}</strong><span>Return to this idea</span></span><Icon name="book" size={21} /></Link>}<div className="actions"><Link className="btn primary" to={data.flashcardsCount ? '/flashcards/list?review=1' : '/notes/add'}><Icon name={data.flashcardsCount ? 'cards' : 'edit'} size={17} />{data.flashcardsCount ? 'Start a review' : 'Write a note'}</Link><Link className="btn ghost" to="/courses">Explore your courses</Link></div></div><OrbitScene /></section>
    <Suspense fallback={null}><LearningWidget/></Suspense>
    <div className="stats-grid stats-grid--courses study-overview-strip">{stats.map((stat) => <Link className={`stat-card stat-card--${stat.tone}`} key={stat.title} to={stat.to}><span className="stat-icon"><Icon name={stat.icon} size={22} /></span><div><strong>{stat.value}</strong><span>{stat.title}</span></div></Link>)}</div>
    <section className="panel dashboard-courses"><header className="panel-heading"><div><span className="eyebrow">Everything, connected</span><h3>Your courses</h3></div><Link className="text-link" to="/courses">View courses</Link></header>{data.courses?.length ? <div className="dashboard-course-grid">{data.courses.slice(0, 3).map(course => <Link className={`dashboard-course course-tone--${course.color}`} to={`/courses/${course._id}`} key={course._id}><span><Icon name="courses" size={24} /></span><div><small>{course.code || course.term || 'Course'}</small><h4>{course.title}</h4><p>{course.counts?.books || 0} books · {course.counts?.notes || 0} notes · {course.counts?.flashcards || 0} flashcards</p></div></Link>)}</div> : <EmptyState icon="courses" title="Give each subject a home" description="Organize your books, notes, and flashcards into courses. Your existing materials are ready to connect." to="/courses/add" label="Add a course" />}</section>
    <div className="dashboard-main-grid"><section className="panel recent-notes" id="notes"><header className="panel-heading"><div><span className="eyebrow">Catch that thought</span><h3>Recent notes</h3></div><Link className="text-link" to="/notes">View all notes</Link></header>
      {data.notes.length ? <div className="note-rows">{data.notes.slice(0, 4).map((note) => <Link className="note-row" key={note._id} to={`/notes/${note._id}`}><span className="note-row-icon"><Icon name="note" /></span><div><h4>{note.title}</h4><p>{note.content.replace(/\s+/g, ' ').slice(0, 100)}</p></div><span className="note-word-count">{note.content.trim().split(/\s+/).filter(Boolean).length} words</span></Link>)}</div> : <EmptyState icon="note" title="A home for your next idea" description="Write a standalone note or connect one to a book." to="/notes/add" label="Add note" />}
    </section><section className="practice-panel"><span className="practice-icon"><Icon name="play" size={31} /></span><span className="eyebrow">Make it stick</span><h3>A small session.<br />A stronger memory.</h3><p>{data.flashcardsCount ? `${data.flashcardsCount} ${data.flashcardsCount === 1 ? 'flashcard is' : 'flashcards are'} ready when you are. Choose a course or book and put your knowledge to the test.` : 'Turn something you learned into a question. Your first flashcard is a good place to start.'}</p><Link className="btn practice-button" to={data.flashcardsCount ? '/flashcards/quiz' : '/flashcards/new'}><Icon name={data.flashcardsCount ? 'play' : 'plus'} size={18} />{data.flashcardsCount ? 'Start a quiz' : 'Create a flashcard'}</Link><div className="practice-decoration" aria-hidden="true"><i /><i /><i /></div></section></div>
    <section className="panel bookshelf-panel" id="books"><header className="panel-heading"><div><span className="eyebrow">Keep your references close</span><h3>On your bookshelf</h3></div><Link className="text-link" to="/books">View library</Link></header>{data.books.length ? <div className="bookshelf">{data.books.slice(0, 4).map((book) => <Link className="bookshelf-item" to={`/books/${book._id}`} key={book._id}><BookCover book={book} compact /><h4>{book.title}</h4><p>{book.author}</p></Link>)}</div> : <EmptyState icon="book" title="Your bookshelf starts here" description="Keep books and study resources together, ready for your next session." to="/books/add" label="Add book" />}</section>
  </>;
}
