import type { Flashcard } from '../../types';

export interface Miss { question: string; chosen: string; correct: string }
export interface QuizState {
  cards: Flashcard[];
  index: number;
  chosenIndex: number | null;
  score: number;
  misses: Miss[];
  status: 'idle' | 'active' | 'results';
}
export type QuizAction = { type: 'start'; cards: Flashcard[] } | { type: 'answer'; index: number } | { type: 'next' } | { type: 'finish' } | { type: 'reset' };
export const initialQuizState: QuizState = { cards: [], index: 0, chosenIndex: null, score: 0, misses: [], status: 'idle' };

export function quizReducer(state: QuizState, action: QuizAction): QuizState {
  if (action.type === 'start') { return { ...initialQuizState, cards: action.cards, status: action.cards.length ? 'active' : 'idle' }; }
  if (action.type === 'reset') { return initialQuizState; }
  if (state.status !== 'active') { return state; }
  if (action.type === 'finish') { return { ...state, status: 'results' }; }
  if (action.type === 'answer') {
    const card = state.cards[state.index];
    if (state.chosenIndex !== null || !Number.isInteger(action.index) || action.index < 0 || action.index >= card.options.length) { return state; }
    const correct = action.index === card.correctIndex;
    return { ...state, chosenIndex: action.index, score: state.score + (correct ? 1 : 0), misses: correct ? state.misses : [...state.misses, { question: card.question, chosen: card.options[action.index], correct: card.options[card.correctIndex] }] };
  }
  if (action.type === 'next' && state.chosenIndex !== null) {
    return state.index === state.cards.length - 1 ? { ...state, status: 'results' } : { ...state, index: state.index + 1, chosenIndex: null };
  }
  return state;
}
