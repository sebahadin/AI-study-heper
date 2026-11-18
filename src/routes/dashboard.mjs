// src/routes/dashboard.mjs
import express from "express";
import { Book, Note, Flashcard } from "../db.mjs";

const router = express.Router();

// Inline auth guard
function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) {return next();}
  res.redirect("/login");
}

// Dashboard: lists all user content
router.get("/", ensureAuth, async (req, res) => {
  try {
    const [books, notes, flashcards] = await Promise.all([
      Book.find({ user: req.user._id }).lean(),
      Note.find({ user: req.user._id }).lean(),
      Flashcard.find({ user: req.user._id }).lean(),
    ]);

    res.render("dashboard", {
      user: req.user,
      books,
      notes,
      flashcardsCount: flashcards.length,
    });
  } catch (err) {
    console.error(err);
    res.send("Error loading dashboard");
  }
});

export default router;
