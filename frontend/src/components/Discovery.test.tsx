import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { groupByCourse } from './CourseDiscovery';
import { BookColorPicker } from './BookColorPicker';
import { BookDetail } from '../pages/books/BookPages';
import { NoteDetail } from '../pages/notes/NotePages';
import { BookList } from '../pages/books/BookList';
import { useThemePreference } from '../theme/useThemePreference';
import { applyTheme, readTheme } from '../theme/preferences';
import { bookInk, normalizeBookColor } from '../utils/bookColor';
import type { Book, Course, MaterialConnections, Note } from '../types';

const course: Course = { _id: 'course-one', title: 'Learning science', code: 'EDU 101', color: 'mint' };
const other: Course = { _id: 'course-two', title: 'Psychology', code: 'PSY 101', color: 'violet' };
const book: Book = { _id: 'book-one', title: 'The Memory Handbook', author: 'An Author', category: 'Psychology', color: '#123456', courses: [course, other] };
const note: Note = { _id: 'note-one', title: 'How memory connects', content: 'Retrieve before checking the answer.', book };
const second: Note = { ...note, _id: 'note-two', title: 'A connected thought' };
const related: MaterialConnections = { book, courses: [course, other], notes: [second], books: [], flashcards: [{ _id: 'card-one', question: 'Why recall?', options: ['To remember', 'To forget'], correctIndex: 0, tags: [book] }] };

beforeEach(() => { localStorage.clear(); delete document.documentElement.dataset.theme; document.documentElement.style.colorScheme = ''; });
describe('connected study spaces', () => {
  it('groups direct and inherited course memberships once per course and preserves personal notes', () => {
    const personal = { ...note, _id: 'personal', book: null };
    const groups = groupByCourse([{ ...note, courses: [course] }, personal]);
    expect(groups.map(group => group.course?.title || 'Personal')).toEqual(['Learning science', 'Psychology', 'Personal']);
    expect(groups.map(group => group.items.length)).toEqual([1, 1, 1]);
    expect(groups[2].items[0]._id).toBe('personal');
  });
  it('lets a shared book appear in each course shelf and switches to one complete collection', async () => {
    vi.stubGlobal('fetch', vi.fn(async input => new Response(JSON.stringify(String(input) === '/api/courses' ? { courses: [course, other] } : { books: [book] }))));
    const user = userEvent.setup(); render(<MemoryRouter><BookList /></MemoryRouter>);
    await screen.findByRole('heading', { name: course.title });
    expect(screen.getAllByRole('heading', { name: book.title })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'All books' }));
    expect(screen.getAllByRole('heading', { name: book.title })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'All books' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('opens book notes, courses and book-scoped practice from its study space', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ book, related }))));
    const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/books/book-one?course=course-one']}><Routes><Route path="/books/:id" element={<BookDetail />} /></Routes></MemoryRouter>);
    await screen.findByRole('heading', { name: book.title });
    expect(screen.getByRole('link', { name: /Follow an idea/ })).toHaveAttribute('href', '/notes/note-two?course=course-one');
    await user.click(screen.getByRole('button', { name: 'Notes (1)' }));
    expect(screen.getByRole('link', { name: 'Write a book note' })).toHaveAttribute('href', '/notes/add?book=book-one&course=course-one');
    expect(screen.getByRole('heading', { name: second.title })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Practice (1)' }));
    expect(screen.getByRole('link', { name: 'Take a book quiz' })).toHaveAttribute('href', '/flashcards/quiz?tags=book-one');
    expect(screen.getByRole('button', { name: 'Reveal answer: Why recall?' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Connections' }));
    expect(screen.getByRole('heading', { name: course.title })).toBeVisible();
  });
  it('offers linked materials in the note reader and a reversible focus-reading view', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ note, related }))));
    const user = userEvent.setup(); render(<MemoryRouter initialEntries={['/notes/note-one']}><Routes><Route path="/notes/:id" element={<NoteDetail />} /></Routes></MemoryRouter>);
    const rail = await screen.findByRole('complementary', { name: 'Connected study materials' });
    expect(within(rail).getByRole('link', { name: /Open book study space/ })).toHaveAttribute('href', '/books/book-one');
    expect(within(rail).getByRole('link', { name: second.title })).toHaveAttribute('href', '/notes/note-two');
    await user.click(screen.getByRole('button', { name: 'Focus reading' }));
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.getByRole('article', { name: 'Note document' })).toHaveTextContent(note.content);
    await user.click(screen.getByRole('button', { name: 'Show connections' }));
    expect(screen.getByRole('complementary', { name: 'Connected study materials' })).toBeVisible();
  });
});
describe('personal appearance', () => {
  it('accepts full-spectrum and short hex colors while refusing CSS values', () => {
    expect(normalizeBookColor('AbC')).toBe('#aabbcc');
    expect(normalizeBookColor('#123456')).toBe('#123456');
    expect(normalizeBookColor('red')).toBeNull();
    expect(normalizeBookColor('url(example)')).toBeNull();
    expect(bookInk('#ffffff')).toBe('#000000');
    expect(bookInk('#000000')).toBe('#ffffff');
  });
  it('lets a user enter a custom shade and restore an automatic book cover', async () => {
    const change = vi.fn(); const user = userEvent.setup(); render(<BookColorPicker value="#123456" onChange={change} />);
    const hex = screen.getByRole('textbox', { name: 'Book color hex' });
    await user.clear(hex); await user.type(hex, '#e91d8b'); await user.tab();
    expect(change).toHaveBeenCalledWith('#e91d8b');
    await user.click(screen.getByRole('button', { name: 'Use an automatic cover' }));
    expect(change).toHaveBeenCalledWith(null);
  });
  it('persists theme choices and follows device appearance only in System mode', async () => {
    let dark = false; let onChange = () => {};
    vi.stubGlobal('matchMedia', vi.fn(() => ({ get matches() { return dark; }, addEventListener: (_: string, handler: () => void) => { onChange = handler; }, removeEventListener: vi.fn() })));
    function Themes() { const theme = useThemePreference(); return <><button onClick={() => theme.setPreference('forest')}>Forest</button><button onClick={() => theme.setPreference('system')}>System</button></>; }
    const user = userEvent.setup(); render(<Themes />);
    expect(document.documentElement.dataset.theme).toBe('dark');
    await user.click(screen.getByRole('button', { name: 'Forest' }));
    expect(readTheme()).toBe('forest'); expect(document.documentElement.dataset.theme).toBe('forest');
    dark = true; onChange(); expect(document.documentElement.dataset.theme).toBe('forest');
    dark = false; await user.click(screen.getByRole('button', { name: 'System' }));
    expect(document.documentElement.dataset.theme).toBe('light'); expect(readTheme()).toBe('system');
    dark = true; onChange(); expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });
  it('recovers from an invalid saved theme', () => {
    localStorage.setItem('classmate-theme', 'invalid'); expect(readTheme()).toBe('dark');
    expect(applyTheme('light')).toBe('light'); expect(document.documentElement.style.colorScheme).toBe('light');
  });
});
