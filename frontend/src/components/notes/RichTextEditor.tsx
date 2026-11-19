import { useEffect, useState, type ReactNode } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyleKit } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Placeholder from '@tiptap/extension-placeholder';
import { isSafeNoteLink, noteHtml, sanitizeNoteHtml } from './noteContent';

export function useNoteEditor(note: { content: string; contentHtml?: string | null }, onChange: (html: string, text: string) => void) {
  return useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, protocols: ['http', 'https', 'mailto'], HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' } },
      }),
      TextStyleKit.configure({ backgroundColor: false, lineHeight: false }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Highlight.configure({ multicolor: true }),
      Placeholder.configure({ placeholder: 'Start with a thought. Make this page yours…' }),
    ],
    content: noteHtml(note),
    editorProps: { transformPastedHTML: sanitizeNoteHtml, attributes: { class: 'rich-document note-writing-content', role: 'textbox', 'aria-label': 'Note content', 'aria-multiline': 'true', 'aria-required': 'true', spellcheck: 'true' } },
    onUpdate: ({ editor }) => onChange(editor.getHTML(), editor.getText({ blockSeparator: '\n' })),
  });
}

function ToolButton({ label, children, active, disabled, onClick }: { label: string; children: ReactNode; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className={`format-button${active ? ' is-active' : ''}`} title={label} aria-label={label} aria-pressed={active === undefined ? undefined : active} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{children}</button>;
}
function ToolIcon({ name }: { name: 'undo' | 'redo' | 'left' | 'center' | 'right' | 'bullet' | 'number' | 'link' | 'quote' | 'clear' }) {
  const paths = {
    undo: <path d="m8 5-5 5 5 5M3 10h10a6 6 0 0 1 6 6v3" />,
    redo: <path d="m16 5 5 5-5 5m5-5H11a6 6 0 0 0-6 6v3" />,
    left: <path d="M4 5h16M4 10h10M4 15h16M4 20h10" />,
    center: <path d="M4 5h16M7 10h10M4 15h16M7 20h10" />,
    right: <path d="M4 5h16M10 10h10M4 15h16M10 20h10" />,
    bullet: <><path d="M9 6h12M9 12h12M9 18h12" /><circle cx="3" cy="6" r="1" /><circle cx="3" cy="12" r="1" /><circle cx="3" cy="18" r="1" /></>,
    number: <><path d="M10 6h11M10 12h11M10 18h11M3 3h1v6M2 13c3-2 4 0 2 2l-2 3h4" /></>,
    link: <path d="m10 13 4-4M8 16l-2 2a4 4 0 0 1-5-5l4-4a4 4 0 0 1 6 0m2-1 2-2a4 4 0 1 1 6 6l-4 4a4 4 0 0 1-6-1" />,
    quote: <><path d="M4 11h5v7H3v-6c0-5 2-7 6-7M15 11h5v7h-6v-6c0-5 2-7 6-7" /></>,
    clear: <path d="M4 4h14M11 4l-3 14M3 21l18-18M15 16l5 5m0-5-5 5" />,
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function NoteToolbar({ editor }: { editor: Editor }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const [linkError, setLinkError] = useState('');
  const state = useEditorState({ editor, selector: ({ editor: e }) => ({
    bold: e.isActive('bold'), italic: e.isActive('italic'), underline: e.isActive('underline'), strike: e.isActive('strike'),
    bullet: e.isActive('bulletList'), ordered: e.isActive('orderedList'), quote: e.isActive('blockquote'), link: e.isActive('link'),
    heading: e.isActive('heading') ? String(e.getAttributes('heading').level) : 'paragraph',
    font: e.getAttributes('textStyle').fontFamily || 'Inter', size: e.getAttributes('textStyle').fontSize || '16px',
    color: e.getAttributes('textStyle').color || '#252a38',
    left: e.isActive({ textAlign: 'left' }) || !e.getAttributes('paragraph').textAlign && !e.getAttributes('heading').textAlign,
    center: e.isActive({ textAlign: 'center' }), right: e.isActive({ textAlign: 'right' }),
    highlight: e.isActive('highlight'), undo: e.can().undo(), redo: e.can().redo(),
  }) });
  function applyLink() {
    const value = linkValue.trim();
    if (!value) { editor.chain().focus().extendMarkRange('link').unsetLink().run(); }
    else {
      const href = /^(https?:|mailto:)/i.test(value) ? value : `https://${value}`;
      if (!isSafeNoteLink(href) || /^(javascript|data|vbscript):/i.test(value)) { setLinkError('Enter a valid web address or mailto: link.'); return; }
      const chain = editor.chain().focus().extendMarkRange('link');
      if (editor.state.selection.empty && !editor.isActive('link')) { chain.insertContent({ type: 'text', text: value, marks: [{ type: 'link', attrs: { href } }] }).run(); }
      else { chain.setLink({ href }).run(); }
    }
    setLinkOpen(false); setLinkError('');
  }
  return <div className="note-toolbar-shell">
    <div className="note-toolbar" role="group" aria-label="Text formatting">
      <div className="format-group"><ToolButton label="Undo" disabled={!state.undo} onClick={() => editor.chain().focus().undo().run()}><ToolIcon name="undo" /></ToolButton><ToolButton label="Redo" disabled={!state.redo} onClick={() => editor.chain().focus().redo().run()}><ToolIcon name="redo" /></ToolButton></div>
      <div className="format-group format-type-controls">
        <select aria-label="Text style" value={state.heading} onChange={(e) => { const level = Number(e.target.value); if (level) { editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 }).run(); } else { editor.chain().focus().setParagraph().run(); } }}><option value="paragraph">Normal text</option><option value="1">Title</option><option value="2">Heading 1</option><option value="3">Heading 2</option></select>
        <select aria-label="Font family" value={state.font} onChange={(e) => editor.chain().focus().setFontFamily(e.target.value).run()}>{['Inter', 'Arial', 'Georgia', 'Times New Roman', 'Verdana', 'Courier New'].map((font) => <option key={font} value={font}>{font}</option>)}</select>
        <select className="font-size-select" aria-label="Font size" value={state.size} onChange={(e) => editor.chain().focus().setFontSize(e.target.value).run()}>{['12px', '14px', '16px', '18px', '20px', '24px', '32px', '48px', '64px'].map((size) => <option key={size} value={size}>{size.replace('px', '')}</option>)}{!['12px', '14px', '16px', '18px', '20px', '24px', '32px', '48px', '64px'].includes(state.size) && <option value={state.size}>{state.size}</option>}</select>
      </div>
      <div className="format-group">
        <ToolButton label="Bold (⌘/Ctrl+B)" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></ToolButton>
        <ToolButton label="Italic (⌘/Ctrl+I)" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></ToolButton>
        <ToolButton label="Underline (⌘/Ctrl+U)" active={state.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></ToolButton>
        <ToolButton label="Strikethrough" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></ToolButton>
        <label className="format-color" title="Text color"><span aria-hidden="true" style={{ borderColor: state.color }}>A</span><input type="color" aria-label="Text color" value={/^#[\da-f]{6}$/i.test(state.color) ? state.color : '#252a38'} onChange={(e) => editor.chain().focus().setColor(e.target.value).run()} /></label>
        <ToolButton label="Highlight" active={state.highlight} onClick={() => editor.chain().focus().toggleHighlight({ color: '#fef08a' }).run()}><span className="highlight-symbol">H</span></ToolButton>
      </div>
      <div className="format-group">
        <ToolButton label="Align left" active={state.left} onClick={() => editor.chain().focus().setTextAlign('left').run()}><ToolIcon name="left" /></ToolButton>
        <ToolButton label="Align center" active={state.center} onClick={() => editor.chain().focus().setTextAlign('center').run()}><ToolIcon name="center" /></ToolButton>
        <ToolButton label="Align right" active={state.right} onClick={() => editor.chain().focus().setTextAlign('right').run()}><ToolIcon name="right" /></ToolButton>
      </div>
      <div className="format-group">
        <ToolButton label="Bullet list" active={state.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()}><ToolIcon name="bullet" /></ToolButton>
        <ToolButton label="Numbered list" active={state.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ToolIcon name="number" /></ToolButton>
        <ToolButton label="Quote" active={state.quote} onClick={() => editor.chain().focus().toggleBlockquote().run()}><ToolIcon name="quote" /></ToolButton>
        <ToolButton label="Insert link" active={state.link} onClick={() => { setLinkValue(editor.getAttributes('link').href || ''); setLinkError(''); setLinkOpen(!linkOpen); }}><ToolIcon name="link" /></ToolButton>
        <ToolButton label="Clear formatting" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().unsetTextAlign().run()}><ToolIcon name="clear" /></ToolButton>
      </div>
    </div>
    {linkOpen && <div className="note-link-panel"><label htmlFor="note-link-url">Link address</label><input id="note-link-url" autoFocus placeholder="https://example.com" value={linkValue} onChange={(e) => setLinkValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } if (e.key === 'Escape') { e.preventDefault(); setLinkOpen(false); editor.commands.focus(); } }} /><button type="button" className="btn primary small" onClick={applyLink}>Apply link</button>{state.link && <button type="button" className="btn secondary small" onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); setLinkOpen(false); }}>Remove link</button>}<button type="button" className="btn secondary small" onClick={() => { setLinkOpen(false); editor.commands.focus(); }}>Cancel</button>{linkError && <p role="alert">{linkError}</p>}</div>}
  </div>;
}
export function RichTextEditor({ editor, invalid }: { editor: Editor | null; invalid?: boolean }) {
  useEffect(() => {
    if (!editor) { return; }
    editor.view.dom.setAttribute('aria-invalid', String(Boolean(invalid)));
    if (invalid) { editor.view.dom.setAttribute('aria-describedby', 'note-content-error'); }
    else { editor.view.dom.removeAttribute('aria-describedby'); }
  }, [editor, invalid]);
  return <div className={`note-editor-body${invalid ? ' has-error' : ''}`}><EditorContent editor={editor} /></div>;
}
