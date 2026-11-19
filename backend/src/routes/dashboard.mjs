import express from 'express';
import { Book, Note, Flashcard } from '../db.mjs';
import { requireAuth } from '../http.mjs';

const router = express.Router();
router.use(requireAuth);
router.get('/', async (req, res) => {
  const filter = { user: req.user._id };
  const [books, notes, flashcardsCount] = await Promise.all([
    Book.find(filter).sort({ _id: -1 }).lean(),
    Note.find(filter).sort({ createdAt: -1 }).lean(),
    Flashcard.countDocuments(filter),
  ]);
  res.json({ books, notes, flashcardsCount });
});
export default router;
