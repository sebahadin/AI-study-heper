// src/routes/books.mjs
import express from "express";
import { Book } from "../db.mjs";
import { Note } from "../db.mjs";

export async function deleteBookAndCleanup(bookId, userId, deps = {}) {
  const { BookModel = Book, NoteModel = Note } = deps;
  await BookModel.deleteOne({ _id: bookId, user: userId });
  await NoteModel.updateMany(
    { book: bookId, user: userId },
    { $set: { book: null } }
  );
}

const router = express.Router();

// middleware to protect routes
function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) {return next();}
  res.redirect("/login");
}

// ADD BOOK FORM
router.get("/add", ensureAuth, (req, res) => {
  res.render("books/addBook");
});

// POST ADD BOOK
router.post("/add", ensureAuth, async (req, res) => {
  const { title, author, category, url, description } = req.body;
  try {
    await Book.create({
      title,
      author,
      category,
      user: req.user._id,
      description,
      url,
    });
    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.send("Error adding book");
  }
});

// EDIT BOOK FORM
router.get("/:id/edit", ensureAuth, async (req, res) => {
  try {
    const book = await Book.findOne({ _id: req.params.id, user: req.user._id }).lean();
    if (!book) {return res.redirect("/dashboard");}
    res.render("books/editBook", { book });
  } catch (err) {
    console.error(err);
    res.send("Error loading edit form");
  }
});

// POST EDIT BOOK
router.post("/:id/edit", ensureAuth, async (req, res) => {
  const { title, author, category, url, description } = req.body;
  try {
    await Book.updateOne(
      { _id: req.params.id, user: req.user._id },
      { title, author, category, url, description }
    );
    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.send("Error updating book");
  }
});

// BOOK DETAILS
router.get("/:id", ensureAuth, async (req, res) => {
  try {
    const book = await Book.findOne({ _id: req.params.id, user: req.user._id }).lean();
    if (!book) {return res.redirect("/dashboard");}
    res.render("books/bookDetail", { book });
  } catch (err) {
    console.error(err);
    res.send("Error loading book details");
  }
});


// DELETE BOOK
router.post("/:id/delete", ensureAuth, async (req, res) => {
  try {
    await deleteBookAndCleanup(req.params.id, req.user._id);
    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.send("Error deleting book");
  }
});

export default router;
