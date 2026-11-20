import express from 'express';
import mongoose from 'mongoose';
import { Course, Book, Note, Flashcard } from '../db.mjs';
import { HttpError, requireAuth, text, validateId } from '../http.mjs';
import { ownedCourse, courseSummaries, materialCourseFilter, materialModels, coursePopulation, bookPopulation } from '../course-materials.mjs';

function fields(body, partial = false) {
  const result = {};
  for (const key of ['title', 'code', 'term', 'instructor', 'description']) {
    if (!partial || Object.hasOwn(body || {}, key)) {
      result[key] = text(body, key, key === 'title');
      if (result[key]?.length > (key === 'description' ? 3000 : 160)) { throw new HttpError(400, 'Check the highlighted fields.', { [key]: 'Please use a shorter value.' }); }
    }
  }
  if (!partial || Object.hasOwn(body || {}, 'color')) {
    result.color = body?.color || 'violet';
    if (!['violet', 'blue', 'mint', 'peach', 'rose'].includes(result.color)) { throw new HttpError(400, 'Choose a course color.', { color: 'Choose one of the available colors.' }); }
  }
  return result;
}
const router = express.Router();
router.use(requireAuth);
router.param('id', validateId);
router.get('/', async (req, res) => res.json({ courses: await courseSummaries(req.user._id) }));
router.post('/', async (req, res) => {
  const course = await Course.create({ ...fields(req.body), user: req.user._id });
  res.status(201).json({ course });
});
router.get('/:id', async (req, res) => {
  const user = req.user._id;
  const course = await ownedCourse(req.params.id, user);
  const [notesFilter, cardFilter] = await Promise.all([materialCourseFilter('notes', req.params.id, user), materialCourseFilter('flashcards', req.params.id, user)]);
  const [books, notes, flashcards] = await Promise.all([
    Book.find({ user, courses: course._id }).populate(coursePopulation(user)).sort({ _id: -1 }).lean(),
    Note.find({ user, ...notesFilter }).populate(coursePopulation(user)).populate(bookPopulation('book', user)).sort({ updatedAt: -1, createdAt: -1 }).lean(),
    Flashcard.find({ user, ...cardFilter }).populate(coursePopulation(user)).populate(bookPopulation('tags', user)).sort({ createdAt: -1 }).lean(),
  ]);
  res.json({ course, books, notes, flashcards });
});
router.patch('/:id', async (req, res) => {
  const course = await Course.findOneAndUpdate({ _id: req.params.id, user: req.user._id }, { $set: { ...fields(req.body, true), updatedAt: new Date() } }, { new: true, runValidators: true });
  if (!course) { throw new HttpError(404, 'Course not found.'); }
  res.json({ course });
});
router.patch('/:id/materials', async (req, res) => {
  const user = req.user._id;
  const course = await ownedCourse(req.params.id, user);
  const { kind, ids } = req.body || {};
  const Model = typeof kind === 'string' && Object.hasOwn(materialModels, kind) ? materialModels[kind] : null;
  if (typeof kind !== 'string' || !Model || !Array.isArray(ids) || ids.length > 1000 || ids.some(id => typeof id !== 'string' || !mongoose.isObjectIdOrHexString(id))) { throw new HttpError(400, 'Choose valid materials.'); }
  const unique = [...new Set(ids)];
  if (await Model.countDocuments({ user, _id: { $in: unique } }) !== unique.length) { throw new HttpError(400, 'Choose only materials from your workspace.'); }
  await Model.bulkWrite([
    { updateMany: { filter: { user, courses: course._id, _id: { $nin: unique } }, update: { $pull: { courses: course._id } } } },
    { updateMany: { filter: { user, _id: { $in: unique } }, update: { $addToSet: { courses: course._id } } } },
  ]);
  res.status(204).end();
});
router.delete('/:id', async (req, res) => {
  const course = await ownedCourse(req.params.id, req.user._id);
  // Detach first so a failed cleanup leaves the course available to retry.
  await Promise.all(Object.values(materialModels).map(Model => Model.updateMany({ user: req.user._id, courses: course._id }, { $pull: { courses: course._id } })));
  await Course.deleteOne({ _id: course._id, user: req.user._id });
  res.status(204).end();
});
export default router;
