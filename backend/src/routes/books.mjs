import express from 'express';
import { materialConnections } from '../material-connections.mjs';
import { courseFields, materialCourseFilter, coursePopulation } from '../course-materials.mjs';
import { Book, Note, Flashcard } from '../db.mjs';
import { HttpError, requireAuth, text, validateId } from '../http.mjs';

export async function deleteBookAndCleanup(bookId, userId, deps = {}) {
  const { BookModel = Book, NoteModel = Note, FlashcardModel = Flashcard } = deps;
  const result = await BookModel.deleteOne({ _id: bookId, user: userId });
  if (result.deletedCount === 0) { return result; }
  await NoteModel.updateMany({ book: bookId, user: userId }, { $set: { book: null } });
  await FlashcardModel.updateMany({ tags: bookId, user: userId }, { $pull: { tags: bookId } });
  return result;
}

function bookFields(body, partial = false) {
  const fields = {};
  for (const key of ['title', 'author', 'category', 'description', 'url']) {
    if (!partial || Object.hasOwn(body || {}, key)) {
      fields[key] = text(body, key, ['title', 'author', 'category'].includes(key));
    }
  }
  if (Object.hasOwn(body || {}, 'color')) {
    if (body.color === null || body.color === '') { fields.color = null; }
    else if (typeof body.color === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(body.color.trim())) {
      const color = body.color.trim().toLowerCase();
      fields.color = color.length === 4 ? '#' + [...color.slice(1)].map(char => char + char).join('') : color;
    } else { throw new HttpError(400, 'Check the highlighted fields.', { color: 'Choose a color or enter a hex value such as #7955aa.' }); }
  }
  if (fields.url) {
    let valid = false;
    try { valid = ['http:', 'https:'].includes(new URL(fields.url).protocol); } catch { /* Invalid URL is reported below. */ }
    if (!valid) { throw new HttpError(400, 'Check the highlighted fields.', { url: 'Enter a complete http:// or https:// URL.' }); }
  }
  return fields;
}

const router = express.Router();
router.use(requireAuth);
router.param('id', validateId);
router.get('/', async (req, res) => {
  const books = await Book.find({ user: req.user._id, ...await materialCourseFilter('books', req.query.course, req.user._id) }).populate(coursePopulation(req.user._id)).sort({ _id: -1 }).lean();
  res.json({ books });
});
router.post('/', async (req, res) => {
  const book = await Book.create({ ...bookFields(req.body), ...await courseFields(req.body, req.user._id), user: req.user._id });
  res.status(201).json({ book });
});
router.get('/:id', async (req, res) => {
  const book = await Book.findOne({ _id: req.params.id, user: req.user._id }).populate(coursePopulation(req.user._id)).lean();
  if (!book) { throw new HttpError(404, 'Book not found.'); }
  const related = await materialConnections({ user: req.user._id, book });
  res.json({ book, related });
});
router.patch('/:id', async (req, res) => {
  const book = await Book.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { $set: { ...bookFields(req.body, true), ...await courseFields(req.body, req.user._id, true) } },
    { new: true, runValidators: true },
  );
  if (!book) { throw new HttpError(404, 'Book not found.'); }
  res.json({ book });
});
router.delete('/:id', async (req, res) => {
  const result = await deleteBookAndCleanup(req.params.id, req.user._id);
  if (!result.deletedCount) { throw new HttpError(404, 'Book not found.'); }
  res.status(204).end();
});
export default router;
