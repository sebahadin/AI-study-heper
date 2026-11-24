export type ThemePreference = 'system' | 'dark' | 'light' | 'forest';
export const themeKey = 'classmate-theme';
export function readTheme(): ThemePreference {
  try { const value = localStorage.getItem(themeKey); if (['system', 'dark', 'light', 'forest'].includes(value || '')) return value as ThemePreference; } catch { /* The theme still works without browser storage. */ }
  return 'dark';
}
export function resolvedTheme(preference: ThemePreference) {
  return preference === 'system' ? window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : preference;
}
export function applyTheme(preference: ThemePreference) {
  const theme = resolvedTheme(preference);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === 'light' ? 'light' : 'dark';
  return theme;
}
