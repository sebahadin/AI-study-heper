import { Link } from 'react-router-dom';
import { useResource } from '../hooks/useResource';
import type { DashboardData } from '../types';
import { Loading, LoadError } from '../components/Feedback';
import { PageHeader, EmptyState, BookCover } from '../components/PageElements';
import { Icon } from '../components/Icon';
import { OrbitScene } from '../components/OrbitScene';

export function Dashboard() {
  const { data, loading, error, reload } = useResource<DashboardData>('/dashboard');
  if (loading) { return <Loading />; }
  if (error || !data) { return <LoadError message={error || 'Could not load dashboard.'} retry={reload} />; }
  const stats = [
    { title: 'Books in your library', value: data.books.length, icon: 'book' as const, to: '/books', tone: 'violet' },
    { title: 'Notes & ideas', value: data.notes.length, icon: 'note' as const, to: '/notes', tone: 'peach' },
    { title: 'Flashcards to practice', value: data.flashcardsCount, icon: 'cards' as const, to: '/flashcards/list', tone: 'mint' },
  ];
  return <>
    <PageHeader title="Dashboard" description="A clear space for everything you’re learning." />
    <section className="welcome-hero"><div className="hero-grid" /><div className="hero-copy"><span className="eyebrow hero-eyebrow"><span />A little curiosity. A lot of possibility.</span><h3>Good ideas deserve<br />a little space.</h3><p>Collect what you read. Capture what you learn.<br className="desktop-break" /> Come back to what matters.</p><div className="actions"><Link className="btn primary" to="/notes/add"><Icon name="plus" size={17} />Write a note</Link><Link className="btn ghost" to="/books">Explore your books</Link></div></div><OrbitScene /></section>
    <div className="stats-grid">{stats.map((stat) => <Link className={`stat-card stat-card--${stat.tone}`} key={stat.title} to={stat.to}><span className="stat-icon"><Icon name={stat.icon} size={22} /></span><div><strong>{stat.value}</strong><span>{stat.title}</span></div></Link>)}</div>
    <div className="dashboard-main-grid"><section className="panel recent-notes" id="notes"><header className="panel-heading"><div><span className="eyebrow">Catch that thought</span><h3>Recent notes</h3></div><Link className="text-link" to="/notes">View all notes</Link></header>
      {data.notes.length ? <div className="note-rows">{data.notes.slice(0, 4).map((note) => <Link className="note-row" key={note._id} to={`/notes/${note._id}`}><span className="note-row-icon"><Icon name="note" /></span><div><h4>{note.title}</h4><p>{note.content.replace(/\s+/g, ' ').slice(0, 100)}</p></div><span className="note-word-count">{note.content.trim().split(/\s+/).filter(Boolean).length} words</span></Link>)}</div> : <EmptyState icon="note" title="A home for your next idea" description="Write a standalone note or connect one to a book." to="/notes/add" label="Add note" />}
    </section><section className="practice-panel"><span className="practice-icon"><Icon name="play" size={31} /></span><span className="eyebrow">Make it stick</span><h3>A small session.<br />A stronger memory.</h3><p>{data.flashcardsCount ? `${data.flashcardsCount} ${data.flashcardsCount === 1 ? 'flashcard is' : 'flashcards are'} ready when you are. Pick a book and put your knowledge to the test.` : 'Turn something you learned into a question. Your first flashcard is a good place to start.'}</p><Link className="btn practice-button" to={data.flashcardsCount ? '/flashcards/quiz' : '/flashcards/new'}><Icon name={data.flashcardsCount ? 'play' : 'plus'} size={18} />{data.flashcardsCount ? 'Start a quiz' : 'Create a flashcard'}</Link><div className="practice-decoration" aria-hidden="true"><i /><i /><i /></div></section></div>
    <section className="panel bookshelf-panel" id="books"><header className="panel-heading"><div><span className="eyebrow">Keep your references close</span><h3>On your bookshelf</h3></div><Link className="text-link" to="/books">View library</Link></header>{data.books.length ? <div className="bookshelf">{data.books.slice(0, 4).map((book) => <Link className="bookshelf-item" to={`/books/${book._id}`} key={book._id}><BookCover book={book} compact /><h4>{book.title}</h4><p>{book.author}</p></Link>)}</div> : <EmptyState icon="book" title="Your bookshelf starts here" description="Keep books and study resources together, ready for your next session." to="/books/add" label="Add book" />}</section>
  </>;
}
