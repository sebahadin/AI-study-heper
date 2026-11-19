import type { BookRef } from '../types';

export function BookTags({ books, selected, onChange, disabled = false, label = 'Related books' }: { books: BookRef[]; selected: string[]; onChange: (ids: string[]) => void; disabled?: boolean; label?: string }) {
  return <fieldset className="tag-fieldset" disabled={disabled}><legend>{label}</legend><div className="tag-grid">
    {books.map((book) => <label key={book._id} className="tag-checkbox"><input type="checkbox" value={book._id} checked={selected.includes(book._id)} onChange={(e) => onChange(e.target.checked ? [...selected, book._id] : selected.filter((id) => id !== book._id))} /><span>{book.title}</span></label>)}
    {!books.length && <p className="empty">Add a book to start tagging flashcards.</p>}
  </div></fieldset>;
}
