import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { ActionMenu } from '../../components/ActionMenu';
import { ConfirmDialog } from '../../components/DeleteButton';
import { api, errorMessage } from '../../services/api';
import { streamChat, emptySelection, type ChatSelection, type ChatCitation, type Conversation, type ChatOptions, type ChatStreamEvent } from '../../services/chat';
import { ScopeDialog } from './ScopeDialog';
import { ChatMessage, SourceDialog } from './ChatMessage';
import '../../styles/chat.css';

const phases: Record<string, string> = { planning: 'Thinking about your question…', searching: 'Searching your study materials…', reading: 'Reading relevant passages…', writing: 'Writing a reply…', checking: 'Checking the sources…' };
function selectionFromUrl(params: URLSearchParams): ChatSelection {
  const selection = emptySelection(); let found = false;
  for (const [key, group] of [['document','documents'],['note','notes'],['book','books'],['course','courses']] as const) {
    const id = params.get(key); if (id) { selection[group] = [id]; found = true; }
  }
  selection.library = !found; return selection;
}
function scopeLabel(selection: ChatSelection, options: ChatOptions | null) {
  if (selection.library) return 'My library';
  const titles = (['courses','books','notes','documents'] as const).flatMap(group => selection[group].map(id => options?.[group].find(item => item._id === id)?.title || `Selected ${group === 'documents' ? 'PDF' : group.slice(0,-1)}`));
  return titles.length ? `${titles[0]}${titles.length > 1 ? ` +${titles.length-1}` : ''}` : 'Choose study materials';
}

export default function ChatPage() {
  const { id } = useParams(); const [params] = useSearchParams(); const navigate = useNavigate();
  const scopeQuery = params.toString();
  const [conversations, setConversations] = useState<Conversation[]>([]), [conversation, setConversation] = useState<Conversation | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null), [more, setMore] = useState(false);
  const [options, setOptions] = useState<ChatOptions | null>(null), [config, setConfig] = useState<{ enabled: boolean; model: string } | null>(null);
  const [selection, setSelection] = useState(() => selectionFromUrl(params)), [topic, setTopic] = useState(params.get('topic') || ''), [general, setGeneral] = useState(false);
  const [input, setInput] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(false), [sending, setSending] = useState(false), [phase, setPhase] = useState('');
  const [scopeOpen, setScopeOpen] = useState(false), [sidebarOpen, setSidebarOpen] = useState(false), [deleting, setDeleting] = useState(false), [renaming, setRenaming] = useState(false), [name, setName] = useState('');
  const [source, setSource] = useState<{ messageId: string; citation: ChatCitation } | null>(null);
  const session = useRef<{ controller: AbortController; id: string; runId?: string } | null>(null);
  const viewId = useRef<string | undefined>(id);
  const historyDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (sidebarOpen) historyDialog.current?.showModal(); }, [sidebarOpen]);
  const alive = useRef(true), thread = useRef<HTMLDivElement>(null), stick = useRef(true), composer = useRef<HTMLTextAreaElement>(null);
  const refreshList = useCallback(async () => {
    try { const result = await api<{ conversations: Conversation[]; nextCursor?: string }>('/chat'); if (alive.current) { setConversations(result.conversations); setNextCursor(result.nextCursor || null); } }
    catch (reason) { if (alive.current) setError(errorMessage(reason)); }
  }, []);
  useEffect(() => {
    alive.current = true; void refreshList();
    void api<ChatOptions>('/chat/options').then(value => { if (alive.current) setOptions(value); }).catch(reason => { if (alive.current) setError(errorMessage(reason)); });
    void api<{ enabled: boolean; model: string }>('/chat/config').then(value => { if (alive.current) setConfig(value); }).catch(() => { if (alive.current) setConfig({ enabled: false, model: '' }); });
    return () => { alive.current = false; session.current?.controller.abort(); };
  }, [refreshList]);
  useEffect(() => {
    viewId.current = id;
    if (session.current && session.current.id === id) return;
    session.current?.controller.abort(); session.current = null; setSending(false); setError(''); setSource(null);
    let active = true;
    if (!id) { setConversation(null); setSelection(selectionFromUrl(new URLSearchParams(scopeQuery))); setTopic(new URLSearchParams(scopeQuery).get('topic') || ''); setGeneral(false); setLoading(false); return; }
    setLoading(true);
    api<{ conversation: Conversation }>(`/chat/${id}`).then(({ conversation: value }) => {
      if (active) { setConversation(value); setSelection(value.selection); setTopic(value.topic); setGeneral(value.allowGeneral); stick.current = true; }
    }).catch(reason => { if (active) setError(errorMessage(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, scopeQuery]);
  useEffect(() => { if (stick.current && thread.current) thread.current.scrollTop = thread.current.scrollHeight; }, [conversation?.messages, phase]);
  useEffect(() => {
    if (!conversation?.busy || sending) return;
    const timer = setInterval(() => { void api<{ conversation: Conversation }>(`/chat/${conversation._id}`).then(result => { if (alive.current && !session.current) setConversation(result.conversation); }).catch(() => {}); }, 3000);
    return () => clearInterval(timer);
  }, [conversation?.busy, conversation?._id, sending]);

  async function loadMore() {
    if (!nextCursor || more) return;
    setMore(true);
    try {
      const page = await api<{ conversations: Conversation[]; nextCursor: string | null }>(`/chat?cursor=${encodeURIComponent(nextCursor)}`);
      if (alive.current) { setConversations(previous => [...new Map([...previous,...page.conversations].map(item => [item._id,item])).values()]); setNextCursor(page.nextCursor); }
    } catch (reason) { if (alive.current) setError(errorMessage(reason)); }
    finally { if (alive.current) setMore(false); }
  }
  async function stop() {
    const current = session.current, runId = current?.runId || conversation?.activeRunId;
    const conversationId = current?.id || conversation?._id;
    current?.controller.abort();
    if (conversationId && runId) {
      try { const result = await api<{ conversation: Conversation }>(`/chat/${conversationId}/cancel`, { method: 'POST', body: { runId } }); if (alive.current) setConversation(result.conversation); }
      catch (reason) { if (alive.current) setError(errorMessage(reason)); }
    }
  }
  async function move(path: string) { await stop(); setSidebarOpen(false); setInput(''); navigate(path); }
  async function saveScope(next: ChatSelection, focus: string, allow: boolean) {
    if (conversation) {
      const result = await api<{ conversation: Conversation }>(`/chat/${conversation._id}`, { method:'PATCH', body:{selection:next,topic:focus,allowGeneral:allow} });
      setConversation(result.conversation); void refreshList();
    }
    setSelection(next); setTopic(focus); setGeneral(allow);
  }
  function event(event: ChatStreamEvent, requestId: string) {
    if (!alive.current) return;
    if (event.type === 'start') {
      if (session.current) session.current.runId = event.runId;
      if (event.question && event.answer) setConversation(previous => previous && ({ ...previous, busy: true, activeRunId: event.runId,
        messages: [...previous.messages.filter(item => item.requestId !== requestId), event.question!, event.answer!], messageCount: previous.messageCount + 2 }));
    } else if (event.type === 'delta' && typeof event.text === 'string') {
      setConversation(previous => previous && ({ ...previous, messages: previous.messages.map(item => item.requestId === requestId && item.role === 'assistant' ? { ...item, content: item.content+event.text } : item) }));
    } else if (event.type === 'mode' && event.mode) {
      setConversation(previous => previous && ({ ...previous, messages: previous.messages.map(item => item.requestId === requestId && item.role === 'assistant' ? { ...item, mode:event.mode! } : item) }));
    } else if (event.type === 'status') setPhase(phases[event.phase || ''] || 'Preparing a reply…');
    else if (event.type === 'done' && typeof event.message === 'object') {
      const reply = event.message;
      setConversation(previous => previous && ({ ...previous, busy:false,activeRunId:null,title:event.title || previous.title,
        messages:previous.messages.map(item => item.requestId === requestId && item.role === 'assistant' ? reply : item) })); setPhase('Reply complete.');
    } else if (event.type === 'error') setError(typeof event.message === 'string' ? event.message : 'The response was interrupted. Your message is saved.');
  }
  async function send(eventObject?: FormEvent, retry?: string) {
    eventObject?.preventDefault(); const content = (retry || input).trim();
    if (!content || sending || loading || !config?.enabled || conversation?.busy || conversation?.limitReached) return;
    setError(''); setSending(true); setPhase('Preparing your conversation…'); stick.current = true;
    let activeId = conversation?._id;
    const controller = new AbortController(), requestId = crypto.randomUUID();
    session.current = { controller, id: activeId || '' };
    try {
      if (!activeId) {
        const result = await api<{ conversation: Conversation }>('/chat', {method:'POST',body:{selection,topic,allowGeneral:general},signal:controller.signal});
        activeId = result.conversation._id; setConversation(result.conversation);
      }
      if (!alive.current || controller.signal.aborted) return;
      viewId.current = activeId; session.current = { controller, id:activeId }; navigate(`/chat/${activeId}`, {replace:true}); setInput('');
      await streamChat(activeId, content, requestId, value => { if (session.current?.controller === controller) event(value, requestId); }, controller.signal);
    } catch (reason) { if (!controller.signal.aborted && alive.current) setError(errorMessage(reason)); }
    finally {
      if (session.current?.controller === controller) session.current = null;
      if (alive.current) {
        if (viewId.current === activeId) { setSending(false); setPhase(''); }
        if (activeId) {
          try { const result = await api<{conversation:Conversation}>(`/chat/${activeId}`); if (alive.current && !session.current && viewId.current === activeId) setConversation(result.conversation); } catch { /* A deleted conversation stays removed. */ }
        }
        void refreshList(); composer.current?.focus({preventScroll:true});
      }
    }
  }
  async function rename(eventObject: FormEvent) {
    eventObject.preventDefault(); if (!conversation) return;
    try { const result = await api<{conversation:Conversation}>(`/chat/${conversation._id}`, {method:'PATCH',body:{title:name.trim() || 'New conversation'}}); setConversation(result.conversation); setRenaming(false); void refreshList(); }
    catch (reason) { setError(errorMessage(reason)); }
  }
  const messages = conversation?.messages || [], busy = sending || !!conversation?.busy;
  const lastUser = [...messages].reverse().find(item => item.role === 'user')?.content;
  const history = <><div className="chat-history-heading"><span className="eyebrow">Your conversations</span><button className="icon-button chat-history-close" aria-label="Close conversations" onClick={() => setSidebarOpen(false)}><Icon name="close" /></button></div>
    <button type="button" className="btn primary chat-new" onClick={() => void move('/chat')}><Icon name="plus" size={18} />New conversation</button>
    <nav className="chat-conversations" aria-label="Saved conversations">{conversations.map(item => <button type="button" key={item._id} className={item._id === id ? 'is-active' : ''} onClick={() => void move(`/chat/${item._id}`)}><Icon name="chat" size={17} /><span><strong>{item.title}</strong><small>{item.topic || (item.selection.library ? 'My library' : 'Selected materials')}</small></span></button>)}</nav>{nextCursor && <button type="button" className="text-link" disabled={more} onClick={()=>void loadMore()}>{more ? 'Loading…' : 'Older conversations'}</button>}
    {!conversations.length && <p className="chat-muted">A thought worth following starts here. Your conversations will be saved automatically.</p>}<p className="chat-history-note"><Icon name="check" size={14} />Saved until you delete them.</p></>;
  return <div className="study-chat-page"><aside className="chat-history">{history}</aside>{sidebarOpen && <dialog ref={historyDialog} className="chat-history-overlay" aria-label="Conversations" onCancel={() => setSidebarOpen(false)} onClick={event => { if (event.target === event.currentTarget) setSidebarOpen(false); }}><aside>{history}</aside></dialog>}
    <section className="chat-study-space" aria-label="Study chat"><header className="chat-space-header"><div><span className="eyebrow">Think it through together</span><h1>{conversation?.title || 'Study chat'}</h1></div><div className="chat-header-actions"><button type="button" className="icon-button chat-mobile-history" aria-label="Conversations" onClick={() => setSidebarOpen(true)}><Icon name="menu" /></button>{conversation && <ActionMenu label="Conversation actions" items={[{label:'Rename conversation',icon:'edit',onSelect:()=>{setName(conversation.title);setRenaming(true);}},{label:'Delete conversation',icon:'trash',danger:true,onSelect:()=>setDeleting(true)}]} />}</div></header>
    {renaming && <form className="chat-rename" onSubmit={rename}><label>Conversation title<input maxLength={100} value={name} onChange={e=>setName(e.target.value)} autoFocus /></label><button className="btn primary small">Save title</button><button type="button" className="btn secondary small" onClick={()=>setRenaming(false)}>Cancel</button></form>}
    <div className="chat-scope-bar"><button type="button" className="chat-scope-pill" disabled={busy} onClick={()=>setScopeOpen(true)}><Icon name="book" size={16}/><span>{scopeLabel(selection,options)}</span><Icon name="chevron" size={13}/></button>{topic && <span className="chat-topic-pill">{topic}</span>}<span className="chat-grounding-note">{general ? 'General explanations allowed' : 'Grounded in your materials'}</span></div>
    {error && <div className="chat-error" role="alert">{error}<button className="icon-button" aria-label="Dismiss chat error" onClick={()=>setError('')}><Icon name="close" size={16}/></button></div>}
    {config && !config.enabled && <p className="chat-unavailable" role="status">The assistant is temporarily unavailable. Your saved conversations are still here.</p>}
    <div className="chat-thread" ref={thread} onScroll={()=>{if(thread.current) stick.current=thread.current.scrollHeight-thread.current.scrollTop-thread.current.clientHeight<100;}}>
      {loading ? <p role="status" className="chat-loading">Opening your conversation…</p> : !messages.length ? <div className="chat-welcome"><div className="chat-welcome-object" aria-hidden="true"><i/><i/><span><Icon name="spark" size={39}/></span></div><span className="eyebrow">Make a little room for understanding</span><h2>Stay with an idea.<br/><em>See where it takes you.</em></h2><p>Ask a question, follow a connection, or work through a difficult passage. Your materials stay at the heart of the conversation.</p><div className="chat-starters">{['Walk me through the main idea.','Explain a concept with an example.','Help me connect these materials.'].map(text=><button type="button" key={text} onClick={()=>{setInput(text);composer.current?.focus();}}><Icon name="spark" size={16}/>{text}<span aria-hidden="true">↗</span></button>)}</div><button className="text-link" onClick={()=>setScopeOpen(true)}>Choose materials or a topic</button></div> : messages.map((item,index)=><ChatMessage key={item.id} message={item} onSource={citation=>setSource({messageId:item.id,citation})} onRetry={!busy && index===messages.length-1 && lastUser ? ()=>void send(undefined,lastUser) : undefined}/>)}
    </div>
    <div className="chat-composer-wrap"><div className="chat-stream-status" role="status" aria-live="polite">{phase || (conversation?.limitReached ? 'Start a new conversation to keep studying.' : busy ? 'A response is still being prepared. You can stop it below.' : '')}</div><form className="chat-composer" onSubmit={send}><label className="sr-only" htmlFor="chat-message">Message Classmate</label><textarea id="chat-message" ref={composer} maxLength={4000} value={input} rows={2} placeholder="Ask, compare, or work through an idea…" aria-describedby="chat-composer-hint" onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing&&!busy){e.preventDefault();void send();}}}/><div className="chat-composer-bottom"><button type="button" className="text-link chat-change-scope" disabled={busy} onClick={()=>setScopeOpen(true)}><Icon name="connections" size={15}/>Study scope</button><small>{input.length ? `${input.length}/4000` : 'Follow your curiosity'}</small>{busy ? <button type="button" className="btn secondary chat-send" onClick={()=>void stop()}><span className="chat-stop-square"/>Stop</button> : <button className="btn primary chat-send" disabled={!input.trim()||!config?.enabled||conversation?.limitReached||loading}><span>Send</span><Icon name="send" size={17}/></button>}</div></form><p id="chat-composer-hint" className="chat-composer-hint">Enter to send · Shift+Enter for a new line. Answers can be mistaken; check the sources.</p></div>
    </section>
    {scopeOpen && <ScopeDialog selection={selection} topic={topic} allowGeneral={general} options={options} onSave={saveScope} onClose={()=>setScopeOpen(false)}/>}
    {deleting && conversation && <ConfirmDialog title={conversation.title} path={`/chat/${conversation._id}`} description="This permanently removes this conversation and its messages. Your study materials stay in your library." onClose={()=>setDeleting(false)} onDeleted={()=>{setDeleting(false);setConversation(null);void refreshList();navigate('/chat');}}/>}
    {source && conversation && <SourceDialog conversationId={conversation._id} messageId={source.messageId} citation={source.citation} onClose={()=>setSource(null)}/>}
  </div>;
}
