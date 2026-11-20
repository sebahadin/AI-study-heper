import express from 'express';
import mongoose from 'mongoose';
import { courseFields, materialCourseFilter, coursePopulation, bookPopulation } from '../course-materials.mjs';
import { Book, Flashcard } from '../db.mjs';
import { HttpError, requireAuth, text, validateId } from '../http.mjs';

export function buildFlashcardDoc(body, userId) {
  const question = text(body, 'question');
  const rawOptions = body.options ?? [body.option1, body.option2, body.option3, body.option4];
  if (!Array.isArray(rawOptions) || rawOptions.some((option) => option !== null && option !== undefined && typeof option !== 'string')) {
    throw new HttpError(400, 'Answer options must be text.');
  }
  const selectedIndex = Number(body.correctIndex);
  const filledOptions = rawOptions.map((option, index) => ({ text: (option || '').trim(), index })).filter((option) => option.text);
  const correctIndex = filledOptions.findIndex((option) => option.index === selectedIndex);
  if (filledOptions.length < 2 || filledOptions.length > 4) {
    throw new HttpError(400, 'Provide between two and four answer options.');
  }
  if (body.correctIndex === '' || body.correctIndex === null || body.correctIndex === undefined || !Number.isInteger(selectedIndex) || correctIndex < 0) {
    throw new HttpError(400, 'Choose a correct answer that contains text.');
  }
  const rawTags = Array.isArray(body.tags) ? body.tags : (body.tags ? [body.tags] : []);
  const tags = [...new Set(rawTags.map((tag) => String(tag)))];
  if (!tags.length && !body.courses?.length) { throw new HttpError(400, 'Flashcards require at least one tag'); }
  return { question, options: filledOptions.map((option) => option.text), correctIndex, tags, courses: body.courses || [], user: userId };
}

export function buildFlashcardFilter(query = {}, userId) {
  const tags = Array.isArray(query.tags) ? query.tags : typeof query.tags === 'string' ? query.tags.split(',') : [];
  if (tags.some((tag) => typeof tag !== 'string')) { throw new HttpError(400, 'Invalid book tags.'); }
  const cleaned = tags.map((tag) => tag.trim()).filter(Boolean);
  return { user: userId, ...(cleaned.length ? { tags: { $in: cleaned } } : {}) };
}

async function validateBookTags(tags, userId) {
  if (tags.some((tag) => !mongoose.isObjectIdOrHexString(tag)) || await Book.countDocuments({ _id: { $in: tags }, user: userId }) !== tags.length) {
    throw new HttpError(400, 'Select only books from your library.', { tags: 'Choose at least one of your books.' });
  }
}

const router = express.Router();
router.use(requireAuth);
router.param('id', validateId);
router.get('/', async (req, res) => {
  const filter = { ...buildFlashcardFilter(req.query, req.user._id), ...await materialCourseFilter('flashcards', req.query.course, req.user._id) };
  if (filter.tags?.$in.some((tag) => !mongoose.isObjectIdOrHexString(tag))) { throw new HttpError(400, 'Invalid book tags.'); }
  const flashcards = await Flashcard.find(filter).sort({ createdAt: -1 })
    .populate(coursePopulation(req.user._id)).populate(bookPopulation('tags', req.user._id)).lean();
  res.json({ flashcards });
});
router.post('/', async (req, res) => {
  const payload = buildFlashcardDoc({ ...req.body, ...await courseFields(req.body, req.user._id) }, req.user._id);
  await validateBookTags(payload.tags, req.user._id);
  const flashcard = await Flashcard.create(payload);
  res.status(201).json({ flashcard });
});
router.get('/:id', async (req, res) => {
  const flashcard = await Flashcard.findOne({ _id: req.params.id, user: req.user._id }).lean();
  if (!flashcard) { throw new HttpError(404, 'Flashcard not found.'); }
  res.json({ flashcard });
});
router.patch('/:id', async (req, res) => {
  const flashcard = await Flashcard.findOne({ _id: req.params.id, user: req.user._id });
  if (!flashcard) { throw new HttpError(404, 'Flashcard not found.'); }
  const body = { ...flashcard.toObject(), courses: flashcard.courses.map(String), ...req.body };
  const payload = buildFlashcardDoc({ ...body, ...await courseFields(body, req.user._id) }, req.user._id);
  await validateBookTags(payload.tags, req.user._id);
  flashcard.set(payload);
  await flashcard.save();
  res.json({ flashcard });
});
router.delete('/:id', async (req, res) => {
  const result = await Flashcard.deleteOne({ _id: req.params.id, user: req.user._id });
  if (!result.deletedCount) { throw new HttpError(404, 'Flashcard not found.'); }
  res.status(204).end();
});
export default router;
