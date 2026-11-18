import { expect } from 'chai';
import { deleteBookAndCleanup } from '../../src/routes/books.mjs';

describe('deleteBookAndCleanup', () => {
  it('removes the book and detaches related notes', async () => {
    const deleteCalls = [];
    const updateCalls = [];

    await deleteBookAndCleanup('book1', 'userX', {
      BookModel: {
        deleteOne: async (query) => deleteCalls.push(query),
      },
      NoteModel: {
        updateMany: async (query, update) => updateCalls.push({ query, update }),
      },
    });

    expect(deleteCalls).to.deep.equal([{ _id: 'book1', user: 'userX' }]);
    expect(updateCalls).to.deep.equal([
      {
        query: { book: 'book1', user: 'userX' },
        update: { $set: { book: null } },
      },
    ]);
  });
});
