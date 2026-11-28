import {act,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {useStudyDraft} from './useStudyDraft';
import {rememberDraft,readDraftBackup,clearStudyDraftBackups} from '../services/studyDraftBackup';
import type {StudyArtifact,StudyDraft} from '../services/studyTools';
const content:StudyDraft={kind:'summary',title:'Original',body:'A supported claim [1].',cards:[],questions:[],citations:[],coverage:{passages:1,coveredSources:1,totalSources:1,excerpted:true}};
const initial:StudyArtifact={_id:'draft-1',kind:'summary',title:'Original',status:'draft',revision:1,savedRevision:0,updatedAt:'2026-11-27T12:00:00Z',hasDraft:true,count:0,request:{kind:'summary',selection:{library:true,notes:[],books:[],courses:[],documents:[]},topic:'',instruction:'',count:5,format:'auto'},draft:content,content:null,busy:false,error:null};
let saved=structuredClone(initial),patches:{revision:number;draft:StudyDraft}[]=[],release:(()=>void)|null=null,delay=false,fail=false;
beforeEach(()=>{saved=structuredClone(initial);patches=[];release=null;delay=false;fail=false;sessionStorage.clear();vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{
 if(init?.method==='PATCH'){
  const body=JSON.parse(String(init.body));patches.push(body);if(delay&&patches.length===1)await new Promise<void>(resolve=>{release=resolve;});
  if(fail)return Response.json({error:'Connection interrupted.'},{status:503});
  if(body.revision!==saved.revision)return Response.json({error:'Draft changed.'},{status:409});
  saved={...saved,revision:saved.revision+1,draft:body.draft};return Response.json({artifact:saved});
 }return Response.json({artifact:saved});
}));});
afterEach(()=>{clearStudyDraftBackups();vi.useRealTimers();});
describe('Private study draft persistence',()=>{
 it('autosaves private edits without calling a library confirmation/action endpoint',async()=>{
  const {result}=renderHook(()=>useStudyDraft('draft-1'));await act(async()=>{await result.current.load();});act(()=>result.current.change({...content,title:'Autosaved edit'}));
  await waitFor(()=>expect(patches).toHaveLength(1),{timeout:1600});expect(saved.draft?.title).toBe('Autosaved edit');expect(saved.content).toBeNull();expect(vi.mocked(fetch).mock.calls.some(([path])=>String(path).includes('/actions'))).toBe(false);
 });
 it('serializes a newer edit behind an in-flight save and uses its acknowledged revision',async()=>{
  delay=true;const {result}=renderHook(()=>useStudyDraft('draft-1'));await act(async()=>{await result.current.load();});act(()=>result.current.change({...content,title:'First edit'}));let flushing:Promise<StudyArtifact|null>;
  act(()=>{flushing=result.current.flush();});await waitFor(()=>expect(patches).toHaveLength(1));act(()=>result.current.change({...content,title:'Second edit'}));await act(async()=>{release?.();await flushing!;});
  expect(patches.map(p=>p.revision)).toEqual([1,2]);expect(saved.draft?.title).toBe('Second edit');expect(result.current.dirty).toBe(false);expect(readDraftBackup('draft-1')).toBeNull();
 });
 it('restores an interrupted local edit only after the owned draft loads',async()=>{
  rememberDraft('draft-1',1,{...content,title:'Recovered edit'});const {result}=renderHook(()=>useStudyDraft('draft-1',true));expect(result.current.draft).toBeNull();await act(async()=>{await result.current.load();});expect(result.current.draft?.title).toBe('Recovered edit');expect(result.current.restored).toBe(true);
 });
 it('asks before applying a local recovery copy over a newer server revision',async()=>{
  rememberDraft('draft-1',1,{...content,title:'Local edit'});saved={...saved,revision:3,draft:{...content,title:'Another tab'}};const {result}=renderHook(()=>useStudyDraft('draft-1',true));await act(async()=>{await result.current.load();});expect(result.current.draft?.title).toBe('Another tab');expect(result.current.recovered?.draft.title).toBe('Local edit');expect(patches).toHaveLength(0);
  act(()=>result.current.restore());await act(async()=>{await result.current.flush();});expect(saved.draft?.title).toBe('Local edit');expect(patches[0].revision).toBe(3);
 });
 it('retains recoverable edits after a network failure and retries without losing text',async()=>{
  fail=true;const {result}=renderHook(()=>useStudyDraft('draft-1',true));await act(async()=>{await result.current.load();});act(()=>result.current.change({...content,title:'Keep this edit'}));await act(async()=>{await result.current.flush().catch(()=>{});});expect(result.current.saveError).toContain('Connection interrupted');expect(readDraftBackup('draft-1')?.draft.title).toBe('Keep this edit');
  fail=false;await act(async()=>{await result.current.flush();});expect(saved.draft?.title).toBe('Keep this edit');expect(result.current.dirty).toBe(false);
 });
 it('finishes a private save when navigating away and clears recovery data on logout',async()=>{
  const {result,unmount}=renderHook(()=>useStudyDraft('draft-1'));await act(async()=>{await result.current.load();});act(()=>result.current.change({...content,title:'Before leaving'}));unmount();await waitFor(()=>expect(saved.draft?.title).toBe('Before leaving'));expect(readDraftBackup('draft-1')).toBeNull();
  rememberDraft('draft-1',saved.revision,{...content,title:'Private backup'});clearStudyDraftBackups();expect(readDraftBackup('draft-1')).toBeNull();
 });
});
