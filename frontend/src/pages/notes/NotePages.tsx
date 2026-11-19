import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useResource } from '../../hooks/useResource';
import { api, ApiError, errorMessage } from '../../services/api';
import type { Book, FieldErrors, Note } from '../../types';
import { ErrorBanner, Loading, LoadError } from '../../components/Feedback';
import { PageHeader } from '../../components/PageElements';
import { Icon } from '../../components/Icon';
import { NoteDocument } from '../../components/notes/NoteDocument';
import { NoteToolbar, RichTextEditor, useNoteEditor } from '../../components/notes/RichTextEditor';
import '../../styles/notes.css';
import { wordCount } from '../../components/notes/noteContent';

function NoteForm({ note, books }: { note?: Note; books: Book[] }) {
  const navigate = useNavigate();
  const bookId = typeof note?.book === 'string' ? note.book : note?.book?._id;
  const [values, setValues] = useState({ title: note?.title || '', content: note?.content || '', contentHtml: note?.contentHtml || null as string | null, book: bookId || '' });
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<'edit' | 'read'>('edit');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<FieldErrors>({});
  const editor = useNoteEditor(note || { content: '' }, (html, content) => {
    setValues((previous) => ({ ...previous, contentHtml: html, content })); setDirty(true);
    setFields((previous) => ({ ...previous, content: '' }));
  });
  useEffect(() => {
    if (!dirty) { return; }
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => { editor?.setEditable(!busy, false); }, [editor, busy]);
  useLayoutEffect(() => {
    const resizeTitle = () => {
      if (!titleRef.current || mode !== 'edit') { return; }
      titleRef.current.style.height = 'auto';
      titleRef.current.style.height = `${titleRef.current.scrollHeight}px`;
    };
    resizeTitle(); window.addEventListener('resize', resizeTitle);
    return () => window.removeEventListener('resize', resizeTitle);
  }, [values.title, mode]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) { return; }
    const invalid: FieldErrors = {};
    if (!values.title.trim()) { invalid.title = 'Give your note a title.'; }
    if (!values.content.replace(/[\s\u200B]/g, '')) { invalid.content = 'Write something in your note before saving.'; }
    if (Object.keys(invalid).length) { setFields(invalid); setMode('edit'); return; }
    setBusy(true); setError(''); setFields({});
    try {
      const result = await api<{ note: Note }>(note ? `/notes/${note._id}` : '/notes', { method: note ? 'PATCH' : 'POST', body: { ...values, book: values.book || null } });
      setDirty(false); navigate(`/notes/${result.note._id}`);
    } catch (reason) { setError(errorMessage(reason)); if (reason instanceof ApiError) { setFields(reason.fields); setMode('edit'); } }
    finally { setBusy(false); }
  }
  const relatedBook = books.find((book) => book._id === values.book);
  return <>
    <PageHeader eyebrow="Your writing space" title={note ? 'Edit note' : 'Add a note'} description="Room to think. Tools to make your ideas stand out." />
    <form className="note-workspace" noValidate onSubmit={submit} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.currentTarget.requestSubmit(); } }}>
      <div className="note-commandbar">
        <Link to="/notes" className="note-back-link"><span aria-hidden="true">←</span> All notes</Link>
        <div className="note-mode-switch" role="group" aria-label="Note mode"><button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>Edit</button><button type="button" aria-pressed={mode === 'read'} onClick={() => setMode('read')}>Read</button></div>
        <div className="note-save-actions"><span className={`note-save-status${dirty ? ' is-unsaved' : ''}`} role="status">{busy ? 'Saving…' : dirty ? 'Unsaved changes' : note ? 'Saved note' : 'New note'}</span><button type="submit" className="btn primary" disabled={busy}><Icon name="check" size={16} />{busy ? 'Saving…' : 'Save note'}</button></div>
      </div>
      <ErrorBanner message={error} />
      <div className="note-contextbar"><label htmlFor="note-book"><Icon name="book" size={16} /><span>Related book</span></label><select id="note-book" value={values.book} disabled={busy} onChange={(e) => { setValues({ ...values, book: e.target.value }); setDirty(true); }}><option value="">No linked book</option>{books.map((book) => <option key={book._id} value={book._id}>{book.title}</option>)}</select>{fields.book && <p className="form-error" role="alert">{fields.book}</p>}<span className="note-context-hint">{mode === 'read' ? 'Reading preview · includes your unsaved changes' : 'A little clarity, one page at a time.'}</span></div>
      {mode === 'edit' && editor && <NoteToolbar editor={editor} />}
      <div className="note-canvas">
        <article className={`note-paper${mode === 'read' ? ' is-reading' : ''}`} aria-label={mode === 'read' ? 'Note reading preview' : 'Note document'}>
          <div className="note-paper-kicker"><span>{relatedBook?.title || 'Personal notebook'}</span><span>{mode === 'read' ? 'Reading preview' : 'Make it your own'}</span></div>
          <div hidden={mode !== 'edit'}>
            <label className="sr-only" htmlFor="note-title">Note title</label><textarea ref={titleRef} rows={1} id="note-title" className="note-title-input" placeholder="Untitled note" value={values.title} disabled={busy} aria-invalid={Boolean(fields.title)} aria-describedby={fields.title ? 'note-title-error' : undefined} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); editor?.commands.focus('start'); } }} onChange={(e) => { setValues({ ...values, title: e.target.value.replace(/\r?\n/g, ' ') }); setDirty(true); setFields({ ...fields, title: '' }); }} />
            {fields.title && <p id="note-title-error" className="form-error" role="alert">{fields.title}</p>}
            <RichTextEditor editor={editor} invalid={Boolean(fields.content)} />
            {fields.content && <p id="note-content-error" className="form-error" role="alert">{fields.content}</p>}
          </div>
          {mode === 'read' && <><h2 className="note-document-title">{values.title || 'Untitled note'}</h2>{values.content.trim() ? <NoteDocument content={values.content} contentHtml={values.contentHtml} /> : <p className="note-empty-preview">Your ideas will appear here. Switch to Edit to start writing.</p>}</>}
          <footer className="note-paper-footer"><span>{wordCount(values.content)} words</span><span>Classmate · Notes</span></footer>
        </article>
      </div>
      <div className="note-bottom-bar"><span>{mode === 'edit' ? '⌘ / Ctrl + B bold · I italic · U underline · S save' : 'Reading preview keeps your current draft.'}</span><span>Click Save note to keep your changes.</span></div>
    </form>
  </>;
}

export function NoteEditor() {
  const { id } = useParams();
  const notes = useResource<{ note: Note }>(id ? `/notes/${id}` : null);
  const books = useResource<{ books: Book[] }>('/books');
  if (notes.loading || books.loading) { return <Loading />; }
  const error = notes.error || books.error;
  if (error || !books.data || (id && !notes.data)) { return <LoadError message={error || 'Could not load note editor.'} retry={() => { notes.reload(); books.reload(); }} />; }
  return <NoteForm key={id || 'new'} note={notes.data?.note} books={books.data.books} />;
}

export function NoteDetail() {
  const { id } = useParams();
  const { data, loading, error, reload } = useResource<{ note: Note }>(`/notes/${id}`);
  if (loading) { return <Loading />; }
  if (error || !data) { return <LoadError message={error || 'Note not found.'} retry={reload} />; }
  const { note } = data;
  const book = typeof note.book === 'object' ? note.book : null;
  const saved = note.updatedAt || note.createdAt;
  return <>
    <PageHeader eyebrow="Take a moment" title="Read note" description="A little space to revisit your ideas." />
    <section className="note-workspace" aria-label="Note reader">
      <div className="note-commandbar"><Link to="/notes" className="note-back-link"><span aria-hidden="true">←</span> All notes</Link><div className="note-mode-switch" role="group" aria-label="Note mode"><Link to={`/notes/${note._id}/edit`}>Edit</Link><span aria-current="page">Read</span></div><Link className="btn primary" to={`/notes/${note._id}/edit`}><Icon name="note" size={16} />Edit note</Link></div>
      <div className="note-contextbar">{book ? <Link className="note-related-book" to={`/books/${book._id}`}><Icon name="book" size={16} />{book.title}</Link> : <span>Personal notebook</span>}<span className="note-context-hint">{saved ? `Saved ${new Date(saved).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'Saved note'}</span></div>
      <div className="note-canvas"><article className="note-paper is-reading" aria-label="Note document"><div className="note-paper-kicker"><span>{book?.title || 'Personal notebook'}</span><span>Reading mode</span></div><h2 className="note-document-title">{note.title}</h2><NoteDocument content={note.content} contentHtml={note.contentHtml} /><footer className="note-paper-footer"><span>{wordCount(note.content)} words</span><span>Classmate · Notes</span></footer></article></div>
      <div className="note-bottom-bar"><span>Read, reflect, make a connection.</span><Link to={`/notes/${note._id}/edit`}>Continue writing <span aria-hidden="true">→</span></Link></div>
    </section>
  </>;
}
