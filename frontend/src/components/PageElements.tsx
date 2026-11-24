import { bookInk, normalizeBookColor } from '../utils/bookColor';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import type { Book } from '../types';

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: ReactNode }) {
  return <header className="page-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2><p className="page-description">{description}</p></div>{action && <div className="page-heading-action">{action}</div>}</header>;
}
export function EmptyState({ icon, title, description, to, label }: { icon: IconName; title: string; description: string; to?: string; label?: string }) {
  return <div className="empty-state"><span className="empty-state-icon"><Icon name={icon} size={28} /></span><h3>{title}</h3><p>{description}</p>{to && label && <Link className="btn primary" to={to}><Icon name="plus" size={17} />{label}</Link>}</div>;
}
export function SearchField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div className="collection-search"><Icon name="search" size={19} /><input type="search" aria-label={label} placeholder={label} value={value} onChange={(event) => onChange(event.target.value)} /></div>;
}
export function BookCover({ book, compact = false }: { book: Book; compact?: boolean }) {
  const tone = [...book._id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 4;
  const color = book.color ? normalizeBookColor(book.color) : null;
  const style = color ? { '--cover-bg': color, '--cover-ink': bookInk(color) } as CSSProperties : undefined;
  return <div style={style} className={`book-cover book-cover--${tone}${compact ? ' book-cover--compact' : ''}${color ? ' book-cover--custom' : ''}`} aria-hidden="true">
    <span className="book-volume">
      <span className="book-cover-back" />
      <span className="book-cover-spine"><span>{book.title}</span></span>
      <span className="book-page-edge book-page-edge--side" />
      <span className="book-page-edge book-page-edge--top" />
      <span className="book-page-edge book-page-edge--bottom" />
      <span className="book-cover-front"><span className="cover-category">{book.category}</span><span className="cover-art"><i /><i /><i /></span><strong>{book.title}</strong><span className="cover-author">{book.author}</span></span>
    </span>
  </div>;
}
