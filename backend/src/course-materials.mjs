import mongoose from 'mongoose';
import { Course, Book, Note, Flashcard } from './db.mjs';
import { HttpError } from './http.mjs';

export const courseSelection = 'title code color';
export const coursePopulation = user => ({ path: 'courses', select: courseSelection, match: { user } });
export const bookPopulation = (path, user) => ({ path, select: 'title courses', match: { user }, populate: coursePopulation(user) });

export async function ownedCourse(id, user) {
  if (!mongoose.isObjectIdOrHexString(id)) { throw new HttpError(400, 'Invalid course ID.'); }
  const course = await Course.findOne({ _id: id, user }).lean();
  if (!course) { throw new HttpError(404, 'Course not found.'); }
  return course;
}

export async function courseFields(body, user, partial = false) {
  if (partial && !Object.hasOwn(body || {}, 'courses')) { return {}; }
  const raw = body?.courses ?? [];
  if (!Array.isArray(raw) || raw.length > 50 || raw.some(id => typeof id !== 'string' || !mongoose.isObjectIdOrHexString(id))) {
    throw new HttpError(400, 'Check the highlighted fields.', { courses: 'Choose courses from your workspace.' });
  }
  const courses = [...new Set(raw)];
  if (courses.length && await Course.countDocuments({ _id: { $in: courses }, user }) !== courses.length) {
    throw new HttpError(400, 'Check the highlighted fields.', { courses: 'Choose only your own courses.' });
  }
  return { courses };
}

// Course membership includes explicit assignments and the item's related books.
export async function materialCourseFilter(kind, course, user) {
  if (course === undefined || course === '') { return {}; }
  if (typeof course !== 'string') { throw new HttpError(400, 'Invalid course filter.'); }
  const unassigned = course === 'none';
  if (!unassigned) { await ownedCourse(course, user); }
  const direct = unassigned ? { $or: [{ courses: { $exists: false } }, { courses: { $size: 0 } }] } : { courses: course };
  if (kind === 'books') { return direct; }
  const books = await Book.find({ user, ...(unassigned ? { 'courses.0': { $exists: true } } : { courses: course }) }).select('_id').lean();
  const related = { [kind === 'notes' ? 'book' : 'tags']: { [unassigned ? '$nin' : '$in']: books.map(book => book._id) } };
  return unassigned ? { $and: [direct, related] } : { $or: [direct, related] };
}

export async function courseSummaries(user) {
  const [courses, books, notes, cards] = await Promise.all([
    Course.find({ user }).sort({ createdAt: -1 }).lean(),
    Book.find({ user }).select('_id courses').lean(),
    Note.find({ user }).select('courses book').lean(),
    Flashcard.find({ user }).select('courses tags').lean(),
  ]);
  const counts = new Map(courses.map(course => [String(course._id), { books: 0, notes: 0, flashcards: 0 }]));
  const bookCourses = new Map(books.map(book => [String(book._id), book.courses || []]));
  function count(items, kind, inherited) {
    for (const item of items) {
      const ids = new Set([...(item.courses || []), ...inherited(item)].map(String));
      for (const id of ids) { if (counts.has(id)) { counts.get(id)[kind]++; } }
    }
  }
  count(books, 'books', () => []);
  count(notes, 'notes', note => bookCourses.get(String(note.book)) || []);
  count(cards, 'flashcards', card => (card.tags || []).flatMap(id => bookCourses.get(String(id)) || []));
  return courses.map(course => ({ ...course, counts: counts.get(String(course._id)) }));
}

export const materialModels = { books: Book, notes: Note, flashcards: Flashcard };
