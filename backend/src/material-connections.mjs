import { Book, Course, Note, Flashcard } from './db.mjs';
import { coursePopulation, bookPopulation } from './course-materials.mjs';

const idsOf = refs => (refs || []).filter(Boolean).map(ref => ref._id || ref);

// All exploration paths are derived from the current user's own records.
export async function materialConnections({ user, book = null, courses = [], excludeNote = null }) {
  const ids = [...new Set([...idsOf(courses), ...idsOf(book?.courses)].map(String))];
  const courseRecords = ids.length ? await Course.find({ user, _id: { $in: ids } }).select('title code color term instructor description').sort({ title: 1 }).lean() : [];
  const ownedCourseIds = courseRecords.map(course => course._id);
  const courseBooks = ownedCourseIds.length ? await Book.find({ user, courses: { $in: ownedCourseIds } }).populate(coursePopulation(user)).sort({ _id: -1 }).lean() : [];
  const bookIds = courseBooks.map(item => item._id);
  const noteScope = book ? { book: book._id } : ownedCourseIds.length ? { $or: [{ courses: { $in: ownedCourseIds } }, { book: { $in: bookIds } }] } : null;
  const cardScope = book ? { tags: book._id } : ownedCourseIds.length ? { $or: [{ courses: { $in: ownedCourseIds } }, { tags: { $in: bookIds } }] } : null;
  const [notes, flashcards] = await Promise.all([
    noteScope ? Note.find({ user, ...noteScope, ...(excludeNote ? { _id: { $ne: excludeNote } } : {}) }).select('-contentHtml').populate(coursePopulation(user)).populate(bookPopulation('book', user)).sort({ updatedAt: -1, createdAt: -1 }).lean() : [],
    cardScope ? Flashcard.find({ user, ...cardScope }).populate(coursePopulation(user)).populate(bookPopulation('tags', user)).sort({ createdAt: -1 }).lean() : [],
  ]);
  return { book, courses: courseRecords, notes, flashcards, books: courseBooks.filter(item => !book || String(item._id) !== String(book._id)).slice(0, 8) };
}

export async function noteConnections(note, user) {
  const bookId = note.book?._id || note.book;
  const book = bookId ? await Book.findOne({ _id: bookId, user }).populate(coursePopulation(user)).lean() : null;
  return materialConnections({ user, book, courses: note.courses, excludeNote: note._id });
}
