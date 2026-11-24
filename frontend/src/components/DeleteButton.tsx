import { useEffect, useId, useRef, useState } from 'react';
import { api, errorMessage } from '../services/api';
import { ErrorBanner } from './Feedback';

export function ConfirmDialog({ title, path, onClose, onDeleted, description }: { title: string; path: string; onClose: () => void; onDeleted: () => void; description?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { ref.current?.showModal(); }, []);
  async function remove() {
    setBusy(true);
    setError('');
    try { await api<void>(path, { method: 'DELETE' }); onDeleted(); onClose(); }
    catch (reason) { setError(errorMessage(reason)); setBusy(false); }
  }
  return <dialog ref={ref} aria-labelledby={titleId} onCancel={(event) => { if (busy) { event.preventDefault(); } else { onClose(); } }} onClose={onClose}>
    <h2 id={titleId}>Remove this item?</h2>
    <p>Remove “{title}”?</p>{description && <p className="remove-explanation">{description}</p>}
    <ErrorBanner message={error} />
    <div className="modal-actions"><button type="button" className="btn secondary" disabled={busy} onClick={() => { ref.current?.close(); onClose(); }}>Cancel</button><button type="button" className="btn danger" disabled={busy} onClick={remove}>{busy ? 'Removing…' : 'Yes, remove'}</button></div>
  </dialog>;
}

export function DeleteButton({ title, path, onDeleted, description }: { title: string; path: string; onDeleted: () => void; description?: string }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="btn small danger" onClick={() => setOpen(true)}>Remove</button>{open && <ConfirmDialog title={title} path={path} description={description} onClose={() => setOpen(false)} onDeleted={onDeleted} />}</>;
}
