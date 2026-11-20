import express from 'express';
import { Book, Note, Flashcard } from '../db.mjs';
import { courseSummaries } from '../course-materials.mjs';
import { requireAuth } from '../http.mjs';

const router = express.Router();
router.use(requireAuth);
router.get('/', async (req, res) => {
  const filter = { user: req.user._id };
  const [books, notes, flashcardsCount, courses] = await Promise.all([
    Book.find(filter).sort({ _id: -1 }).lean(),
    Note.find(filter).sort({ createdAt: -1 }).lean(),
    Flashcard.countDocuments(filter),
    courseSummaries(req.user._id),
  ]);
  res.json({ books, notes, flashcardsCount, courses });
});
export default router;
