//db.mjs
import mongoose from 'mongoose';
import { settings } from './config.mjs';

export async function connectDatabase(dsn = settings.dsn) {
    if (!dsn) {
        throw new Error('DSN environment variable is required');
    }
    return mongoose.connect(dsn);
}

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});

const courseSchema = new mongoose.Schema({
    title: { type: String, required: true },
    code: { type: String, default: '' },
    term: { type: String, default: '' },
    instructor: { type: String, default: '' },
    description: { type: String, default: '' },
    color: { type: String, enum: ['violet', 'blue', 'mint', 'peach', 'rose'], default: 'violet' },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
}, { timestamps: true });
const courseRefs = () => ({ type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }], default: [] });

const bookSchema = new mongoose.Schema({
    color: { type: String, default: null, validate: value => value === null || /^#[0-9a-f]{6}$/i.test(value) },
    courses: courseRefs(),
    title: { type: String, required: true },
    author: { type: String, required: true },
    category: { type: String, required: true },
    description: { type: String },
    url: { type: String },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isFavorite: { type: Boolean, default: false }
});



const noteSchema = new mongoose.Schema({
    courses: courseRefs(),

    title: { type: String, required: true },

    content: { type: String, required: true },
    contentHtml: { type: String, default: null },
    updatedAt: { type: Date, default: Date.now },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    book: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', default: null },
    createdAt: { type: Date, default: Date.now }
});


const flashcardSchema = new mongoose.Schema({
    courses: courseRefs(),
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
  



for (const schema of [bookSchema, noteSchema, flashcardSchema]) { schema.index({ user: 1, courses: 1 }); }
const Course = mongoose.model('Course', courseSchema);
const User = mongoose.model('User', userSchema);
const Book = mongoose.model('Book', bookSchema);
const Note = mongoose.model('Note', noteSchema);
const Flashcard = mongoose.model('Flashcard', flashcardSchema);
export { User, Course, Book, Note, Flashcard };
