import { Link } from 'react-router-dom';
import type { DocumentOptions, StudyDocument } from '../../types';
import { documentCourses, documentQuery, documentStatus, fileSize } from '../../services/documents';
import { useResource } from '../../hooks/useResource';
import { CourseBadges } from '../CourseFields';
import { Icon } from '../Icon';
import { ItemActions } from '../ItemActions';
import { ErrorBanner } from '../Feedback';

export function DocumentBadge({ status }: { status: StudyDocument['status'] }) {
  return <span className={`document-status document-status--${status}`}><Icon name={status === 'uploaded' ? 'check' : status === 'validating' ? 'clock' : 'file'} size={14} />{documentStatus(status)}</span>;
}

export function DocumentCard({ document, options, onRemoved }: { document: StudyDocument; options?: DocumentOptions | null; onRemoved?: () => void }) {
  return <article className="document-card" aria-label={document.title}>
    <div className="document-card-top"><DocumentBadge status={document.status} />{onRemoved && <ItemActions kind="document" title={document.title} deletePath={`/documents/${document._id}`} onDeleted={onRemoved} description="This removes the PDF and its document record. Your books, courses, and notes will stay." />}</div>
    <Link className="document-card-main" to={`/documents/${document._id}`}>
      <div className="document-paper" aria-hidden="true"><span className="document-paper-label">PDF</span><i /><i /><i /><span className="document-paper-pages">{document.pageCount ? `${document.pageCount} ${document.pageCount === 1 ? 'page' : 'pages'}` : 'Study material'}</span></div>
      <h3>{document.title}</h3><p className="document-filename">{document.filename}</p>
    </Link>
    <CourseBadges courses={documentCourses(document, options)} />
    <footer><span>{document.byteCount ? fileSize(document.byteCount) : 'Not confirmed yet'}</span>{document.status === 'uploaded' ? <a className="text-link" href={`/api/documents/${document._id}/file`} target="_blank" rel="noopener noreferrer">Open PDF<span className="sr-only">: {document.title} (new tab)</span></a> : <Link className="text-link" to={`/documents/${document._id}`}>View status</Link>}</footer>
  </article>;
}

export function LinkedDocuments({ scope, title }: { scope: { course?: string; book?: string; note?: string }; title: string }) {
  const query = documentQuery(new URLSearchParams(Object.entries(scope).filter((entry): entry is [string, string] => Boolean(entry[1]))));
  const { data, loading, error, reload } = useResource<{ documents: StudyDocument[] }>(`/documents?${query}`);
  const documents = data?.documents || [];
  return <section className="explore-section linked-documents" aria-label={title}>
    <header><div><span className="eyebrow">Your original readings</span><h3>{title}</h3></div><Link className="study-secondary-action" to={`/documents?${query}`}>View PDFs</Link></header>
    {loading ? <p role="status">Loading PDFs…</p> : error ? <><ErrorBanner message={error} /><button className="btn secondary small" onClick={reload}>Retry PDFs</button></> : documents.length ? <div className="linked-document-list">{documents.slice(0, 3).map(item => <Link key={item._id} to={`/documents/${item._id}`}><span className="linked-document-icon"><Icon name="file" /></span><span><strong>{item.title}</strong><small>{item.pageCount ? `${item.pageCount} pages` : documentStatus(item.status)}</small></span></Link>)}</div> : <div className="document-linked-empty"><Icon name="file" size={26} /><p>Keep a handout, article, or set of slides alongside these ideas.</p><Link className="btn secondary small" to={`/documents/upload?${query}`}>Upload a PDF</Link></div>}
  </section>;
}
