import express from 'express';
import { Book, Flashcard } from '../db.mjs';

export function buildFlashcardDoc(body, userId) {
  const { question, option1, option2, option3, option4, correctIndex, tags } = body;
  const options = [option1, option2, option3, option4].filter(Boolean);
  const cleanTags = Array.isArray(tags) ? tags : (tags ? [tags] : []);
  if (!cleanTags.length) {
    throw new Error('Flashcards require at least one tag');
  }
  return {
    question,
    options,
    correctIndex: parseInt(correctIndex, 10),
    tags: cleanTags,
    user: userId,
  };
}

export function buildFlashcardFilter(query = {}, userId) {
  const filter = { user: userId };
  const { tags } = query;
  const tagValues = Array.isArray(tags)
    ? tags
    : typeof tags === 'string'
      ? tags.split(',')
      : [];
  const cleaned = tagValues
    .map((tag) => tag.trim())
    .filter((tag) => Boolean(tag));
  if (cleaned.length) {filter.tags = { $in: cleaned };}
  return filter;
}

const router = express.Router();

// Require auth for everything here
router.use((req, res, next) => {
  if (!req.isAuthenticated?.() || !req.user) {return res.redirect('/login');}
  next();
});

// List flashcards
router.get("/list", async (req, res) => {
  const flashcards = await Flashcard.find({ user: req.user._id })
    .populate("user")
    .populate("tags", "title")
    .lean();
  res.render("flashcards/flashcardsList", { title: "My Flashcards", flashcards });
});

// Delete a flashcard
router.post("/delete/:id", async (req, res) => {
  await Flashcard.findByIdAndDelete(req.params.id);
  res.redirect("/flashcards/list");
});



// Create form – books dropdown for tags
router.get('/new', async (req, res) => {
  const books = await Book.find({ user: req.user._id }).lean();
  res.render('flashcards/flashcards_new', { title: 'Add Flashcard', books });

});

// Handle create
router.post('/new', async (req, res) => {
  try {
    const payload = buildFlashcardDoc(req.body, req.user._id);
    await Flashcard.create(payload);
    res.redirect('/dashboard');
  } catch (e) {
    const books = await Book.find({ user: req.user._id }).lean();
    const errorMessage = e.message === 'Flashcards require at least one tag'
      ? 'Pick at least one book tag for this flashcard.'
      : 'Could not save flashcard. Please check your inputs.';
    res.status(400).render('flashcards/flashcards_new', {
      title: 'Add Flashcard',
      books,
      error: errorMessage
    });
  }
});

// Edit form
router.get('/edit/:id', async (req, res) => {
  try {
    const [flashcard, books] = await Promise.all([
      Flashcard.findOne({ _id: req.params.id, user: req.user._id }).lean(),
      Book.find({ user: req.user._id }).lean(),
    ]);
    if (!flashcard) {return res.redirect('/flashcards/list');}

    const optionFields = {
      option1: flashcard.options?.[0] || '',
      option2: flashcard.options?.[1] || '',
      option3: flashcard.options?.[2] || '',
      option4: flashcard.options?.[3] || '',
    };

    const selectedTagIds = (flashcard.tags || []).map((tag) => tag.toString());
    const decoratedBooks = books.map((book) => ({
      ...book,
      isSelected: selectedTagIds.includes(book._id.toString()),
    }));

    res.render('flashcards/editFlashcard', {
      title: 'Edit Flashcard',
      flashcard,
      books: decoratedBooks,
      optionFields,
      selectedTagIds,
    });
  } catch (e) {
    console.error(e);
    res.redirect('/flashcards/list');
  }
});

// Handle edit
router.post('/:id/edit', async (req, res) => {
  try {
    const payload = buildFlashcardDoc(req.body, req.user._id);
    const updates = { ...payload };
    delete updates.user;
    await Flashcard.updateOne({ _id: req.params.id, user: req.user._id }, updates);
    res.redirect('/flashcards/list');
  } catch (e) {
    const books = await Book.find({ user: req.user._id }).lean();
    const submittedTags = Array.isArray(req.body.tags)
      ? req.body.tags
      : req.body.tags
        ? [req.body.tags]
        : [];
    const decoratedBooks = books.map((book) => ({
      ...book,
      isSelected: submittedTags.includes(book._id.toString()),
    }));

    const optionFields = {
      option1: req.body.option1 || '',
      option2: req.body.option2 || '',
      option3: req.body.option3 || '',
      option4: req.body.option4 || '',
    };

    res.status(400).render('flashcards/editFlashcard', {
      title: 'Edit Flashcard',
      flashcard: {
        _id: req.params.id,
        question: req.body.question,
        correctIndex: parseInt(req.body.correctIndex, 10) || 0,
      },
      books: decoratedBooks,
      optionFields,
      selectedTagIds: submittedTags,
      error: e.message === 'Flashcards require at least one tag'
        ? 'Pick at least one book tag for this flashcard.'
        : 'Could not update flashcard. Please try again.',
    });
  }
});

// Quiz screen (UI only; questions fetched via client JS)
router.get('/quiz', async (req, res) => {
  const books = await Book.find({ user: req.user._id }).lean();
  res.render('flashcards/flashcards_quiz', { title: 'Take a Quiz', books, user: req.user });

});

// JSON API: return flashcards filtered by tag IDs (book IDs)
router.get('/api/list', async (req, res) => {
  try {
    const filter = buildFlashcardFilter(req.query, req.user._id);
    const cards = await Flashcard.find(filter)
      .select('question options correctIndex tags')
      .lean();
    res.json({ ok: true, cards });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'Failed to load flashcards' });
  }
});

export default router;
