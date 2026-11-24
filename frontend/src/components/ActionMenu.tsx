import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

export interface MenuAction { label: string; icon?: IconName; to?: string; onSelect?: () => void; danger?: boolean }
export function ActionMenu({ label, items }: { label: string; items: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback((restore = false) => { setOpen(false); if (restore) { trigger.current?.focus(); } }, []);
  function focusItem(index: number) {
    const next = (index + items.length) % items.length;
    setActive(next); panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[next]?.focus();
  }
  const place = useCallback(() => {
    if (!trigger.current || !panel.current) { return; }
    const bounds = trigger.current.getBoundingClientRect();
    const menu = panel.current.getBoundingClientRect();
    const top = bounds.bottom + menu.height + 8 > window.innerHeight && bounds.top > menu.height ? bounds.top - menu.height - 8 : bounds.bottom + 8;
    const next = { top: Math.max(10, Math.min(top, window.innerHeight - menu.height - 10)), left: Math.max(10, Math.min(bounds.right - menu.width, window.innerWidth - menu.width - 10)) };
    setPosition(previous => Math.abs(previous.top - next.top) < .5 && Math.abs(previous.left - next.left) < .5 ? previous : next);
  }, []);
  useLayoutEffect(() => {
    if (!open) { return; }
    place(); panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [open, place]);
  useEffect(() => {
    if (!open) { return; }
    const outside = (event: PointerEvent) => { if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) { close(); } };
    const dismiss = () => close();
    const scroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) { const bounds = trigger.current?.getBoundingClientRect(); if (bounds && (bounds.bottom < 0 || bounds.top > window.innerHeight)) { close(); } else { place(); } } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', dismiss);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', dismiss); };
  }, [open, close, place]);
  function keys(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') { close(true); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); focusItem(event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : active + (event.key === 'ArrowDown' ? 1 : -1));
    }
  }
  return <>
    <button ref={trigger} type="button" className="more-actions-button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => { setActive(0); setOpen(value => !value); }} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(0); setOpen(true); } }}><Icon name="more" size={20} /></button>
    {open && createPortal(<div id={id} ref={panel} className="action-menu-panel" role="menu" aria-label={label} style={position} onKeyDown={keys}>{items.map((item, index) => {
      const contents = <>{item.icon && <Icon name={item.icon} size={17} />}<span>{item.label}</span></>;
      const props = { role: 'menuitem', tabIndex: active === index ? 0 : -1, className: `action-menu-item${item.danger ? ' is-danger' : ''}`, onFocus: () => setActive(index), onClick: () => { close(true); item.onSelect?.(); } };
      return item.to ? <Link key={item.label} to={item.to} {...props}>{contents}</Link> : <button key={item.label} type="button" {...props}>{contents}</button>;
    })}</div>, document.body)}
  </>;
}
