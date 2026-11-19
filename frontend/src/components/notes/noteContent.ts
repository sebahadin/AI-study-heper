import createDOMPurify from 'dompurify';

const purifier = createDOMPurify(window);
const colors = /^(?:#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|transparent|inherit)$/i;
const fonts = /^(?:Inter|Arial|Georgia|Times New Roman|Verdana|Courier New|sans-serif|serif|monospace)(?:,\s*(?:sans-serif|serif|monospace))?$/i;
const styles: Record<string, RegExp> = {
  color: colors,
  'background-color': colors,
  'font-family': fonts,
  'font-size': /^(?:[8-9]|[1-6]\d|7[0-2])(?:px|pt)$/,
  'text-align': /^(left|center|right|justify)$/,
};
purifier.addHook('afterSanitizeAttributes', (node) => {
  if (!(node instanceof HTMLElement)) { return; }
  if (node.hasAttribute('style')) {
    const safe = Array.from(node.style).filter((key) => {
      // Browsers may quote font names when parsing CSS.
      const value = node.style.getPropertyValue(key).replace(/["']/g, '').trim();
      return styles[key]?.test(value);
    }).map((key) => `${key}:${node.style.getPropertyValue(key).replace(/["']/g, '').trim()}`).join(';');
    if (safe) { node.setAttribute('style', safe); } else { node.removeAttribute('style'); }
  }
  if (node.tagName === 'A') {
    if (!isSafeNoteLink(node.getAttribute('href') || '')) { node.removeAttribute('href'); }
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function isSafeNoteLink(value: string) {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol);
  } catch { return false; }
}
export function sanitizeNoteHtml(html: string) {
  return purifier.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'h1', 'h2', 'h3', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'a', 'span', 'mark'],
    ALLOWED_ATTR: ['style', 'href', 'target', 'rel', 'start'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
}
export function plainTextToHtml(content: string) {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return content.split(/\r?\n/).map((line) => `<p>${escape(line) || '<br>'}</p>`).join('');
}
export function noteHtml(note: { content: string; contentHtml?: string | null }) {
  return note.contentHtml ? sanitizeNoteHtml(note.contentHtml) : plainTextToHtml(note.content);
}
export function wordCount(content: string) { return content.trim().split(/\s+/).filter(Boolean).length; }
