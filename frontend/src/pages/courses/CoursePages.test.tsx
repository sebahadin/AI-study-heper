import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CourseList, CourseDetail, CourseEditor } from './CoursePages';
import { CoursePicker, effectiveCourses } from '../../components/CourseFields';

const course = { _id: 'course-one', title: 'Psychology', code: 'PSY 101', term: 'Fall 2026', color: 'mint', counts: { books: 1, notes: 1, flashcards: 0 } };
const second = { ...course, _id: 'course-two', title: 'Biology', code: 'BIO 101', term: 'Spring 2027' };
const book = { _id: 'book-one', title: 'Memory', courses: [course] };
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input, options) => {
    const path = String(input);
    const body = path === '/api/courses' && options?.method === 'POST' ? { course } : path === '/api/courses' ? { courses: [course, second] } : { course, books: [book], notes: [{ _id: 'note-one', title: 'Remember this', content: 'Recall without looking', book, courses: [] }], flashcards: [{ _id: 'card-one', question: 'Recall?', options: ['A', 'B'], correctIndex: 0, tags: [book] }] };
    return new Response(JSON.stringify(body), { status: options?.method === 'POST' ? 201 : 200 });
  }));
});
describe('course organization', () => {
  it('searches courses and filters by term', async () => {
    const user = userEvent.setup(); render(<MemoryRouter><CourseList /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Psychology' });
    await user.type(screen.getByRole('searchbox', { name: 'Search courses' }), 'BIO');
    expect(screen.queryByRole('heading', { name: 'Psychology' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Biology' })).toBeVisible();
    await user.clear(screen.getByRole('searchbox', { name: 'Search courses' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter courses by term' }), 'Fall 2026');
    expect(screen.getByRole('heading', { name: 'Psychology' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Biology' })).toBeNull();
  });
  it('keeps inherited courses distinct from explicit assignments and deduplicates shared references', async () => {
    const onChange = vi.fn(); const user = userEvent.setup();
    render(<MemoryRouter><CoursePicker selected={[]} inherited={[course]} onChange={onChange} /></MemoryRouter>);
    const checkbox = await screen.findByRole('checkbox', { name: /PSY 101.*Psychology/ });
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText('Also included through related books:')).toBeVisible();
    await user.click(checkbox); expect(onChange).toHaveBeenCalledWith(['course-one']);
    expect(effectiveCourses({ courses: [course], book, tags: [book] })).toHaveLength(1);
  });
  it('shows course notes and provides creation, association management, and course practice links', async () => {
    render(<MemoryRouter initialEntries={['/courses/course-one?tab=notes']}><Routes><Route path="/courses/:id" element={<CourseDetail />} /></Routes></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Psychology' });
    expect(screen.getByRole('heading', { name: 'Remember this' })).toBeVisible();
    expect(screen.getByText('Via related book')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Write a note' })).toHaveAttribute('href', '/notes/add?course=course-one');
    expect(screen.getByRole('button', { name: 'Organize course notes' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Take a quiz' })).toHaveAttribute('href', '/flashcards/quiz?course=course-one');
  });
  it('creates a course and opens its page', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/courses/add']}><Routes><Route path="/courses/add" element={<CourseEditor />} /><Route path="/courses/:id" element={<CourseDetail />} /></Routes></MemoryRouter>);
    await user.type(screen.getByRole('textbox', { name: 'Course name' }), 'Psychology');
    await user.type(screen.getByRole('textbox', { name: 'Course code (optional)' }), 'PSY 101');
    await user.click(screen.getByRole('radio', { name: 'mint' }));
    await user.click(screen.getByRole('button', { name: 'Save course' }));
    expect(await screen.findByRole('heading', { name: 'Psychology' })).toBeVisible();
    const write = vi.mocked(fetch).mock.calls.find(([, options]) => options?.method === 'POST');
    expect(JSON.parse(String(write?.[1]?.body))).toMatchObject({ title: 'Psychology', code: 'PSY 101', color: 'mint' });
  });
});
