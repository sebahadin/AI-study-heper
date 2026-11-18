// src/routes/notes.mjs
import express from "express";
import { Note, Book } from "../db.mjs";

const router = express.Router();

// simple inline middleware
function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) {return next();}
  res.redirect("/login");
}

// ADD NOTE FORM
router.get("/add", ensureAuth, async (req, res) => {
  const books = await Book.find({ user: req.user._id }).lean();
  res.render("notes/addNote", { books });
});

// POST ADD NOTE
router.post("/add", ensureAuth, async (req, res) => {
  const { title, content, book } = req.body;
  try {
    await Note.create({
      title,
      content,
      user: req.user._id,
      book: book || null,
    });
    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.send("Error adding note");
  }
});

// EDIT NOTE FORM
router.get("/:id/edit", ensureAuth, async (req, res) => {
  try {
    const note = await Note.findOne({ _id: req.params.id, user: req.user._id }).lean();
    const books = await Book.find({ user: req.user._id }).lean();
    if (!note) {return res.redirect("/dashboard");}
    res.render("notes/editNote", { note, books });
  } catch (err) {
    console.error(err);
    res.send("Error loading edit form");
  }
});

// POST EDIT NOTE
router.post("/:id/edit", ensureAuth, async (req, res) => {
  const { title, content, book } = req.body;
  try {
    await Note.updateOne(
      { _id: req.params.id, user: req.user._id },
      { title, content, book: book || null }
    );
    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.send("Error updating note");
  }
});

// NOTE DETAILS
router.get("/:id", ensureAuth, async (req, res) => {
  try {
    const note = await Note.findOne({ _id: req.params.id, user: req.user._id })
      .populate("book", "title")
      .lean();
    if (!note) {return res.redirect("/dashboard");}
    res.render("notes/noteDetail", { note });
  } catch (err) {
    console.error(err);
    res.send("Error loading note details");
  }
});

// DELETE NOTE
router.post("/:id/delete", ensureAuth, async (req, res) => {
  try {
    await Note.deleteOne({ _id: req.params.id, user: req.user._id });
    res.redirect("/dashboard");
  } catch (err) {
    console.error(err);
    res.send("Error deleting note");
  }
});



export default router;
