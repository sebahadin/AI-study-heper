export const bookColors = ['#b5a4dc', '#a6c8c1', '#d5b8a0', '#a8b4d2', '#db9bb2', '#799bb8', '#96ae89', '#d7b870'];
export function normalizeBookColor(value: string): string | null {
  const hex = value.trim().replace(/^#/, '');
  if (/^[\da-f]{6}$/i.test(hex)) { return `#${hex.toLowerCase()}`; }
  if (/^[\da-f]{3}$/i.test(hex)) { return `#${[...hex].map(char => char + char).join('').toLowerCase()}`; }
  return null;
}
export function bookInk(color: string) {
  const normalized = normalizeBookColor(color);
  if (!normalized) { return '#30293d'; }
  const values = [1, 3, 5].map(offset => parseInt(normalized.slice(offset, offset + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
  return (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? '#000000' : '#ffffff';
}
