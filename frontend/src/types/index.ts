export interface User { _id: string; username: string; email: string }
export interface BookRef { _id: string; title: string }
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
  contentHtml?: string | null;
  updatedAt?: string;
  book: BookRef | string | null;
  createdAt?: string;
}
export interface Flashcard {
  _id: string;
  question: string;
  options: string[];
  correctIndex: number;
  tags: (BookRef | string)[];
  createdAt?: string;
}
export interface DashboardData { books: Book[]; notes: Note[]; flashcardsCount: number }
export type FieldErrors = Record<string, string>;
