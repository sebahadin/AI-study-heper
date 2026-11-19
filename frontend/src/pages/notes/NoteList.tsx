import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useResource } from '../../hooks/useResource';
import type { BookRef, Note } from '../../types';
import { Loading, LoadError } from '../../components/Feedback';
import { DeleteButton } from '../../components/DeleteButton';
import { EmptyState, PageHeader, SearchField } from '../../components/PageElements';
import { Icon } from '../../components/Icon';

export function NoteList() {
  const { data, loading, error, reload } = useResource<{ notes: Note[] }>('/notes');
  const [query, setQuery] = useState('');
  const [bookFilter, setBookFilter] = useState('');
  if (loading) { return <Loading />; }
  if (error || !data) { return <LoadError message={error || 'Could not load notes.'} retry={reload} />; }
  const bookOf = (note: Note): BookRef | null => typeof note.book === 'object' ? note.book : null;
  const books = [...new Map(data.notes.map(bookOf).filter((book): book is BookRef => Boolean(book)).map((book) => [book._id, book])).values()];
  const filtered = data.notes.filter((note) => {
    const book = bookOf(note);
    return (!bookFilter || (bookFilter === 'standalone' ? !book : book?._id === bookFilter)) && `${note.title} ${note.content} ${book?.title || ''}`.toLowerCase().includes(query.trim().toLowerCase());
  });
  return <>
    <PageHeader eyebrow="Thoughts worth keeping" title="Notes" description="A place for the things you don’t want to forget." action={<Link className="btn primary" to="/notes/add"><Icon name="plus" size={17} />Add note</Link>} />
    <div className="collection-toolbar"><SearchField label="Search notes" value={query} onChange={setQuery} /><label className="filter-select"><span className="sr-only">Filter notes by book</span><select value={bookFilter} onChange={(e) => setBookFilter(e.target.value)}><option value="">All notes</option><option value="standalone">Standalone notes</option>{books.map((book) => <option key={book._id} value={book._id}>{book.title}</option>)}</select></label><span className="collection-count">{filtered.length} {filtered.length === 1 ? 'note' : 'notes'}</span></div>
    {!data.notes.length ? <EmptyState icon="note" title="Start with a thought" description="Write freely, capture an insight, or take notes on a book. This space is yours." to="/notes/add" label="Write your first note" /> : !filtered.length ? <div className="panel"><EmptyState icon="search" title="No matching notes" description="Try another phrase or change the book filter." /><button className="btn secondary" onClick={() => { setQuery(''); setBookFilter(''); }}>Clear filters</button></div> : <div className="notes-grid">{filtered.map((note) => {
      const book = bookOf(note);
      return <article className="note-card collection-card" key={note._id}><div className="note-card-top"><span className="note-card-icon"><Icon name="note" /></span><span className={`tag${book ? '' : ' tag--muted'}`}>{book?.title || 'Standalone note'}</span></div><h3><Link to={`/notes/${note._id}`}>{note.title}</Link></h3><p className="note-preview">{note.content}</p><footer className="note-card-footer"><span>{note.content.trim().split(/\s+/).filter(Boolean).length} words</span><div className="card-actions"><Link className="btn secondary small" to={`/notes/${note._id}`}>Read</Link><Link className="btn secondary small" to={`/notes/${note._id}/edit`}>Edit</Link><DeleteButton title={note.title} path={`/notes/${note._id}`} onDeleted={reload} /></div></footer></article>;
    })}</div>}
  </>;
}
