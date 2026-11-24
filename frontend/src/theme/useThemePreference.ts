import { useEffect, useState } from 'react';
import { applyTheme, readTheme, themeKey, type ThemePreference } from './preferences';

export function useThemePreference() {
  const [preference, setPreference] = useState<ThemePreference>(readTheme);
  useEffect(() => {
    applyTheme(preference);
    try { localStorage.setItem(themeKey, preference); } catch { /* Appearance is still applied for this session. */ }
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const update = () => applyTheme(preference);
    media?.addEventListener('change', update);
    return () => media?.removeEventListener('change', update);
  }, [preference]);
  return { preference, setPreference };
}
