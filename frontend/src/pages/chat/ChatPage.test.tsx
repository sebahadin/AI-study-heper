import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ChatPage from './ChatPage';
import { Layout } from '../../components/Layout';
vi.mock('../../auth/AuthProvider',()=>({useAuth:()=>({user:{username:'test'},logout:vi.fn()})}));
vi.mock('../../components/OrbitScene',()=>({AmbientBackground:()=>null}));
import { streamChat, type Conversation } from '../../services/chat';
import { ChatMessage } from './ChatMessage';
Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {configurable:true,value:function(){this.setAttribute('open','');}});
Object.defineProperty(HTMLDialogElement.prototype, 'close', {configurable:true,value:function(){this.removeAttribute('open');}});
vi.mock('../../services/chat', async importOriginal => ({ ...await importOriginal<typeof import('../../services/chat')>(), streamChat: vi.fn() }));
const selection = {library:false,documents:[],notes:['note-1'],books:[],courses:[]};
const citation = {number:1,chunk_id:'note-'+'a'.repeat(64),source:{source_id:'note-1',source_type:'note' as const,source_version:'v1',index_generation:'g1'},locator:'paragraph 2',title:'Cell energy',href:'/notes/note-1'};
const question = {id:'q1',requestId:'request',sequence:1,role:'user' as const,content:'What supplies ATP?',status:'completed' as const,mode:'pending' as const,citations:[],createdAt:'2026-11-27T12:00:00Z'};
const answer = {...question,id:'a1',sequence:2,role:'assistant' as const,content:'Mitochondria supply ATP [1].',mode:'grounded' as const,citations:[citation]};
const conversation: Conversation = {_id:'chat-1',title:'Cell energy',selection,topic:'Biology',allowGeneral:false,updatedAt:'2026-11-27T12:00:00Z',messageCount:2,messages:[question,answer],busy:false,limitReached:false};
let saved=structuredClone(conversation);
beforeEach(()=>{
 saved=structuredClone(conversation);vi.mocked(streamChat).mockReset();
 vi.stubGlobal('fetch',vi.fn(async(input,init)=>{
  const path=String(input);
  if(path==='/api/chat/config')return Response.json({enabled:true,model:'test-model'});
  if(path==='/api/chat/options')return Response.json({notes:[{_id:'note-1',title:'Cell energy'}],books:[],courses:[{_id:'course-1',title:'Biology'}],documents:[]});
  if(path==='/api/chat'&&init?.method==='POST')return Response.json({conversation:{...saved,messages:[],messageCount:0}});
  if(path==='/api/chat')return Response.json({conversations:[{...saved,messages:[]}],nextCursor:null});
  if(path.includes('/sources/'))return Response.json({passage:{text:'Mitochondria supply ATP.'},title:'Cell energy',href:'/notes/note-1'});
  if(path==='/api/chat/chat-1'&&init?.method==='PATCH'){saved={...saved,...JSON.parse(String(init.body))};return Response.json({conversation:saved});}
  return Response.json({conversation:saved});
 }));
});
function mount(path='/chat/chat-1'){return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/chat" element={<ChatPage/>}/><Route path="/chat/:id" element={<ChatPage/>}/></Routes></MemoryRouter>);}
describe('Complete study-chat interface',()=>{
 it('loads saved history and opens a verified source preview',async()=>{
  const user=userEvent.setup();mount();
  expect(await screen.findByText('Mitochondria supply ATP [1].')).toBeVisible();
  await user.click(screen.getByRole('button',{name:/1 Cell energy paragraph 2/}));
  expect(await screen.findByText('Mitochondria supply ATP.')).toBeVisible();
  expect(screen.getByRole('link',{name:/Open original/})).toHaveAttribute('href','/notes/note-1');
 });
 it('creates a scoped conversation and displays streamed and finalized replies',async()=>{
  const user=userEvent.setup();saved={...saved,messages:[],messageCount:0};
  vi.mocked(streamChat).mockImplementation(async(_id,content,requestId,onEvent)=>{
   const q={...question,requestId,content},a={...answer,requestId};
   onEvent({type:'start',runId:'run',question:q,answer:{...a,content:'',status:'generating'}});
   onEvent({type:'mode',mode:'grounded'});onEvent({type:'delta',text:a.content});
   saved={...saved,messages:[q,a],messageCount:2};onEvent({type:'done',message:a});
  });
  mount('/chat?note=note-1');
  await waitFor(()=>expect(fetch).toHaveBeenCalledWith('/api/chat/config',expect.anything()));
  await user.type(screen.getByRole('textbox',{name:'Message Classmate'}),'What supplies ATP?');
  await user.click(screen.getByRole('button',{name:'Send'}));
  expect(await screen.findByText('Mitochondria supply ATP [1].')).toBeVisible();expect(streamChat).toHaveBeenCalledTimes(1);
  const created=vi.mocked(fetch).mock.calls.find(([path,init])=>path==='/api/chat'&&init?.method==='POST');
  expect(JSON.parse(String(created?.[1]?.body)).selection.notes).toEqual(['note-1']);
 });
 it('keeps the live request mounted when the full app navigates from a new chat to its saved URL',async()=>{
  const user=userEvent.setup();saved={...saved,messages:[],messageCount:0};
  let finish:()=>void=()=>{},signal:AbortSignal|undefined;
  vi.mocked(streamChat).mockImplementation(async(_id,content,requestId,onEvent,abort)=>{
   signal=abort;const q={...question,content,requestId},a={...answer,requestId};
   onEvent({type:'start',runId:'run',question:q,answer:{...a,content:'',status:'generating'}});
   await new Promise<void>(resolve=>{finish=()=>{saved={...saved,messages:[q,a],messageCount:2};onEvent({type:'done',message:a});resolve();};});
  });
  render(<MemoryRouter initialEntries={['/chat?note=note-1']}><Routes><Route element={<Layout/>}><Route path="/chat" element={<ChatPage/>}/><Route path="/chat/:id" element={<ChatPage/>}/></Route></Routes></MemoryRouter>);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Send'})).toBeDisabled());
  await user.type(screen.getByRole('textbox',{name:'Message Classmate'}),'What supplies ATP?');
  await user.click(screen.getByRole('button',{name:'Send'}));
  await screen.findByRole('button',{name:'Stop'});
  expect(signal?.aborted).toBe(false);finish();
  expect(await screen.findByText('Mitochondria supply ATP [1].')).toBeVisible();
 });
 it('lets the user change materials, topic focus, and general-explanation policy',async()=>{
  const user=userEvent.setup();mount();await screen.findByText('Mitochondria supply ATP [1].');
  await user.click(screen.getByRole('button',{name:'Cell energy'}));
  await user.clear(screen.getByLabelText(/Topic focus/));
  await user.type(screen.getByLabelText(/Topic focus/),'Respiration');
  await user.click(screen.getByLabelText(/Allow general explanations/));
  await user.click(screen.getByRole('button',{name:'Use this study scope'}));
  await waitFor(()=>expect(saved.topic).toBe('Respiration'));expect(saved.allowGeneral).toBe(true);
 });
 it('requires confirmation before removing a saved conversation',async()=>{
  const user=userEvent.setup();mount();await screen.findByText('Mitochondria supply ATP [1].');
  await user.click(screen.getByRole('button',{name:'Conversation actions'}));await user.click(screen.getByRole('menuitem',{name:'Delete conversation'}));
  expect(screen.getByRole('button',{name:'Yes, remove'})).toBeVisible();
  expect(vi.mocked(fetch).mock.calls.some(([,init])=>init?.method==='DELETE')).toBe(false);
 });
 it('renders Markdown safely without loading model-generated tracking images or HTML',()=>{
  const {container}=render(<ChatMessage message={{...answer,content:'<script>alert(1)</script>\n![tracking](https://example.com/pixel)\n[unsafe](javascript:alert(1))'}} onSource={()=>{}}/>);
  expect(container.querySelector('script')).toBeNull();expect(container.querySelector('img')).toBeNull();expect(container.querySelector('a[href^="javascript"]')).toBeNull();
 });
});
