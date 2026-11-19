import { expect } from 'chai';
import { deleteBookAndCleanup } from '../../src/routes/books.mjs';

describe('deleteBookAndCleanup', () => {
  it('detaches notes and book tags without deleting study content', async () => {
    const calls = [];
    const result = await deleteBookAndCleanup('book1', 'userX', {
      BookModel: { deleteOne: async (filter) => { calls.push(['book', filter]); return { deletedCount: 1 }; } },
      NoteModel: { updateMany: async (...args) => calls.push(['notes', ...args]) },
      FlashcardModel: { updateMany: async (...args) => calls.push(['cards', ...args]) },
    });
    expect(result.deletedCount).to.equal(1);
    expect(calls).to.deep.equal([
      ['book', { _id: 'book1', user: 'userX' }],
      ['notes', { book: 'book1', user: 'userX' }, { $set: { book: null } }],
      ['cards', { tags: 'book1', user: 'userX' }, { $pull: { tags: 'book1' } }],
    ]);
  });
  it('does not clean up relationships when the owned book does not exist', async () => {
    const result = await deleteBookAndCleanup('other-book', 'userX', { BookModel: { deleteOne: async () => ({ deletedCount: 0 }) }, NoteModel: {}, FlashcardModel: {} });
    expect(result.deletedCount).to.equal(0);
  });
});
