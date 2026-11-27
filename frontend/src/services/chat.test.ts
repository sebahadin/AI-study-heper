import { beforeEach, describe, expect, it, vi } from 'vitest';
import { streamChat } from './chat';
const encoder=new TextEncoder();
function response(text:string,split=1) {
 const bytes=encoder.encode(text);let offset=0;
 return new Response(new ReadableStream({pull(controller){if(offset>=bytes.length){controller.close();return;}controller.enqueue(bytes.slice(offset,offset+split));offset+=split;}}),{headers:{'Content-Type':'text/event-stream'}});
}
beforeEach(()=>vi.restoreAllMocks());
describe('Study-chat streaming transport',()=>{
 it('preserves split UTF-8 characters and CRLF frames, ignores heartbeat comments, and sends only the requested message',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>response(': heartbeat\r\n\r\ndata: {"type":"delta","text":"Café 🧠"}\r\n\r\ndata: {"type":"done","message":{}}\r\n\r\n')));
  const seen:unknown[]=[];
  await streamChat('thread','Question?','request',event=>seen.push(event),new AbortController().signal);
  expect(seen).toEqual([{type:'delta',text:'Café 🧠'},{type:'done',message:{}}]);
  const init=vi.mocked(fetch).mock.calls[0][1];expect(init?.credentials).toBe('same-origin');
  expect(JSON.parse(String(init?.body))).toEqual({content:'Question?',requestId:'request'});
 });
 it('reports interrupted streams instead of treating a partial answer as saved',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>response('data: {"type":"delta","text":"Unfinished"}\n\n')));
  await expect(streamChat('thread','Question?','request',()=>{},new AbortController().signal)).rejects.toThrow('interrupted');
 });
 it('clears an expired Passport session and surfaces safe server errors',async()=>{
  const expired=vi.fn();window.addEventListener('classmate:unauthenticated',expired);
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'Please log in.'},{status:401})));
  await expect(streamChat('thread','Question?','request',()=>{},new AbortController().signal)).rejects.toThrow('Please log in.');
  expect(expired).toHaveBeenCalledOnce();window.removeEventListener('classmate:unauthenticated',expired);
 });
 it('cancels the reader and rejects an oversized streaming frame',async()=>{
  const cancelled=vi.fn();vi.stubGlobal('fetch',vi.fn(async()=>new Response(new ReadableStream({start(controller){controller.enqueue(encoder.encode('x'.repeat(65537)));},cancel:cancelled}),{headers:{'Content-Type':'text/event-stream'}})));
  await expect(streamChat('thread','Question?','request',()=>{},new AbortController().signal)).rejects.toThrow('too large');expect(cancelled).toHaveBeenCalledOnce();
 });
});
