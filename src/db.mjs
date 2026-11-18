//db.mjs
import mongoose from 'mongoose';
import { config } from "dotenv";

config();

const isTest = process.env.NODE_ENV === 'test';
const dsn = process.env.DSN;
if (!isTest && dsn) {
    await mongoose.connect(dsn);
} else if (!isTest && !dsn) {
    throw new Error('DSN environment variable is required');
}

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});

const bookSchema = new mongoose.Schema({
    title: { type: String, required: true },
    author: { type: String, required: true },
    category: { type: String, required: true },
    description: { type: String },
    url: { type: String },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isFavorite: { type: Boolean, default: false }
});



const noteSchema = new mongoose.Schema({

    title: { type: String, required: true },

    content: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    book: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', default: null },
    createdAt: { type: Date, default: Date.now }
});


const flashcardSchema = new mongoose.Schema({
    question: { type: String, required: true },
    options: {
      type: [String],
      validate: v => Array.isArray(v) && v.length >= 2,
      required: true
    },
    correctIndex: { type: Number, required: true, min: 0 },
    // tags are Books the question relates to
    tags: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true }],
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, default: Date.now }
  });
  



const User = mongoose.model('User', userSchema);
const Book = mongoose.model('Book', bookSchema);
const Note = mongoose.model('Note', noteSchema);
const Flashcard = mongoose.model('Flashcard', flashcardSchema);
export { User, Book, Note, Flashcard };
