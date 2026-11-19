import { noteHtml } from './noteContent';

export function NoteDocument({ content, contentHtml }: { content: string; contentHtml?: string | null }) {
  return <div className="rich-document note-reading-content" dangerouslySetInnerHTML={{ __html: noteHtml({ content, contentHtml }) }} />;
}
