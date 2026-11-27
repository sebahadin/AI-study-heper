import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../services/api';
import type { IndexingState } from '../../types';
import { Icon } from '../Icon';
import '../../styles/indexing.css';

const labels: Record<IndexingState['status'], string> = {
  not_requested: 'Not indexed yet', queued: 'Queued', processing: 'Processing', ready: 'Ready',
  failed: 'Needs attention', cancelled: 'Removed', not_available: 'Waiting for your PDF',
};

export function IndexingPanel({ kind, id }: { kind: 'documents' | 'notes'; id: string }) {
  const [state, setState] = useState<IndexingState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef<string | null>(null);
  const sequence = useRef(0);
  const pending = useRef<string | null>(null);
  const path = `/${kind}/${id}/indexing`;
  const refresh = useCallback(async () => {
    if (pending.current === path) return;
    pending.current = path;
    const request = ++sequence.current;
    try {
      const result = await api<{ indexing: IndexingState }>(path, { signal: AbortSignal.timeout(10000) });
      if (active.current === path && request === sequence.current) { setState(result.indexing); setError(''); }
    } catch (reason) { if (active.current === path && request === sequence.current) setError(errorMessage(reason)); }
    finally { if (pending.current === path) pending.current = null; }
  }, [path]);
  useEffect(() => {
    active.current = path;
    setState(null); setError(''); setBusy(false);
    void refresh();
    return () => { active.current = null; };
  }, [refresh, path]);
  useEffect(() => {
    if (busy || !error && !['queued', 'processing'].includes(state?.status || '')) return;
    const check = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = setInterval(check, 3000);
    document.addEventListener('visibilitychange', check);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', check); };
  }, [busy, error, state?.status, refresh]);
  async function retry() {
    ++sequence.current;
    setBusy(true); setError('');
    try {
      const result = await api<{ indexing: IndexingState }>(`${path}/retry`, { method: 'POST', body: {} });
      if (active.current === path) setState(result.indexing);
    } catch (reason) { if (active.current === path) setError(errorMessage(reason)); }
    finally { if (active.current === path) setBusy(false); }
  }
  if (!state && !error || state && ['not_available', 'cancelled'].includes(state.status)) return null;
  const status = state?.status || 'not_requested';
  const description = status === 'ready' ? 'Your text is indexed for study tools.'
    : status === 'processing' ? 'Preparing searchable passages. You can keep reading.'
    : status === 'queued' ? 'Your material is saved and waiting to be indexed.'
    : status === 'failed' ? state?.error?.message || 'Indexing could not finish. Your saved material is still available.'
    : 'Prepare this material for your study assistant.';
  return <section className={`indexing-panel indexing-panel--${status}`} aria-label="Study indexing status">
    <Icon name={status === 'ready' ? 'check' : 'clock'} size={20} />
    <div className="indexing-copy"><strong role="status" aria-live="polite">{labels[status]}</strong><p>{description}</p>
      {state?.pagesWithoutText && state.pagesWithoutText.length > 0 && <p>{state.pagesWithoutText.length === 1 ? 'Page' : 'Pages'} {state.pagesWithoutText.join(', ')} {state.pagesWithoutText.length === 1 ? 'has' : 'have'} no extractable text. {state.pagesWithoutText.length === 1 ? 'That page is' : 'Those pages are'} not searchable.</p>}
      {error && <p role="alert">{error}</p>}
    </div>
    {['failed', 'not_requested'].includes(status) && <button type="button" className="btn secondary small" onClick={retry} disabled={busy}>{busy ? 'Queueing…' : status === 'failed' ? 'Retry indexing' : 'Index material'}</button>}
  </section>;
}
