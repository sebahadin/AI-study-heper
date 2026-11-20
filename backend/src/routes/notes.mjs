import express from 'express';
import mongoose from 'mongoose';
import { Note, Book } from '../db.mjs';
import { courseFields, materialCourseFilter, coursePopulation, bookPopulation } from '../course-materials.mjs';
import { noteContentFields } from '../note-content.mjs';
import { HttpError, requireAuth, text, validateId } from '../http.mjs';

async function noteFields(body, userId, partial = false) {
  const fields = { ...noteContentFields(body, partial), ...await courseFields(body, userId, partial) };
  for (const key of ['title']) {
    if (!partial || Object.hasOwn(body || {}, key)) { fields[key] = text(body, key); }
  }
  if (!partial || Object.hasOwn(body || {}, 'book')) {
    const bookId = body?.book || null;
    if (bookId && (!mongoose.isObjectIdOrHexString(bookId) || !await Book.exists({ _id: bookId, user: userId }))) {
      throw new HttpError(400, 'Check the highlighted fields.', { book: 'Choose one of your books.' });
    }
    fields.book = bookId;
  }
  return fields;
}

const router = express.Router();
router.use(requireAuth);
router.param('id', validateId);
router.get('/', async (req, res) => {
  const notes = await Note.find({ user: req.user._id, ...await materialCourseFilter('notes', req.query.course, req.user._id) }).sort({ createdAt: -1 })
    .populate(coursePopulation(req.user._id)).populate(bookPopulation('book', req.user._id)).lean();
  res.json({ notes });
});
router.post('/', async (req, res) => {
  const note = await Note.create({ ...await noteFields(req.body, req.user._id), user: req.user._id });
  res.status(201).json({ note });
});
router.get('/:id', async (req, res) => {
  const note = await Note.findOne({ _id: req.params.id, user: req.user._id })
    .populate(coursePopulation(req.user._id)).populate(bookPopulation('book', req.user._id)).lean();
  if (!note) { throw new HttpError(404, 'Note not found.'); }
  res.json({ note });
});
router.patch('/:id', async (req, res) => {
  const note = await Note.findOneAndUpdate(
    { _id: req.params.id, user: req.user._id },
    { $set: { ...await noteFields(req.body, req.user._id, true), updatedAt: new Date() } },
    { new: true, runValidators: true },
  );
  if (!note) { throw new HttpError(404, 'Note not found.'); }
  res.json({ note });
});
router.delete('/:id', async (req, res) => {
  const result = await Note.deleteOne({ _id: req.params.id, user: req.user._id });
  if (!result.deletedCount) { throw new HttpError(404, 'Note not found.'); }
  res.status(204).end();
});
export default router;
