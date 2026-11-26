import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useResource } from '../../hooks/useResource';
import { api, errorMessage } from '../../services/api';
import { documentCourses, fileSize } from '../../services/documents';
import type { DocumentOptions, StudyDocument } from '../../types';
import { DocumentBadge } from '../../components/documents/DocumentCards';
import { CourseBadges } from '../../components/CourseFields';
import { ErrorBanner, Loading, LoadError } from '../../components/Feedback';
import { PageHeader } from '../../components/PageElements';
import { ItemActions } from '../../components/ItemActions';
import { Icon } from '../../components/Icon';
import '../../styles/documents.css';

export function DocumentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useResource<{ document: StudyDocument }>(`/documents/${id}`);
  const options = useResource<DocumentOptions>('/documents/options');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  useEffect(() => {
    if (data?.document.status !== 'validating') return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 3000);
    return () => clearInterval(timer);
  }, [data?.document.status, reload]);
  async function check() {
    setBusy(true); setFailure('');
    try { await api(`/documents/${id}/complete`, { method: 'POST', body: {} }); }
    catch (reason) { setFailure(errorMessage(reason)); }
    finally { setBusy(false); reload(); }
  }
  if (loading && !data) return <Loading message="Opening your document…" />;
  if (error || !data) return <LoadError message={error || 'Document not found.'} retry={reload} />;
  const item = data.document;
  const book = options.data?.books.find(record => record._id === item.book);
  const note = options.data?.notes.find(record => record._id === item.note);
  const courses = documentCourses(item, options.data);
  const newUpload = new URLSearchParams();
  if (book) newUpload.set('book', book._id);
  if (note) newUpload.set('note', note._id);
  if (courses[0]) newUpload.set('course', courses[0]._id);
  return <>
    <Link className="document-back" to="/documents">All documents</Link>
    <PageHeader eyebrow="The original, kept close" title={item.title} description={item.filename} action={<ItemActions kind="document" title={item.title} deletePath={`/documents/${item._id}`} onDeleted={() => navigate('/documents')} description="This removes the original PDF and its document record. Linked courses, books, and notes will stay." />} />
    <section className="document-detail-hero"><div className="document-detail-cover"><div className="document-paper document-paper--large" aria-hidden="true"><span className="document-paper-label">PDF</span><i /><i /><i /><span className="document-paper-pages">{item.pageCount ? `${item.pageCount} ${item.pageCount === 1 ? 'page' : 'pages'}` : 'Your original file'}</span></div></div><div className="document-detail-copy"><DocumentBadge status={item.status} /><h3>{item.status === 'uploaded' ? 'Ready for a closer read.' : item.status === 'failed' ? 'This PDF needs another look.' : item.status === 'deleting' ? 'Finish removing this PDF.' : 'Let’s finish bringing this PDF in.'}</h3><p>{item.status === 'uploaded' ? 'Open the original pages, then follow an idea into your connected study materials.' : item.status === 'deleting' ? 'Removal was started. Use the actions menu to try again and finish cleaning up the file.' : item.status === 'failed' ? item.error?.message || 'The PDF could not be saved. Try another file.' : 'If the file finished uploading, check it again. If the upload was interrupted, start a new upload with your PDF.'}</p>
      <ErrorBanner message={failure} />
      <div className="actions">{item.status === 'uploaded' ? <a className="btn primary" href={`/api/documents/${item._id}/file`} target="_blank" rel="noopener noreferrer"><Icon name="eye" size={18} />Open PDF<span className="sr-only"> (new tab)</span></a> : ['awaiting_upload', 'validating'].includes(item.status) ? <button className="btn primary" disabled={busy} onClick={check}><Icon name="check" size={18} />{busy ? 'Checking…' : 'Check upload'}</button> : null}{item.status !== 'deleting' && <Link className="btn secondary" to={`/documents/upload${newUpload.size ? `?${newUpload}` : ''}`}>{item.status === 'uploaded' ? 'Upload another PDF' : 'Start a new upload'}</Link>}</div>
      <dl className="document-file-facts"><div><dt>Pages</dt><dd>{item.pageCount ?? 'Not checked yet'}</dd></div><div><dt>File size</dt><dd>{item.byteCount ? fileSize(item.byteCount) : 'Not confirmed yet'}</dd></div><div><dt>Added</dt><dd>{new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</dd></div></dl>
    </div></section>
    <section className="panel document-connections"><header className="panel-heading"><div><span className="eyebrow">Follow the subject</span><h3>Connected study materials</h3></div><Icon name="connections" size={24} /></header>{options.loading ? <p role="status">Loading connections…</p> : options.error ? <><ErrorBanner message="Connections could not load." /><button className="btn secondary small" onClick={options.reload}>Retry connections</button></> : <><CourseBadges courses={courses} /><div className="document-connection-links">{book && <Link to={`/books/${book._id}`}><Icon name="book" size={23} /><span><small>Related book</small><strong>{book.title}</strong></span></Link>}{note && <Link to={`/notes/${note._id}`}><Icon name="note" size={23} /><span><small>Related note</small><strong>{note.title}</strong></span></Link>}</div>{!courses.length && !book && !note && <p>This is an independent PDF in your library. It doesn’t need a book or course.</p>}</>}
    </section>
  </>;
}
