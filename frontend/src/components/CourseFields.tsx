import { Link } from 'react-router-dom';
import { useResource } from '../hooks/useResource';
import type { BookRef, Course, CourseRef } from '../types';
import { Icon } from './Icon';
import { ErrorBanner } from './Feedback';

export const courseIds = (courses?: (CourseRef | string)[]) => (courses || []).map(course => typeof course === 'string' ? course : course._id);
export function effectiveCourses(item: { courses?: (CourseRef | string)[]; book?: BookRef | string | null; tags?: (BookRef | string)[] }) {
  const books = [item.book, ...(item.tags || [])].filter((book): book is BookRef => Boolean(book) && typeof book === 'object');
  const refs = [...(item.courses || []), ...books.flatMap(book => book.courses || [])].filter((course): course is CourseRef => Boolean(course) && typeof course === 'object');
  return [...new Map(refs.map(course => [course._id, course])).values()];
}
export function CourseBadges({ courses }: { courses?: CourseRef[] }) {
  if (!courses?.length) { return null; }
  return <div className="course-badges">{courses.map(course => <Link key={course._id} className={`course-badge course-tone--${course.color || 'violet'}`} to={`/courses/${course._id}`}><Icon name="courses" size={14} />{course.code || course.title}</Link>)}</div>;
}
export function CoursePicker({ selected, onChange, disabled = false, inherited = [], error }: { selected: string[]; onChange: (ids: string[]) => void; disabled?: boolean; inherited?: CourseRef[]; error?: string }) {
  const { data, loading, error: loadError, reload } = useResource<{ courses: Course[] }>('/courses');
  return <fieldset className="course-picker" disabled={disabled} aria-describedby="course-picker-help"><legend>Courses</legend><p id="course-picker-help">Add this material to one or more courses.</p>
    {loading ? <p role="status">Loading courses…</p> : loadError ? <><ErrorBanner message={loadError} /><button type="button" className="btn secondary small" onClick={reload}>Retry courses</button></> : data?.courses?.length ? <div className="course-picker-options">{data.courses.map(course => <label key={course._id} className={`course-choice course-tone--${course.color}`}><input type="checkbox" checked={selected.includes(course._id)} onChange={(event) => onChange(event.target.checked ? [...selected, course._id] : selected.filter(id => id !== course._id))} /><span><Icon name="courses" size={16} />{course.code && <strong>{course.code}</strong>}{course.title}</span></label>)}</div> : <p className="course-picker-empty">No courses yet. <Link to="/courses/add">Create a course</Link> to organize your materials.</p>}
    {inherited.length > 0 && <div className="course-inheritance"><span>Also included through related books:</span><CourseBadges courses={inherited} /></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </fieldset>;
}
export function CourseFilter({ value, onChange, allLabel = 'All courses' }: { value: string; onChange: (value: string) => void; allLabel?: string }) {
  const { data, error, reload } = useResource<{ courses: Course[] }>('/courses');
  return <div className="course-filter"><label className="filter-select"><span className="sr-only">Filter by course</span><select value={value} onChange={event => onChange(event.target.value)}><option value="">{allLabel}</option><option value="none">No course</option>{(data?.courses || []).map(course => <option value={course._id} key={course._id}>{course.code ? `${course.code} · ` : ''}{course.title}</option>)}</select></label>{error && <button type="button" className="text-link" onClick={reload}>Retry courses</button>}</div>;
}
