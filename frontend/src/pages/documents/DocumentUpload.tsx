import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ConfirmDialog } from '../../components/DeleteButton';
import { ErrorBanner, Field, LoadError, Loading } from '../../components/Feedback';
import { PageHeader } from '../../components/PageElements';
import { Icon } from '../../components/Icon';
import { CourseBadges } from '../../components/CourseFields';
import { useResource } from '../../hooks/useResource';
import { api, ApiError, errorMessage } from '../../services/api';
import { documentCourses, fileSize, pdfSelectionError, uploadPdf } from '../../services/documents';
import type { DocumentOptions, DocumentPolicy, DocumentUploadIntent, StudyDocument } from '../../types';
import '../../styles/documents.css';

type Phase = 'idle' | 'preparing' | 'uploading' | 'checking' | 'paused' | 'error';

function UploadForm({ options, policy }: { options: DocumentOptions; policy: DocumentPolicy }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [courses, setCourses] = useState(options.courses.filter(item => item._id === params.get('course')).map(item => item._id));
  const [book, setBook] = useState(options.books.find(item => item._id === params.get('book'))?._id || '');
  const [note, setNote] = useState(options.notes.find(item => item._id === params.get('note'))?._id || '');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [restart, setRestart] = useState(false);
  const [needsNew, setNeedsNew] = useState(false);
  const intent = useRef<DocumentUploadIntent | null>(null);
  const sent = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const busy = ['preparing', 'uploading', 'checking'].includes(phase);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  function choose(files: FileList | null) {
    if (busy || intent.current || !files?.length) return;
    if (files.length !== 1) { setError('Choose one PDF at a time.'); return; }
    const selected = files[0];
    const invalid = pdfSelectionError(selected, policy);
    if (invalid) { setError(invalid); return; }
    if (!title || title === file?.name.replace(/\.pdf$/i, '').slice(0, 200)) setTitle(selected.name.replace(/\.pdf$/i, '').slice(0, 200));
    setFile(selected); setError(''); setProgress(0); setPhase('idle');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || needsNew) return;
    if (!file) { setError('Choose a PDF to upload.'); return; }
    if (!title.trim()) { setError('Give your PDF a title.'); return; }
    const abort = new AbortController(); controller.current = abort;
    setError('');
    try {
      if (!intent.current) {
        setPhase('preparing');
        intent.current = await api<DocumentUploadIntent>('/documents/uploads', {
          method: 'POST', signal: abort.signal,
          body: { title: title.trim(), filename: file.name, byteCount: file.size, courses, book: book || null, note: note || null },
        });
      }
      if (!sent.current) {
        if (Date.parse(intent.current.upload.expiresAt) <= Date.now()) {
          throw new ApiError('This upload link expired. Start over to get a new link.', 410, {}, 'upload_expired');
        }
        setPhase('uploading');
        await uploadPdf(intent.current, file, abort.signal, value => { if (mounted.current) setProgress(value); });
        sent.current = true;
      }
      setPhase('checking');
      const result = await api<{ document: StudyDocument }>(`/documents/${intent.current.document._id}/complete`, { method: 'POST', body: {}, signal: abort.signal });
      if (mounted.current) navigate(`/documents/${result.document._id}`);
    } catch (reason) {
      if (!mounted.current) return;
      if (abort.signal.aborted) { setPhase('paused'); setError('Upload stopped. Retry to send the same PDF again.'); return; }
      if (reason instanceof ApiError && reason.code === 'upload_not_found') sent.current = false;
      setNeedsNew(reason instanceof ApiError && [403, 410, 413, 422].includes(reason.status));
      setPhase('error'); setError(errorMessage(reason));
    }
  }

  const inherited = documentCourses({ courses: [], book: book || null, note: note || null }, options);
  const step = phase === 'checking' ? 2 : busy || phase === 'paused' || phase === 'error' && intent.current ? 1 : 0;
  return <>
    <Link className="document-back" to="/documents">All documents</Link>
    <PageHeader eyebrow="Keep the pages that matter" title="Upload a PDF" description="A reading can stand on its own—or join the course, book, or note it belongs with." />
    <div className="document-upload-layout"><form className="form-container document-upload-form" onSubmit={submit} noValidate>
      <ol className="document-upload-steps" aria-label="Upload steps">{['Choose your PDF', 'Upload the file', 'Check and save'].map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}><Icon name={index < step ? 'check' : index === step ? 'file' : 'clock'} size={17} /><span>{label}</span></li>)}</ol>
      <ErrorBanner message={error} />
      <fieldset className="document-upload-fields" disabled={busy || Boolean(intent.current)}>
        <div className={`document-dropzone${dragging ? ' is-dragging' : ''}${file ? ' has-file' : ''}`} onDragOver={event => { event.preventDefault(); if (!busy && !intent.current) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files); }}>
          <input className="sr-only" type="file" id="pdf-file" aria-label="PDF file" accept=".pdf,application/pdf" onChange={event => choose(event.target.files)} />
          <label htmlFor="pdf-file"><span className="document-drop-icon"><Icon name="file" size={32} /></span><strong>{file?.name || 'Drop a PDF here'}</strong><span>{file ? fileSize(file.size) : 'or choose a file from your device'}</span><span className="btn secondary small">{file ? 'Choose another PDF' : 'Choose PDF'}</span></label>
        </div>
        <p className="document-limit-hint">PDF · up to {policy.maxPages} pages · {fileSize(policy.maxBytes)} maximum. The page limit is checked after upload.</p>
        <Field name="pdf-title" label="Document title"><input id="pdf-title" required maxLength={200} value={title} placeholder="e.g. Memory and learning — lecture handout" onChange={event => setTitle(event.target.value)} /></Field>
        <details className="document-associations" open={Boolean(courses.length || book || note) || undefined}><summary><Icon name="connections" size={18} />Connect to your study materials <span>Optional</span></summary><div>
          <fieldset className="document-course-choices"><legend>Courses</legend>{options.courses.length ? <div className="course-picker-options">{options.courses.map(course => <label className={`course-choice course-tone--${course.color || 'violet'}`} key={course._id}><input type="checkbox" checked={courses.includes(course._id)} onChange={event => setCourses(event.target.checked ? [...courses, course._id] : courses.filter(id => id !== course._id))} /><span>{course.code && <strong>{course.code}</strong>}{course.title}</span></label>)}</div> : <p>No courses yet. You can keep this PDF on its own.</p>}</fieldset>
          <div className="grid-2"><Field name="pdf-book" label="Related book"><select id="pdf-book" value={book} onChange={event => setBook(event.target.value)}><option value="">No linked book</option>{options.books.map(item => <option key={item._id} value={item._id}>{item.title}</option>)}</select></Field><Field name="pdf-note" label="Related note"><select id="pdf-note" value={note} onChange={event => setNote(event.target.value)}><option value="">No linked note</option>{options.notes.map(item => <option key={item._id} value={item._id}>{item.title}</option>)}</select></Field></div>
          {inherited.length > 0 && <div className="document-inherited"><p>Also included through your related materials:</p><CourseBadges courses={inherited} /></div>}
        </div></details>
      </fieldset>
      {(busy || phase === 'paused' || phase === 'error' && intent.current) && <div className="document-upload-progress"><p role="status">{phase === 'preparing' ? 'Preparing your upload…' : phase === 'uploading' ? `Uploading your PDF · ${progress}%` : phase === 'checking' ? 'Checking the PDF and saving it to your library…' : sent.current ? 'The file was sent. Retry to confirm it without uploading again.' : 'Your upload can be retried from here.'}</p><progress max={100} value={phase === 'checking' || sent.current ? 100 : progress} aria-label="PDF upload progress" /></div>}
      <div className="actions"><button className="btn primary" type="submit" disabled={busy || !file || needsNew}><Icon name={phase === 'checking' ? 'clock' : 'file'} size={18} />{phase === 'checking' ? 'Checking PDF…' : busy ? 'Uploading…' : intent.current ? sent.current ? 'Retry confirmation' : 'Retry upload' : 'Upload PDF'}</button>
        {busy && phase !== 'checking' ? <button type="button" className="btn secondary" onClick={() => controller.current?.abort()}>Stop upload</button> : !busy && intent.current ? <button className="btn secondary" type="button" onClick={() => setRestart(true)}>Start over</button> : <Link className="btn secondary" to="/documents">Back to library</Link>}
      </div>
      {intent.current && !busy && <Link className="document-attempt-link" to={`/documents/${intent.current.document._id}`}>View this upload in your library</Link>}
    </form><aside className="document-upload-aside"><div className="document-paper document-paper--large" aria-hidden="true"><span className="document-paper-label">PDF</span><i /><i /><i /><span className="document-paper-pages">A few pages. A new perspective.</span></div><h3>A place for the original.</h3><p>Keep a lecture handout, a short article, or a useful set of slides. Your notes can tell the rest of the story.</p><div className="document-upload-reassurance"><Icon name="eye" size={18} /><span>Saved to your own library, with the connections you choose.</span></div></aside></div>
    {restart && intent.current && <ConfirmDialog title={intent.current.document.title} path={`/documents/${intent.current.document._id}`} description="Discard this upload attempt so you can start over. Other study materials will stay." onClose={() => setRestart(false)} onDeleted={() => { intent.current = null; sent.current = false; setPhase('idle'); setError(''); setNeedsNew(false); setProgress(0); }} />}
  </>;
}

export function DocumentUpload() {
  const options = useResource<DocumentOptions>('/documents/options');
  const policy = useResource<{ policy: DocumentPolicy }>('/documents/policy');
  if (options.loading || policy.loading) return <Loading message="Preparing your upload space…" />;
  if (options.error || policy.error || !options.data || !policy.data) return <LoadError message={options.error || policy.error || 'Uploads could not load.'} retry={() => { options.reload(); policy.reload(); }} />;
  return <UploadForm options={options.data} policy={policy.data.policy} />;
}
