import { Link } from 'react-router-dom';
import { useResource } from '../hooks/useResource';
import type { BookRef, Course, CourseRef } from '../types';
import { effectiveCourses } from './CourseFields';
import { Icon } from './Icon';

type CourseMaterial = { courses?: (CourseRef | string)[]; book?: BookRef | string | null };
export function groupByCourse<T extends CourseMaterial>(items: T[]) {
  const groups = new Map<string, { course: CourseRef | null; items: T[] }>();
  for (const item of items) {
    const courses = effectiveCourses(item);
    if (!courses.length) { const group = groups.get('none') || { course: null, items: [] }; group.items.push(item); groups.set('none', group); }
    for (const course of courses) { const group = groups.get(course._id) || { course, items: [] }; group.items.push(item); groups.set(course._id, group); }
  }
  return [...groups.values()].sort((a, b) => !a.course ? 1 : !b.course ? -1 : a.course.title.localeCompare(b.course.title));
}
export function CourseDiscovery({ kind, value, onChange }: { kind: 'books' | 'notes'; value: string; onChange: (value: string) => void }) {
  const { data, error, reload } = useResource<{ courses: Course[] }>('/courses');
  const courses = data?.courses || [];
  const selected = courses.find(course => course._id === value);
  return <section className="course-discovery" aria-label={`Browse ${kind} by course`}>
    <div className="discovery-section-heading"><span className="eyebrow">Follow a subject</span><Link className="text-link" to="/courses">Explore courses</Link></div>
    <div className="course-discovery-track"><button className={`course-discovery-tile course-discovery-all${!value ? ' is-selected' : ''}`} aria-pressed={!value} onClick={() => onChange('')}>{!value && <span className="course-selection-indicator" aria-hidden="true"><Icon name="check" size={14} /></span>}<Icon name="dashboard" size={21} /><strong>All courses</strong><span>Your whole collection</span></button>{courses.map(course => <button key={course._id} className={`course-discovery-tile course-tone--${course.color || 'violet'}${value === course._id ? ' is-selected' : ''}`} aria-pressed={value === course._id} onClick={() => onChange(course._id)}>{value === course._id && <span className="course-selection-indicator" aria-hidden="true"><Icon name="check" size={14} /></span>}<span className="course-discovery-code"><Icon name="courses" size={18} />{course.code || 'Course'}</span><strong>{course.title}</strong><span>{course.counts?.[kind] || 0} {kind}</span></button>)}<button className={`course-discovery-tile${value === 'none' ? ' is-selected' : ''}`} aria-pressed={value === 'none'} onClick={() => onChange('none')}>{value === 'none' && <span className="course-selection-indicator" aria-hidden="true"><Icon name="check" size={14} /></span>}<Icon name={kind === 'books' ? 'book' : 'note'} size={21} /><strong>Unassigned</strong><span>A space of your own</span></button></div>
    {selected && <div className={`selected-course-invitation course-tone--${selected.color}`}><div><span className="eyebrow">Inside your course</span><h3>{selected.title}</h3><p>{selected.description || 'Reading, notes, and practice come together here.'}</p></div><Link className="btn secondary" to={`/courses/${selected._id}`}>Dive into course</Link></div>}
    {error && <button className="text-link" onClick={reload}>Reload course shelves</button>}
  </section>;
}
