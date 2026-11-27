import { AppearanceDialog } from './AppearanceDialog';
import { useThemePreference } from '../theme/useThemePreference';
import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useMotionPreference } from '../hooks/useMotionPreference';
import { errorMessage } from '../services/api';
import { ErrorBanner } from './Feedback';
import { AmbientBackground } from './OrbitScene';
import { Icon, type IconName } from './Icon';

const navigation: { path: string; title: string; icon: IconName; section: string }[] = [
  { path: '/dashboard', title: 'Dashboard', icon: 'dashboard', section: 'Dashboard' },
  { path: '/chat', title: 'Study chat', icon: 'chat', section: 'Study chat' },
  { path: '/courses', title: 'Courses', icon: 'courses', section: 'Courses' },
  { path: '/books', title: 'Books', icon: 'book', section: 'Books' },
  { path: '/documents', title: 'Documents', icon: 'file', section: 'Documents' },
  { path: '/notes', title: 'Notes', icon: 'note', section: 'Notes' },
  { path: '/flashcards/list', title: 'Flashcards', icon: 'cards', section: 'Flashcards' },
  { path: '/flashcards/quiz', title: 'Quiz', icon: 'play', section: 'Quiz' },
];

export function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const courseContext = /^\/courses\/([a-f\d]{24})(?:\/|$)/i.exec(location.pathname)?.[1] || new URLSearchParams(location.search).get('course');
  const courseQuery = courseContext && /^[a-f\d]{24}$/i.test(courseContext) ? `?course=${courseContext}` : '';
  const motion = useMotionPreference();
  const theme = useThemePreference();
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const createMenu = useRef<HTMLDetailsElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const section = location.pathname.startsWith('/chat') ? 'Study chat' : location.pathname.startsWith('/courses') ? 'Courses' : location.pathname.startsWith('/books') ? 'Books' : location.pathname.startsWith('/documents') ? 'Documents' : location.pathname.startsWith('/notes') ? 'Notes' : location.pathname.startsWith('/flashcards/quiz') ? 'Quiz' : location.pathname.startsWith('/flashcards') ? 'Flashcards' : 'Dashboard';
  useEffect(() => {
    if (mobileOpen) { dialog.current?.showModal(); }
    else if (dialog.current?.open) { dialog.current.close(); }
  }, [mobileOpen]);
  useEffect(() => {
    setMobileOpen(false);
    if (createMenu.current) { createMenu.current.open = false; }
  }, [location.pathname]);
  useEffect(() => {
    const closeMenu = (event: PointerEvent) => {
      if (createMenu.current?.open && !createMenu.current.contains(event.target as Node)) { createMenu.current.open = false; }
    };
    document.addEventListener('pointerdown', closeMenu);
    return () => document.removeEventListener('pointerdown', closeMenu);
  }, []);
  async function signOut() {
    setBusy(true); setError('');
    try { await logout(); } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }
  const brand = <Link to={user ? '/dashboard' : '/login'} className="brand"><span className="brand-symbol"><Icon name="book" size={23} /></span><span>Classmate<span className="brand-dot">.</span></span></Link>;
  const motionToggle = <button type="button" className="motion-toggle" role="switch" aria-label="Animated backgrounds" aria-checked={motion.enabled} disabled={motion.systemReduced} title={motion.systemReduced ? 'Reduced motion is enabled in your device settings.' : 'Turn decorative motion on or off'} onClick={motion.toggle}><Icon name="motion" size={18} /><span>Motion effects</span><span className={`toggle-track${motion.enabled ? ' is-on' : ''}`}><i /></span></button>;
  const appearanceButton = <button type="button" className="appearance-button" aria-label="Appearance" title="Choose a theme" onClick={() => setAppearanceOpen(true)}><Icon name="palette" size={19} /></button>;
  function sidebarContent(mobile = false) {
    return <><div className="sidebar-brand">{brand}{mobile && <button className="icon-button" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><Icon name="close" /></button>}</div><p className="nav-caption">Workspace</p><nav aria-label="Main navigation">{navigation.map((item) => <span className="nav-entry" key={item.path}>{item.path === '/books' && <span className="nav-caption nav-caption--library">All materials</span>}<Link key={item.path} to={item.path} className={`nav-item${section === item.section ? ' is-active' : ''}`} aria-current={section === item.section ? 'page' : undefined} onClick={() => setMobileOpen(false)}><Icon name={item.icon} /><span>{item.title}</span></Link></span>)}</nav><Link className="sidebar-compose" to={`/notes/add${courseQuery}`} onClick={() => setMobileOpen(false)}><Icon name="edit" size={18} />Write a note</Link><div className="sidebar-bottom">{motionToggle}<div className="sidebar-account"><span className="avatar">{user?.username.slice(0, 1).toUpperCase()}</span><div><strong title={user?.username}>{user?.username}</strong><span>Personal space</span></div><button type="button" className="icon-button logout-button" aria-label="Logout" title="Logout" disabled={busy} onClick={signOut}><Icon name="logout" /></button></div></div></>;
  }
  return <div className={`${user ? 'app-shell' : 'auth-shell'}${motion.enabled ? '' : ' motion-reduced'}`}>
    {appearanceOpen && <AppearanceDialog value={theme.preference} onChange={theme.setPreference} onClose={() => setAppearanceOpen(false)} />}
    <AmbientBackground /><a className="skip-link" href="#main-content">Skip to content</a>
    {user ? <><aside className="sidebar">{sidebarContent()}</aside><dialog id="mobile-navigation" className="mobile-navigation" ref={dialog} onCancel={() => setMobileOpen(false)} onClose={() => setMobileOpen(false)}>{sidebarContent(true)}</dialog><div className="workspace"><header className="workspace-topbar"><div className="topbar-location"><button type="button" className="icon-button menu-button" aria-label="Open navigation" aria-controls="mobile-navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Icon name="menu" /></button><span className="breadcrumb-parent">Workspace</span><Icon name="chevron" size={13} /><span className="breadcrumb-current">{section}</span></div><div className="topbar-actions">{appearanceButton}<details className="create-menu" ref={createMenu} onKeyDown={(event) => { if (event.key === 'Escape' && createMenu.current) { createMenu.current.open = false; } }}><summary className="btn create-trigger"><Icon name="plus" size={17} />Create</summary><div className="create-menu-panel"><Link to="/courses/add"><Icon name="courses" />Course</Link><Link to={`/books/add${courseQuery}`}><Icon name="book" />Book</Link><Link to={`/documents/upload${courseQuery}`}><Icon name="file" />PDF document</Link><Link to={`/notes/add${courseQuery}`}><Icon name="note" />Note</Link><Link to={`/flashcards/new${courseQuery}`}><Icon name="cards" />Flashcard</Link></div></details></div></header><main id="main-content" className="workspace-content"><ErrorBanner message={error} /><div className="page-transition" key={location.pathname.startsWith('/chat') ? 'study-chat' : location.pathname}><Outlet /></div></main><footer className="workspace-footer"><span>A little focus goes a long way.</span><span>Classmate · Your space to learn</span></footer></div></> : <><header className="auth-header">{brand}<div className="auth-header-right">{appearanceButton}<span>Your space to learn.</span>{motionToggle}</div></header><main id="main-content" className="auth-main"><div className="page-transition" key={location.pathname.startsWith('/chat') ? 'study-chat' : location.pathname}><Outlet /></div></main></>}
  </div>;
}
