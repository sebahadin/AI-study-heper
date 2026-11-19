import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useResource } from '../../hooks/useResource';
import { api, ApiError, errorMessage } from '../../services/api';
import type { Book, FieldErrors } from '../../types';
import { ErrorBanner, Field, Loading, LoadError } from '../../components/Feedback';
import { PageHeader } from '../../components/PageElements';

function BookForm({ book }: { book?: Book }) {
  const navigate = useNavigate();
  const [values, setValues] = useState({ title: book?.title || '', author: book?.author || '', category: book?.category || '', description: book?.description || '', url: book?.url || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<FieldErrors>({});
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setFields({});
    try {
      const result = await api<{ book: Book }>(book ? `/books/${book._id}` : '/books', { method: book ? 'PATCH' : 'POST', body: values });
      navigate(`/books/${result.book._id}`);
    } catch (reason) { setError(errorMessage(reason)); if (reason instanceof ApiError) { setFields(reason.fields); } }
    finally { setBusy(false); }
  }
  return <><PageHeader eyebrow="Your personal library" title={book ? 'Edit book' : 'Add a book'} description="A good reference is worth keeping close." /><form className="form-container" onSubmit={submit}>
    <ErrorBanner message={error} />
    {(['title', 'author', 'category'] as const).map((name) => <Field key={name} name={name} label={name === 'title' ? 'Book title' : name === 'author' ? 'Author' : 'Category'} error={fields[name]}><input id={name} name={name} required value={values[name]} onChange={(e) => setValues({ ...values, [name]: e.target.value })} /></Field>)}
    <Field name="description" label="Description (optional)" error={fields.description}><textarea id="description" name="description" value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} /></Field>
    <Field name="url" label="Book URL (optional)" error={fields.url}><input id="url" name="url" type="url" placeholder="https://example.com" value={values.url} onChange={(e) => setValues({ ...values, url: e.target.value })} /></Field>
    <div className="actions"><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save book'}</button><Link className="btn secondary" to={book ? `/books/${book._id}` : '/books'}>Cancel</Link></div>
  </form></>;
}

export function BookEditor() {
  const { id } = useParams();
  const { data, loading, error, reload } = useResource<{ book: Book }>(id ? `/books/${id}` : null);
  if (loading) { return <Loading />; }
  if (error || (id && !data)) { return <LoadError message={error || 'Book not found.'} retry={reload} />; }
  return <BookForm key={id || 'new'} book={data?.book} />;
}

export function BookDetail() {
  const { id } = useParams();
  const { data, loading, error, reload } = useResource<{ book: Book }>(`/books/${id}`);
  if (loading) { return <Loading />; }
  if (error || !data) { return <LoadError message={error || 'Book not found.'} retry={reload} />; }
  const { book } = data;
  const safeUrl = book.url && /^https?:\/\//i.test(book.url) ? book.url : null;
  return <section className="section detail-view"><header className="detail-header"><p className="eyebrow">Book</p><h2>{book.title}</h2><p className="detail-subtitle">by {book.author}</p></header>
    <dl className="detail-grid"><div><dt>Category</dt><dd>{book.category}</dd></div>{safeUrl && <div><dt>Link</dt><dd><a href={safeUrl} target="_blank" rel="noopener noreferrer">Visit book site</a></dd></div>}</dl>
    <article className="detail-body"><h3>Summary</h3><p className="preserve-lines">{book.description || 'No description added.'}</p></article>
    <div className="actions"><Link className="btn secondary" to="/books">Back to books</Link><Link className="details-btn" to={`/books/${book._id}/edit`}>Edit book</Link></div>
  </section>;
}
