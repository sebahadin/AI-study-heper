import type { ReactNode } from 'react';

export type IconName = 'palette' | 'connections' | 'eye' | 'more' | 'edit' | 'trash' | 'shuffle' | 'flip' | 'courses' | 'dashboard' | 'book' | 'note' | 'cards' | 'play' | 'plus' | 'search' | 'chevron' | 'logout' | 'menu' | 'close' | 'check' | 'clock' | 'motion' | 'spark';
const shapes: Record<IconName, ReactNode> = {
  palette: <><path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-4 2 2 0 0 1 1-4h2a4 4 0 0 0 4-4c0-4-4-6-9-6z" /><circle cx="7" cy="10" r=".7" /><circle cx="10" cy="7" r=".7" /><circle cx="15" cy="7" r=".7" /></>,
  connections: <><circle cx="5" cy="12" r="3" /><circle cx="18" cy="5" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8 10 7-4M8 14l7 4" /></>,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  edit: <><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z" /></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
  shuffle: <><path d="M3 5h3c5 0 7 14 12 14h3M3 19h3c2 0 4-3 6-7s4-7 6-7h3M18 2l3 3-3 3M18 16l3 3-3 3" /></>,
  flip: <><path d="M4 9a8 8 0 0 1 14-3l2 3M20 4v5h-5M20 15a8 8 0 0 1-14 3l-2-3M4 20v-5h5" /><path d="M10 9v6M14 9v6" /></>,
  courses: <><path d="m2 9 10-5 10 5-10 5zM6 11v6c4 3 8 3 12 0v-6M22 9v7" /></>,
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  book: <><path d="M4 19V5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1 0-4h13M8 3v14" /></>,
  note: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5" /></>,
  cards: <><rect x="6" y="7" width="15" height="14" rx="2" /><path d="M16 3H5a2 2 0 0 0-2 2v11M10 12h7M10 16h4" /></>,
  play: <><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4z" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
  chevron: <path d="m9 5 7 7-7 7" />,
  logout: <><path d="M9 5H5v14h4M14 8l4 4-4 4M9 12h9" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m5 12 4 4L19 6" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  motion: <><circle cx="12" cy="12" r="3" /><ellipse cx="12" cy="12" rx="10" ry="5" transform="rotate(-35 12 12)" /></>,
  spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" /></>,
};
export function Icon({ name, size = 20, className = '' }: { name: IconName; size?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{shapes[name]}</svg>;
}
