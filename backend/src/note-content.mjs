import sanitizeHtml from 'sanitize-html';
import { convert } from 'html-to-text';
import { HttpError, text } from './http.mjs';

const color = /^(?:#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|transparent|inherit)$/i;
const font = /^["']?(?:Inter|Arial|Georgia|Times New Roman|Verdana|Courier New|sans-serif|serif|monospace)["']?(?:,\s*(?:sans-serif|serif|monospace))?$/i;
const size = /^(?:[8-9]|[1-6]\d|7[0-2])(?:px|pt)$/;
const allowedTags = ['p', 'br', 'h1', 'h2', 'h3', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'a', 'span', 'mark'];

export function sanitizeNoteHtml(html) {
  return sanitizeHtml(html, {
    allowedTags,
    allowedAttributes: { '*': ['style'], a: ['href', 'target', 'rel'], ol: ['start'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    allowedStyles: { '*': {
      color: [color], 'background-color': [color], 'font-family': [font],
      'font-size': [size], 'text-align': [/^(left|center|right|justify)$/],
    } },
    transformTags: { a: (_tag, attributes) => ({ tagName: 'a', attribs: { ...attributes, target: '_blank', rel: 'noopener noreferrer' } }) },
  });
}

export function noteContentFields(body, partial = false) {
  if (Object.hasOwn(body || {}, 'contentHtml') && body.contentHtml !== null) {
    if (typeof body.contentHtml !== 'string' || body.contentHtml.length > 500000) {
      throw new HttpError(400, 'Check the highlighted fields.', { content: 'Use a document smaller than 500,000 characters.' });
    }
    const contentHtml = sanitizeNoteHtml(body.contentHtml);
    const content = convert(contentHtml, {
      wordwrap: false,
      selectors: [
        { selector: 'a', options: { ignoreHref: true } },
        ...['h1', 'h2', 'h3'].map(selector => ({ selector, options: { uppercase: false } })),
      ],
    }).trim();
    if (!content.replace(/[\s\u200B]/g, '')) {
      throw new HttpError(400, 'Check the highlighted fields.', { content: 'Write something in your note before saving.' });
    }
    return { content, contentHtml };
  }
  if (!partial || Object.hasOwn(body || {}, 'content') || Object.hasOwn(body || {}, 'contentHtml')) {
    return { content: text(body, 'content'), contentHtml: null };
  }
  return {};
}
