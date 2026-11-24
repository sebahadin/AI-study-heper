import { useEffect, useId, useState } from 'react';
import { bookColors, bookInk, normalizeBookColor } from '../utils/bookColor';
import { Icon } from './Icon';

export function BookColorPicker({ value, onChange, disabled, error }: { value: string | null; onChange: (color: string | null) => void; disabled?: boolean; error?: string }) {
  const [hex, setHex] = useState(value || '');
  const [invalid, setInvalid] = useState(false);
  const id = useId();
  useEffect(() => { setHex(value || ''); }, [value]);
  function choose(color: string | null) { setInvalid(false); setHex(color || ''); onChange(color); }
  return <fieldset className="book-color-picker" disabled={disabled}><legend>Book cover color</legend><p>Give your book a color of its own. Pick a suggestion or choose any shade.</p>
    <div className="book-color-swatches">{bookColors.map(color => <button key={color} type="button" className="book-color-swatch" style={{ backgroundColor: color, color: bookInk(color) }} aria-label={`Choose ${color}`} aria-pressed={value === color} onClick={() => choose(color)}>{value === color && <Icon name="check" size={17} />}</button>)}</div>
    <div className="book-custom-color"><label className="book-color-native"><span className="book-custom-color-dot" style={{ backgroundColor: value || '#b5a4dc' }} /><span>Choose any color</span><input type="color" aria-label="Custom book color" value={value || '#b5a4dc'} onChange={event => choose(event.target.value)} /></label><label className="book-hex-field" htmlFor={id}><span className="sr-only">Book color hex</span><input id={id} aria-label="Book color hex" value={hex} placeholder="#RRGGBB" maxLength={7} pattern="#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})" required={value !== null} aria-invalid={invalid} onInvalid={() => setInvalid(true)} onChange={event => { setHex(event.target.value); setInvalid(false); const color = normalizeBookColor(event.target.value); if (color && /^#?[0-9a-f]{6}$/i.test(event.target.value)) onChange(color); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); const color = normalizeBookColor(hex); if (color) choose(color); else setInvalid(true); } }} onBlur={() => { const color = normalizeBookColor(hex); if (color) choose(color); else if (hex) setInvalid(true); }} /></label></div>
    <button type="button" className="book-color-reset" onClick={() => choose(null)}>Use an automatic cover</button>
    {(invalid || error) && <p className="form-error" role="alert">{error || 'Enter a three- or six-digit hex color, such as #7955aa.'}</p>}
  </fieldset>;
}
