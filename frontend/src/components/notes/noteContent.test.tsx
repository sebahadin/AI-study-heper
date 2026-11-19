import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NoteDocument } from './NoteDocument';
import { noteHtml, sanitizeNoteHtml, wordCount } from './noteContent';

describe('safe, backwards-compatible note documents', () => {
  it('renders legacy markup as literal text and preserves line breaks', () => {
    render(<NoteDocument content={'Show <b>literal markup</b> & symbols.\nSecond line'} />);
    expect(screen.getByText('Show <b>literal markup</b> & symbols.')).toBeInTheDocument();
    expect(screen.getByText('Second line')).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
    expect(noteHtml({ content: '<script>literal</script>' })).toContain('&lt;script&gt;');
  });
  it('keeps stored headings, lists, font styles, and emphasis in reading mode', () => {
    render(<NoteDocument content="Searchable text" contentHtml={'<h2>Study plan</h2><p><strong>Remember</strong> <span style="font-family: Georgia; font-size: 24px; color: rgb(12, 34, 56)">this</span></p><ul><li>Review</li></ul>'} />);
    expect(screen.getByRole('heading', { name: 'Study plan' })).toBeInTheDocument();
    expect(screen.getByText('Remember').tagName).toBe('STRONG');
    expect(screen.getByText('this')).toHaveStyle({ fontFamily: 'Georgia', fontSize: '24px', color: 'rgb(12, 34, 56)' });
    expect(screen.getByRole('listitem')).toHaveTextContent('Review');
  });
  it('removes unsafe markup, CSS and links even when loading stored content', () => {
    const html = sanitizeNoteHtml('<img src=x onerror=alert(1)><script>bad()</script><p style="position:fixed;background-image:url(https://tracker.example);font-size:24px">Safe</p><a href="javascript:alert(2)">link</a><a href="https://example.com">good</a>');
    expect(html).not.toMatch(/img|script|onerror|javascript:|position|background-image/);
    const holder = document.createElement('div'); holder.innerHTML = html;
    expect(holder.querySelector('p')).toHaveStyle({ fontSize: '24px' });
    expect(holder.querySelectorAll('a')[0]).not.toHaveAttribute('href');
    expect(holder.querySelectorAll('a')[1]).toHaveAttribute('rel', 'noopener noreferrer');
  });
  it('counts words without inventing words for blank content', () => {
    expect(wordCount('  ')).toBe(0);
    expect(wordCount('One\nTwo   Three')).toBe(3);
  });
});
