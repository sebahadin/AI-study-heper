import { Link } from 'react-router-dom';
import type { Book, Course, MaterialConnections, Note } from '../types';
import { BookCover } from './PageElements';
import { Icon } from './Icon';

export function CourseDoorways({ courses }: { courses: Course[] }) {
  if (!courses.length) return null;
  return <div className="course-doorways">{courses.map(course => <Link key={course._id} className={`course-doorway course-tone--${course.color || 'violet'}`} to={`/courses/${course._id}`}><span className="course-doorway-symbol"><Icon name="courses" size={24} /></span><div><span>{course.code || 'Course'}</span><h4>{course.title}</h4><p>{course.term || 'Explore the materials and connections'}</p></div><Icon name="connections" size={19} /></Link>)}</div>;
}
export function LinkedNotes({ notes, context = '' }: { notes: Note[]; context?: string }) {
  return <div className="linked-notes-grid">{notes.map(note => <Link key={note._id} className="linked-note" to={`/notes/${note._id}${context ? `?course=${context}` : ''}`}><span><Icon name="note" size={21} /></span><h4>{note.title}</h4><p>{note.content.replace(/\s+/g, ' ').slice(0, 150)}</p><small>{note.content.trim().split(/\s+/).filter(Boolean).length} words · Open note</small></Link>)}</div>;
}
export function StudyDeck({ count, onReview }: { count: number; onReview: () => void }) {
  return <button className="study-deck-object" aria-haspopup="dialog" onClick={onReview}>
    <span className="study-deck-illustration" aria-hidden="true"><i /><i /><span><Icon name="cards" size={32} /><b>Recall</b></span></span>
    <span className="study-deck-copy"><small>From this book</small><strong>Turn an idea into a stronger memory.</strong><span>{count} connected {count === 1 ? 'card' : 'cards'}. A question on one side, a connection on the other.</span><b>Pick up this deck</b></span>
  </button>;
}
export function RelatedReading({ books, compact = false }: { books: Book[]; compact?: boolean }) {
  return <div className={`related-reading${compact ? ' is-compact' : ''}`}>{books.map(book => <Link key={book._id} className="related-reading-book" to={`/books/${book._id}`}><BookCover book={book} compact /><div><h4>{book.title}</h4><p>{book.author}</p><span>Open study space</span></div></Link>)}</div>;
}
export function NoteConnections({ related, noteId, onReview }: { related: MaterialConnections; noteId: string; onReview: () => void }) {
  const { book, notes, flashcards, courses, books } = related;
  return <aside className="note-connections" aria-label="Connected study materials"><div className="connections-rail-heading"><Icon name="connections" size={22} /><h3>Keep exploring</h3></div>
    {book && <Link className="note-source-book" to={`/books/${book._id}`}><span className="eyebrow">From this book</span><BookCover book={book} compact /><h4>{book.title}</h4><p>{book.author}</p><span className="study-open-link">Open book study space</span></Link>}
    {flashcards.length > 0 && <button className="connections-recall" onClick={onReview}><Icon name="cards" size={24} /><span><strong>A little recall?</strong><small>{flashcards.length} connected {flashcards.length === 1 ? 'flashcard' : 'flashcards'}</small></span><span className="connections-action-label">Review</span></button>}
    {notes.length > 0 && <section className="connections-siblings"><h4>{book ? 'More notes from this book' : 'More from these courses'}</h4>{notes.slice(0, 4).map(note => <Link key={note._id} to={`/notes/${note._id}`}><Icon name="note" size={16} /><span>{note.title}</span></Link>)}</section>}
    {courses.length > 0 && <section><h4 className="connections-section-title">Go deeper in a course</h4><CourseDoorways courses={courses} /></section>}
    {books.length > 0 && <section><h4 className="connections-section-title">Connected reading</h4><RelatedReading books={books.slice(0, 2)} compact /></section>}
    {!book && !courses.length && <div className="connections-empty"><Icon name="connections" size={30} /><h4>Give this idea a home</h4><p>Link your note to a book or course to discover its connected materials.</p><Link className="btn secondary small" to={`/notes/${noteId}/edit`}>Organize note</Link></div>}
  </aside>;
}
