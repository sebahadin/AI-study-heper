import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Icon } from '../../components/Icon';
import { api, errorMessage } from '../../services/api';
import type { ChatCitation, ChatMessage as Message } from '../../services/chat';

const labels = { draft: 'Draft ready for review', pending: 'Preparing a reply', grounded: 'From your materials', general: 'General explanation', mixed: 'Materials + general explanation', clarification: 'A quick clarification', insufficient_evidence: 'More context needed' };
export function SourceDialog({ conversationId, messageId, citation, onClose }: { conversationId: string; messageId: string; citation: ChatCitation; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [result, setResult] = useState<{ passage: { text: string }; href: string; title: string } | null>(null), [error, setError] = useState('');
  useEffect(() => { dialog.current?.showModal(); let active = true;
    api<{ passage: { text: string }; href: string; title: string }>(`/chat/${conversationId}/sources/${messageId}/${citation.number}`)
      .then(value => { if (active) setResult(value); }).catch(reason => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; };
  }, [conversationId, messageId, citation.number]);
  const href = citation.source.source_type === 'document' ? `/api/documents/${citation.source.source_id}/file#page=${citation.page_start || 1}` : result?.href;
  return <dialog ref={dialog} className="chat-dialog chat-source-dialog" onCancel={onClose} onClose={onClose} aria-labelledby="chat-source-title"><header><div><span className="eyebrow">Source {citation.number} · {citation.locator}</span><h2 id="chat-source-title">{citation.title}</h2></div><button className="icon-button" aria-label="Close source" onClick={onClose}><Icon name="close" /></button></header>
    {error ? <p role="alert">{error}</p> : result ? <blockquote>{result.passage.text}</blockquote> : <p role="status">Checking the current source…</p>}
    <footer>{result && href && <a className="btn primary" href={href} target="_blank" rel="noopener noreferrer">Open original <Icon name="chevron" size={15} /></a>}<button className="btn secondary" onClick={onClose}>Close</button></footer></dialog>;
}

export function ChatMessage({ message, onSource, onRetry }: { message: Message; onSource: (citation: ChatCitation) => void; onRetry?: () => void }) {
  const assistant = message.role === 'assistant';
  return <article className={`chat-message chat-message--${message.role}`} aria-label={assistant ? 'Classmate reply' : 'Your message'}>
    <span className="chat-message-avatar" aria-hidden="true"><Icon name={assistant ? 'spark' : 'note'} size={17} /></span>
    <div className="chat-message-content"><div className="chat-message-heading"><strong>{assistant ? 'Classmate' : 'You'}</strong>{assistant && <span className={`chat-mode chat-mode--${message.mode}`}>{message.status === 'generating' ? 'Draft · verifying sources' : message.status === 'cancelled' ? 'Stopped' : message.status !== 'completed' ? 'Not completed' : labels[message.mode]}</span>}</div>
      {message.content ? <div className="chat-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: () => null, a: ({ children }) => <span>{children}</span> }}>{message.content}</Markdown></div> : message.status === 'generating' ? <div className="chat-thinking" aria-label="Preparing response"><span /><span /><span /></div> : null}
      {message.proposalId && <Link className="btn secondary study-draft-chat-link" to={`/study-tools/${message.proposalId}`}><Icon name="spark" size={17}/>Review {message.proposalKind === 'flashcards' ? 'flashcard deck' : message.proposalKind || 'study'} draft<Icon name="chevron" size={15}/></Link>}
      {message.citations.length > 0 && <div className="chat-citations" aria-label="Answer sources">{message.citations.map(citation => <button key={citation.number} type="button" onClick={() => onSource(citation)}><b>{citation.number}</b><Icon name={citation.source.source_type === 'note' ? 'note' : 'file'} size={15} /><span>{citation.title}<small>{citation.locator}</small></span></button>)}</div>}
      {message.status !== 'completed' && message.status !== 'generating' && <div className="chat-message-notice"><p>{message.error || (message.status === 'cancelled' ? 'Response stopped before completion.' : 'This response was interrupted.')}</p>{onRetry && <button className="text-link" type="button" onClick={onRetry}>Try again</button>}</div>}
    </div>
  </article>;
}
