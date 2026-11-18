import { expect } from 'chai';
import { buildFlashcardDoc, buildFlashcardFilter } from '../../src/routes/flashcards.mjs';

describe('flashcards helpers', () => {
  describe('buildFlashcardDoc', () => {
    it('normalizes options and tags for creation', () => {
      const payload = buildFlashcardDoc(
        {
          question: 'What is Node?',
          option1: 'Runtime',
          option2: '',
          option3: 'Framework',
          option4: undefined,
          correctIndex: '0',
          tags: 'abc123',
        },
        'user-1'
      );

      expect(payload).to.deep.equal({
        question: 'What is Node?',
        options: ['Runtime', 'Framework'],
        correctIndex: 0,
        tags: ['abc123'],
        user: 'user-1',
      });
    });

    it('keeps existing arrays of tags intact', () => {
      const payload = buildFlashcardDoc(
        {
          question: 'Pick colors',
          option1: 'Red',
          option2: 'Blue',
          correctIndex: '1',
          tags: ['one', 'two'],
        },
        'user-2'
      );

      expect(payload.tags).to.deep.equal(['one', 'two']);
      expect(payload.options).to.deep.equal(['Red', 'Blue']);
      expect(payload.correctIndex).to.equal(1);
    });
  });

  describe('buildFlashcardFilter', () => {
    it('returns base filter when no tags provided', () => {
      const filter = buildFlashcardFilter({}, 'user-3');
      expect(filter).to.deep.equal({ user: 'user-3' });
    });

    it('applies tag filtering when provided', () => {
      const filter = buildFlashcardFilter({ tags: 'a,,b , c ' }, 'user-4');
      expect(filter).to.deep.equal({
        user: 'user-4',
        tags: { $in: ['a', 'b', 'c'] },
      });
    });

    it('supports multiple query parameters for tags', () => {
      const filter = buildFlashcardFilter({ tags: ['id1', 'id2'] }, 'user-9');
      expect(filter).to.deep.equal({
        user: 'user-9',
        tags: { $in: ['id1', 'id2'] },
      });
    });
  });
});
