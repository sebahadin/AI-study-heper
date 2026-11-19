import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useResource } from '../../hooks/useResource';
import type { Book } from '../../types';
import { Loading, LoadError } from '../../components/Feedback';
import { DeleteButton } from '../../components/DeleteButton';
import { BookCover, EmptyState, PageHeader, SearchField } from '../../components/PageElements';
import { Icon } from '../../components/Icon';

export function BookList() {
  const { data, loading, error, reload } = useResource<{ books: Book[] }>('/books');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  if (loading) { return <Loading />; }
  if (error || !data) { return <LoadError message={error || 'Could not load books.'} retry={reload} />; }
  const categories = [...new Set(data.books.map((book) => book.category))].filter(Boolean).sort();
  const search = query.trim().toLowerCase();
  const filtered = data.books.filter((book) => (!category || book.category === category) && `${book.title} ${book.author} ${book.category} ${book.description || ''}`.toLowerCase().includes(search));
  return <>
    <PageHeader eyebrow="Your personal library" title="Books" description="Good reads. Useful references. All in one place." action={<Link className="btn primary" to="/books/add"><Icon name="plus" size={17} />Add book</Link>} />
    <div className="collection-toolbar"><SearchField label="Search books" value={query} onChange={setQuery} /><label className="filter-select"><span className="sr-only">Filter by category</span><select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{categories.map((value) => <option key={value}>{value}</option>)}</select></label><span className="collection-count">{filtered.length} {filtered.length === 1 ? 'book' : 'books'}</span></div>
    {!data.books.length ? <EmptyState icon="book" title="Build your own little library" description="Add a book or study resource, then connect notes and flashcards to it." to="/books/add" label="Add your first book" /> : !filtered.length ? <div className="panel"><EmptyState icon="search" title="No books found" description="Try a different title, author, or category." /><button className="btn secondary" onClick={() => { setQuery(''); setCategory(''); }}>Clear filters</button></div> : <div className="library-grid">{filtered.map((book) => <article className="book-card collection-card" key={book._id}><Link to={`/books/${book._id}`} className="book-card-cover" aria-label={`Read ${book.title}`}><BookCover book={book} /></Link><div className="book-card-body"><span className="category-label">{book.category}</span><h3><Link to={`/books/${book._id}`}>{book.title}</Link></h3><p>{book.author}</p><div className="card-actions"><Link className="btn secondary small" to={`/books/${book._id}/edit`}>Edit</Link><DeleteButton title={book.title} path={`/books/${book._id}`} onDeleted={reload} /></div></div></article>)}</div>}
  </>;
}
