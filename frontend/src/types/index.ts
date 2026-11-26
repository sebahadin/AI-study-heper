export interface User { _id: string; username: string; email: string }
export interface CourseRef { _id: string; title: string; code?: string; color?: string }
export interface Course extends CourseRef {
  term?: string; instructor?: string; description?: string;
  createdAt?: string; updatedAt?: string;
  counts?: { books: number; notes: number; flashcards: number };
}
export interface CourseDetailData { course: Course; books: Book[]; notes: Note[]; flashcards: Flashcard[] }
export interface BookRef { _id: string; title: string; color?: string | null; author?: string; category?: string; courses?: (CourseRef | string)[] }
export interface Book extends BookRef {
  author: string;
  category: string;
  description?: string;
  url?: string;
  isFavorite?: boolean;
}
export interface Note {
  _id: string;
  title: string;
  content: string;
  courses?: (CourseRef | string)[];
  contentHtml?: string | null;
  updatedAt?: string;
  book: BookRef | string | null;
  createdAt?: string;
}
export interface Flashcard {
  _id: string;
  question: string;
  courses?: (CourseRef | string)[];
  options: string[];
  correctIndex: number;
  tags: (BookRef | string)[];
  createdAt?: string;
}
export interface DashboardData { courses?: Course[]; books: Book[]; notes: Note[]; flashcardsCount: number }
export type FieldErrors = Record<string, string>;

export interface MaterialConnections {
  book: Book | null;
  courses: Course[];
  notes: Note[];
  flashcards: Flashcard[];
  books: Book[];
}
export interface BookDetailData { book: Book; related?: MaterialConnections }
export interface NoteDetailData { note: Note; related?: MaterialConnections }

export interface StudyDocument {
  _id: string; title: string; filename: string;
  status: 'awaiting_upload' | 'validating' | 'uploaded' | 'failed' | 'deleting';
  courses: string[]; book: string | null; note: string | null;
  byteCount: number | null; pageCount: number | null; sourceVersion: string | null;
  error: { code: string; message: string } | null;
  uploadExpiresAt: string; createdAt: string; updatedAt: string;
}
export interface DocumentOptions {
  courses: CourseRef[]; books: BookRef[];
  notes: { _id: string; title: string; courses?: string[]; book: string | null }[];
}
export interface DocumentPage { documents: StudyDocument[]; nextCursor: string | null }
export interface DocumentPolicy { maxPages: number; maxBytes: number }
export interface DocumentUploadIntent {
  document: StudyDocument; policy: DocumentPolicy;
  upload: { url: string; method: 'PUT'; headers: { 'Content-Type': string }; expiresAt: string };
}
