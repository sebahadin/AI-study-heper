import mongoose from 'mongoose';
import { Book, Course, Note } from '../db.mjs';
import { DocumentError } from './errors.mjs';

export async function documentFilter(user, query = {}) {
  const clauses = [];
  const selected = {};
  for (const [field, model] of [['course', Course], ['book', Book], ['note', Note]]) {
    const value = query[field];
    if (value === undefined || value === '') { continue; }
    if (typeof value !== 'string' || !mongoose.isObjectIdOrHexString(value)) {
      throw new DocumentError(400, 'invalid_filter', 'Choose a valid material filter.');
    }
    if (!await model.exists({ _id: value, user })) {
      throw new DocumentError(404, 'material_not_found', 'That study material is no longer available.');
    }
    selected[field] = value;
  }
  if (selected.course) {
    const books = await Book.find({ user, courses: selected.course }).select('_id').lean();
    const bookIds = books.map(book => book._id);
    const notes = await Note.find({ user, $or: [{ courses: selected.course }, { book: { $in: bookIds } }] }).select('_id').lean();
    clauses.push({ $or: [{ courses: selected.course }, { book: { $in: bookIds } }, { note: { $in: notes.map(note => note._id) } }] });
  }
  if (selected.book) {
    const notes = await Note.find({ user, book: selected.book }).select('_id').lean();
    clauses.push({ $or: [{ book: selected.book }, { note: { $in: notes.map(note => note._id) } }] });
  }
  if (selected.note) { clauses.push({ note: selected.note }); }
  if (query.q !== undefined) {
    if (typeof query.q !== 'string' || query.q.length > 120) { throw new DocumentError(400, 'invalid_search', 'Use a search of at most 120 characters.'); }
    const escaped = query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (escaped) { clauses.push({ $or: [{ title: { $regex: escaped, $options: 'i' } }, { filename: { $regex: escaped, $options: 'i' } }] }); }
  }
  const statuses = { saved: ['uploaded'], unfinished: ['awaiting_upload', 'validating'], attention: ['failed', 'deleting'] };
  if (query.status) {
    if (typeof query.status !== 'string' || !Object.hasOwn(statuses, query.status)) { throw new DocumentError(400, 'invalid_filter', 'Choose a valid document status.'); }
    clauses.push({ status: { $in: statuses[query.status] } });
  }
  return clauses.length ? { $and: clauses } : {};
}

export async function documentOptions(user) {
  const [courses, books, notes] = await Promise.all([
    Course.find({ user }).select('title code color').sort({ title: 1 }).lean(),
    Book.find({ user }).select('title author color courses').sort({ title: 1 }).lean(),
    Note.find({ user }).select('title book courses').sort({ title: 1 }).lean(),
  ]);
  return { courses, books, notes };
}
