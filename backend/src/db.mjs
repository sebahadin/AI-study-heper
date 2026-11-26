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

const indexingJobSchema = new mongoose.Schema({
    jobId: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, required: true },
    sourceVersion: { type: String, required: true },
    status: { type: String, enum: ['queued', 'processing', 'failed', 'ready'], required: true },
    attempts: { type: Number, required: true, min: 0 },
    maxAttempts: { type: Number, required: true, min: 1 },
    availableAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
    leaseToken: { type: String, default: null },
    leaseUntil: { type: Date, default: null },
    error: { type: new mongoose.Schema({ code: String, message: String }, { _id: false }), default: null },
    lastFailureTokenHash: String,
    lastFailureCode: String,
    lastFailureRetryable: Boolean,
}, { _id: false });

const documentSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, maxlength: 200 },
    filename: { type: String, required: true, maxlength: 255 },
    courses: courseRefs(),
    book: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', default: null },
    note: { type: mongoose.Schema.Types.ObjectId, ref: 'Note', default: null },
    status: { type: String, enum: ['awaiting_upload', 'validating', 'uploaded', 'failed', 'deleting'], required: true },
    expectedBytes: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    maxBytes: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    uploadKey: { type: String, required: true },
    uploadExpiresAt: { type: Date, required: true },
    finalizeUntil: { type: Date, required: true },
    validationToken: { type: String, default: null },
    validationLeaseUntil: { type: Date, default: null },
    objectKey: { type: String, default: null },
    sourceVersion: { type: String, default: null },
    pageCount: { type: Number, min: 1, validate: Number.isSafeInteger },
    byteCount: { type: Number, min: 1, validate: Number.isSafeInteger },
    sha256: { type: String, match: /^[0-9a-f]{64}$/ },
    indexing: { type: indexingJobSchema, default: undefined },
    error: { type: new mongoose.Schema({ code: String, message: String }, { _id: false }), default: null },
}, { timestamps: true });
documentSchema.index({ user: 1, createdAt: -1 });
documentSchema.index({ user: 1, courses: 1 });
documentSchema.index({ status: 1, 'indexing.status': 1, 'indexing.availableAt': 1 });
documentSchema.index({ status: 1, 'indexing.status': 1, 'indexing.leaseUntil': 1 });
documentSchema.index({ 'indexing.jobId': 1 }, {
    unique: true, partialFilterExpression: { 'indexing.jobId': { $type: 'string' } },
});
const Document = mongoose.model('Document', documentSchema);
export { User, Course, Book, Note, Flashcard, Document };
