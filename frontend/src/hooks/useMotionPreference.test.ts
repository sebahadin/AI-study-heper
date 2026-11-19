import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMotionPreference } from './useMotionPreference';

beforeEach(() => { localStorage.removeItem('classmate-motion'); });
afterEach(() => { cleanup(); localStorage.removeItem('classmate-motion'); vi.unstubAllGlobals(); });
function media(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
}
describe('motion preferences', () => {
  it('persists the choice to turn decorative motion off', () => {
    media(false);
    const { result } = renderHook(() => useMotionPreference());
    expect(result.current.enabled).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(false);
    expect(localStorage.getItem('classmate-motion')).toBe('off');
  });
  it('respects the device reduced-motion preference', () => {
    media(true);
    const { result } = renderHook(() => useMotionPreference());
    expect(result.current.systemReduced).toBe(true);
    expect(result.current.enabled).toBe(false);
  });
});
