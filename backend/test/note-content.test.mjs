import { expect } from 'chai';
import { sanitizeNoteHtml, noteContentFields } from '../src/note-content.mjs';

describe('Formatted note content', () => {
  it('preserves supported typography and derives plain text for previews and search', () => {
    const fields = noteContentFields({ content: 'untrusted preview', contentHtml: '<h2>My idea</h2><p><strong>Bold</strong> and <span style="font-family:Georgia;font-size:24pt;color:#764abc">color</span></p><ol start="3"><li>First point</li></ol>' });
    expect(fields.contentHtml).to.include('<strong>Bold</strong>').and.include('font-family:Georgia').and.include('font-size:24pt');
    expect(fields.content).to.include('My idea').and.include('Bold and color').and.include('First point').and.not.include('<');
    expect(fields.content).not.to.include('untrusted preview');
  });
  it('removes executable markup and unsafe styles and links', () => {
    const html = sanitizeNoteHtml('<script>alert(1)</script><img src=x onerror=alert(2)><p onclick="alert(3)" style="position:fixed;background-image:url(https://evil.example)">Safe</p><a href="javascript:alert(4)">link</a><a href="//evil.example">relative</a><a href="https://example.com" target="_self">good</a>');
    expect(html).not.to.match(/script|onerror|onclick|position|background-image|javascript:|\/\/evil/);
    expect(html).to.include('Safe').and.include('href="https://example.com"').and.include('rel="noopener noreferrer"');
  });
  it('rejects invisible or formatting-only notes', () => {
    for (const contentHtml of ['<p><br></p>', '<script>hidden</script>', '<p>&nbsp;\u200B</p>']) {
      expect(() => noteContentFields({ contentHtml })).to.throw('Check the highlighted fields.');
    }
  });
  it('keeps legacy plain text literal and clears stale rich text only when content changes', () => {
    expect(noteContentFields({ content: 'Show <b>markup</b> literally' })).to.deep.equal({ content: 'Show <b>markup</b> literally', contentHtml: null });
    expect(noteContentFields({ title: 'Rename only' }, true)).to.deep.equal({});
    expect(noteContentFields({ content: 'Plain replacement' }, true).contentHtml).to.equal(null);
    expect(() => noteContentFields({ contentHtml: {} })).to.throw();
  });
});
