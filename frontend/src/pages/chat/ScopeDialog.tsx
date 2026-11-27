import '../../styles/chat.css';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import type { ChatOptions, ChatSelection } from '../../services/chat';
import { emptySelection } from '../../services/chat';

export function ScopeDialog({ selection, topic, allowGeneral, options, onSave, onClose, showGeneral = true }: { selection: ChatSelection; topic: string; allowGeneral: boolean; options: ChatOptions | null; onSave: (selection: ChatSelection, topic: string, general: boolean) => Promise<void>; onClose: () => void; showGeneral?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(selection), [focus, setFocus] = useState(topic), [general, setGeneral] = useState(allowGeneral);
  const [group, setGroup] = useState<'courses' | 'books' | 'notes' | 'documents'>('courses');
  const [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);
  const count = value.documents.length + value.notes.length + value.books.length + value.courses.length;
  function toggle(id: string) {
    setValue(previous => ({ ...previous, library: false, [group]: previous[group].includes(id) ? previous[group].filter(item => item !== id) : [...previous[group], id] }));
  }
  async function save() {
    setBusy(true); setError('');
    try { await onSave(value, focus.trim(), general); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save the study scope.'); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="chat-dialog scope-dialog" onCancel={onClose} onClose={onClose} aria-labelledby="scope-title">
    <header><div><span className="eyebrow">Choose your study space</span><h2 id="scope-title">What are we exploring?</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close scope settings"><Icon name="close" /></button></header>
    <label className="chat-library-choice"><input type="checkbox" checked={value.library} onChange={event => setValue({ ...emptySelection(), library: event.target.checked })} /><span><strong>My library</strong><small>Search all of your indexed notes and PDFs.</small></span><Icon name="book" /></label>
    <div className="chat-scope-tabs" role="tablist" aria-label="Material type">{(['courses', 'books', 'notes', 'documents'] as const).map(name => <button key={name} role="tab" aria-selected={group === name} onClick={() => { setGroup(name); setQuery(''); }}>{name === 'documents' ? 'PDFs' : name[0].toUpperCase()+name.slice(1)}{value[name].length > 0 && <span>{value[name].length}</span>}</button>)}</div>
    <label className="chat-scope-search"><Icon name="search" size={17} /><input type="search" aria-label="Find study materials" placeholder="Find a material…" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div className="chat-material-choices" role="tabpanel" aria-label={group}>{options?.[group].filter(item => item.title.toLowerCase().includes(query.toLowerCase())).map(item => <label key={item._id} className={value[group].includes(item._id) ? 'is-selected' : ''}><input type="checkbox" checked={value[group].includes(item._id)} disabled={!value[group].includes(item._id) && (value[group].length >= 20 || count >= 50)} onChange={() => toggle(item._id)} /><Icon name={group === 'courses' ? 'courses' : group === 'books' ? 'book' : group === 'notes' ? 'note' : 'file'} size={19} /><span>{item.title}</span></label>)}{!options?.[group].length && <p className="chat-muted">No {group === 'documents' ? 'uploaded PDFs' : group} yet. {showGeneral ? 'You can still discuss a topic using general explanations.' : 'Add a note or upload a PDF before generating a study draft.'}</p>}</div>
    <button type="button" className="text-link" onClick={()=>setValue(emptySelection())}>Clear selection</button>
    <p className="chat-muted">{value.library ? 'My library selected' : `${count} selected`} · Books and courses include their linked notes and PDFs.</p>
    <label className="chat-topic-field">Topic focus <span>Optional</span><input value={focus} maxLength={120} onChange={event => setFocus(event.target.value)} placeholder="For example, cellular respiration" /></label>
    {showGeneral && <label className="chat-general-choice"><input type="checkbox" checked={general} onChange={event => setGeneral(event.target.checked)} /><span><strong>Allow general explanations</strong><small>Model knowledge is clearly labeled separately from your materials.</small></span></label>}
    {error && <p className="error-message" role="alert">{error}</p>}
    <footer><button type="button" className="btn secondary" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Use this study scope'}</button></footer>
  </dialog>;
}
