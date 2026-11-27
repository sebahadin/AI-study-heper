import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DocumentCard } from '../../components/documents/DocumentCards';
import { EmptyState, PageHeader, SearchField } from '../../components/PageElements';
import { ErrorBanner, Loading } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { useResource } from '../../hooks/useResource';
import { api, errorMessage } from '../../services/api';
import { documentQuery } from '../../services/documents';
import type { DocumentOptions, DocumentPage, StudyDocument, IndexingState } from '../../types';
import '../../styles/documents.css';

export function DocumentLibrary() {
  const [params, setParams] = useSearchParams();
  const fromUrl = documentQuery(params);
  const [query, setQuery] = useState(fromUrl);
  const generation = useRef(0);
  const options = useResource<DocumentOptions>('/documents/options');
  const [documents, setDocuments] = useState<StudyDocument[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  const pollCursor = useRef(0);
  useEffect(() => { const timer = setTimeout(() => setQuery(fromUrl), 250); return () => clearTimeout(timer); }, [fromUrl]);
  useEffect(() => {
    let active = true;
    const version = ++generation.current;
    setLoading(true); setMore(false); setError(''); setDocuments([]); setNext(null);
    api<DocumentPage>(`/documents${query ? `?${query}` : ''}`)
      .then(result => { if (active) { setDocuments(result.documents); setNext(result.nextCursor); } })
      .catch(reason => { if (active) setError(errorMessage(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; generation.current = version + 1; };
  }, [query, revision]);
  async function loadMore() {
    if (!next || more) return;
    const version = generation.current;
    setMore(true); setError('');
    try {
      const page = new URLSearchParams(query); page.set('before', next);
      const result = await api<DocumentPage>(`/documents?${page}`);
      if (version !== generation.current) return;
      setDocuments(previous => [...new Map([...previous, ...result.documents].map(item => [item._id, item])).values()]); setNext(result.nextCursor);
    } catch (reason) { if (version === generation.current) setError(errorMessage(reason)); }
    finally { if (version === generation.current) setMore(false); }
  }
  function select(name: string, value: string) {
    const updated = new URLSearchParams(params);
    if (value) updated.set(name, value); else updated.delete(name);
    setParams(updated, { replace: name === 'q' });
  }
  function clear() { setParams({}); }
  useEffect(() => {
    const pending = documents.filter(item => ['queued', 'processing'].includes(item.indexing?.status || ''));
    if (!pending.length) return;
    let active = true;
    let polling = false;
    const timer = setInterval(async () => {
      if (polling || document.visibilityState !== 'visible') return;
      polling = true;
      const batch = Array.from({ length: Math.min(10, pending.length) }, (_, offset) => pending[(pollCursor.current + offset) % pending.length]);
      pollCursor.current += batch.length;
      const updates = await Promise.all(batch.map(async item => {
        try { return { id: item._id, state: (await api<{ indexing: IndexingState }>(`/documents/${item._id}/indexing`, { signal: AbortSignal.timeout(10000) })).indexing }; }
        catch { return null; }
      }));
      polling = false;
      if (active) setDocuments(previous => previous.map(item => {
        const update = updates.find(value => value?.id === item._id);
        return update ? { ...item, indexing: update.state } : item;
      }));
    }, 4000);
    return () => { active = false; clearInterval(timer); };
  }, [documents]);
  const uploadQuery = new URLSearchParams();
  for (const key of ['course', 'book', 'note']) { const value = params.get(key); if (value) uploadQuery.set(key, value); }
  const uploadTo = `/documents/upload${uploadQuery.size ? `?${uploadQuery}` : ''}`;
  const scopeNames = [
    options.data?.books.find(item => item._id === params.get('book')) && { key: 'book', label: options.data.books.find(item => item._id === params.get('book'))!.title },
    options.data?.notes.find(item => item._id === params.get('note')) && { key: 'note', label: options.data.notes.find(item => item._id === params.get('note'))!.title },
  ].filter(Boolean) as { key: string; label: string }[];
  return <>
    <PageHeader eyebrow="A home for your readings" title="Documents" description="Lecture slides, articles, handouts. Keep the original pages close to your ideas." action={<Link className="btn primary" to={uploadTo}><Icon name="plus" size={18} />Upload PDF</Link>} />
    <section className="document-library-intro"><div><span className="eyebrow">Make a little room for discovery</span><h3>Your next idea might be in these pages.</h3><p>Open a PDF, follow it into a course, or connect it to a note you’re writing.</p></div><div className="document-intro-stack" aria-hidden="true"><span /><span /><span><Icon name="file" size={38} /><b>PDF</b></span></div></section>
    <div className="collection-toolbar document-library-toolbar"><SearchField label="Search PDF titles or filenames" value={params.get('q') || ''} onChange={value => select('q', value.slice(0, 120))} /><label className="filter-select"><span className="sr-only">Filter PDFs by course</span><select value={params.get('course') || ''} onChange={event => select('course', event.target.value)}><option value="">All courses</option>{options.data?.courses.map(course => <option key={course._id} value={course._id}>{course.code || course.title}</option>)}</select></label><label className="filter-select"><span className="sr-only">Filter PDFs by status</span><select value={params.get('status') || ''} onChange={event => select('status', event.target.value)}><option value="">All statuses</option><option value="saved">Saved</option><option value="unfinished">Unfinished uploads</option><option value="attention">Needs attention</option></select></label></div>
    {scopeNames.length > 0 && <div className="document-scope-chips">{scopeNames.map(scope => <button key={scope.key} type="button" onClick={() => select(scope.key, '')} aria-label={`Remove ${scope.key} filter: ${scope.label}`}><Icon name={scope.key === 'book' ? 'book' : 'note'} size={15} />{scope.label}<Icon name="close" size={14} /></button>)}</div>}
    {options.error && <div className="document-inline-error"><ErrorBanner message="Course and material links could not load." /><button className="text-link" onClick={options.reload}>Retry links</button></div>}
    <ErrorBanner message={error} />
    {loading ? <Loading message="Gathering your PDFs…" /> : documents.length ? <><p className="document-result-count">{documents.length}{next ? '+' : ''} {documents.length === 1 ? 'document' : 'documents'}{query ? ' in this view' : ' in your library'}</p><div className="document-grid">{documents.map(item => <DocumentCard key={item._id} document={item} options={options.data} onRemoved={reload} />)}</div>{next && <div className="document-load-more"><button className="btn secondary" disabled={more} onClick={loadMore}>{more ? 'Loading more…' : 'Load more PDFs'}</button></div>}</> : error ? <div className="actions"><button className="btn secondary" onClick={reload}>Retry documents</button>{query && <button className="text-link" onClick={clear}>Clear filters</button>}</div> : query ? <div className="panel"><EmptyState icon="search" title="No matching PDFs" description="Try another title, course, or status—or add a PDF to this space." /><div className="actions"><button className="btn secondary" onClick={clear}>Clear filters</button><Link className="text-link" to={uploadTo}>Upload a PDF here</Link></div></div> : <EmptyState icon="file" title="Bring your first reading" description="A lecture handout, a research article, or a few pages worth keeping. A PDF can stand alone or connect to your study materials." to={uploadTo} label="Upload your first PDF" />}
  </>;
}
