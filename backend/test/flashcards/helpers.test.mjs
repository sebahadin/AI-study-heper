import { expect } from 'chai';
import { buildFlashcardDoc, buildFlashcardFilter } from '../../src/routes/flashcards.mjs';

describe('flashcard input validation', () => {
  it('keeps the selected answer correct when an optional option is blank', () => {
    const doc = buildFlashcardDoc({ question: 'Example?', options: ['One', 'Two', '', 'Four'], correctIndex: 3, tags: ['book1'] }, 'student');
    expect(doc.options).to.deep.equal(['One', 'Two', 'Four']);
    expect(doc.correctIndex).to.equal(2);
  });
  it('accepts the previous option field names and normalizes duplicate tags', () => {
    const doc = buildFlashcardDoc({ question: 'Example?', option1: 'A', option2: 'B', correctIndex: '0', tags: ['book1', 'book1'] }, 'student');
    expect(doc.options).to.deep.equal(['A', 'B']);
    expect(doc.tags).to.deep.equal(['book1']);
  });
  it('rejects missing tags and invalid or empty correct answers', () => {
    const body = { question: 'Example?', options: ['One', 'Two', ''], correctIndex: 0, tags: ['book'] };
    for (const changes of [{ tags: [] }, { correctIndex: 2 }, { correctIndex: 9 }, { correctIndex: '' }, { correctIndex: 0.5 }, { options: ['Only one'] }]) {
      expect(() => buildFlashcardDoc({ ...body, ...changes }, 'student')).to.throw();
    }
  });
  it('filters by any selected book while keeping the owner condition', () => {
    expect(buildFlashcardFilter({ tags: 'one,,two' }, 'student')).to.deep.equal({ user: 'student', tags: { $in: ['one', 'two'] } });
    expect(buildFlashcardFilter({}, 'student')).to.deep.equal({ user: 'student' });
    expect(buildFlashcardFilter({ tags: ['one', 'two'] }, 'student').tags.$in).to.deep.equal(['one', 'two']);
  });
});
