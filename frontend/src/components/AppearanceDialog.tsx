import { useEffect, useId, useRef } from 'react';
import type { ThemePreference } from '../theme/preferences';
import { Icon } from './Icon';

const themes: { id: ThemePreference; name: string; description: string }[] = [
  { id: 'dark', name: 'Midnight', description: 'A quiet space in deep violet.' },
  { id: 'light', name: 'Daylight', description: 'Clear paper, soft light, and room to think.' },
  { id: 'forest', name: 'Forest', description: 'Deep greens with a calmer glow.' },
  { id: 'system', name: 'System', description: 'Follow your device’s light or dark setting.' },
];
export function AppearanceDialog({ value, onChange, onClose }: { value: ThemePreference; onChange: (theme: ThemePreference) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => { dialog.current?.showModal(); }, []);
  function dismiss() { dialog.current?.close(); }
  return <dialog ref={dialog} className="appearance-dialog" aria-labelledby={id} onClose={onClose} onCancel={event => { event.preventDefault(); dismiss(); }}>
    <header className="appearance-heading"><div><p className="eyebrow">Make yourself at home</p><h2 id={id}>Choose your atmosphere</h2></div><button className="icon-button" aria-label="Close appearance" onClick={dismiss}><Icon name="close" /></button></header>
    <p>Pick a theme that feels comfortable for the way you study.</p>
    <fieldset className="theme-choices"><legend className="sr-only">App theme</legend>{themes.map(theme => <label key={theme.id} className={`theme-choice${value === theme.id ? ' is-selected' : ''}`}><input type="radio" name="app-theme" value={theme.id} checked={value === theme.id} onChange={() => onChange(theme.id)} /><span className={`theme-preview theme-preview--${theme.id}`} aria-hidden="true"><i /><span><b /><b /><b /></span></span><span className="theme-choice-name">{theme.name}{value === theme.id && <Icon name="check" size={17} />}</span><span className="theme-choice-description">{theme.description}</span></label>)}</fieldset>
    <footer><span>Saved on this device. Changes appear immediately.</span><button className="btn primary" onClick={dismiss}>Done</button></footer>
  </dialog>;
}
