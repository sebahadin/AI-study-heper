import { describe, expect, it } from 'vitest';
import type { Flashcard } from '../../types';
import { initialQuizState, quizReducer } from './quizState';

const cards: Flashcard[] = [
  { _id: 'one', question: 'First?', options: ['Correct', 'Incorrect'], correctIndex: 0, tags: [] },
  { _id: 'two', question: 'Second?', options: ['Wrong', 'Right'], correctIndex: 1, tags: [] },
];
describe('quiz state', () => {
  it('counts an answer once even if multiple answer events arrive', () => {
    let state = quizReducer(initialQuizState, { type: 'start', cards });
    state = quizReducer(state, { type: 'answer', index: 0 });
    state = quizReducer(state, { type: 'answer', index: 0 });
    expect(state.score).toBe(1);
    expect(state.chosenIndex).toBe(0);
  });
  it('requires an answer before advancing', () => {
    const state = quizReducer(initialQuizState, { type: 'start', cards });
    expect(quizReducer(state, { type: 'next' })).toBe(state);
  });
  it('records missed answers and finishes on the last question', () => {
    let state = quizReducer(initialQuizState, { type: 'start', cards });
    state = quizReducer(state, { type: 'answer', index: 1 });
    state = quizReducer(state, { type: 'next' });
    expect(state.chosenIndex).toBeNull();
    state = quizReducer(state, { type: 'answer', index: 1 });
    state = quizReducer(state, { type: 'next' });
    expect(state.status).toBe('results');
    expect(state.score).toBe(1);
    expect(state.misses).toEqual([{ question: 'First?', chosen: 'Incorrect', correct: 'Correct' }]);
  });
  it('can end early and starts a retry with empty results', () => {
    let state = quizReducer(initialQuizState, { type: 'start', cards });
    state = quizReducer(state, { type: 'answer', index: 1 });
    state = quizReducer(state, { type: 'finish' });
    expect(state.status).toBe('results');
    state = quizReducer(state, { type: 'start', cards });
    expect(state.score).toBe(0);
    expect(state.misses).toEqual([]);
    expect(state.index).toBe(0);
  });
  it('ignores invalid answers and empty quizzes', () => {
    const state = quizReducer(initialQuizState, { type: 'start', cards });
    expect(quizReducer(state, { type: 'answer', index: 99 })).toBe(state);
    expect(quizReducer(state, { type: 'start', cards: [] }).status).toBe('idle');
  });
});
