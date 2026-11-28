import {act,renderHook,waitFor} from '@testing-library/react';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {useQuizAttempt} from './useQuizAttempt';
import {attemptFixture} from '../pages/learning/fixtures.test-data';
import {attemptEdits,rememberAttempt,readAttempt} from '../services/learning';
import {clearStudyDraftBackups} from '../services/studyDraftBackup';
let saved=structuredClone(attemptFixture),fail=false;
beforeEach(()=>{saved=structuredClone(attemptFixture);fail=false;sessionStorage.clear();vi.stubGlobal('fetch',vi.fn(async(_path,init)=>{if(init?.method==='PATCH'){if(fail)return Response.json({error:'Connection interrupted.'},{status:503});const body=JSON.parse(String(init.body));saved={...saved,revision:saved.revision+1,position:body.position,marked:body.marked,answers:Object.fromEntries(Object.entries(body.answers as Record<string,string|number|null>).map(([id,value])=>[id,{value,submitted:false}]))};}return Response.json({attempt:saved});}));});
afterEach(()=>clearStudyDraftBackups());
describe('Recorded practice persistence',()=>{
 it('autosaves unfinished answers and position without submitting or grading them',async()=>{
  const {result}=renderHook(()=>useQuizAttempt('attempt-1'));await act(async()=>{await result.current.load();});act(()=>result.current.change({answers:{q2:'An unfinished answer'},position:1,marked:['q2']}));await waitFor(()=>expect(saved.answers.q2?.value).toBe('An unfinished answer'),{timeout:1500});expect(saved.answers.q2.submitted).toBe(false);expect(vi.mocked(fetch).mock.calls.some(([p])=>String(p).includes('/assessments/'))).toBe(false);
 });
 it('retains interrupted answers locally and restores them after the owner loads the attempt',async()=>{
  fail=true;const first=renderHook(()=>useQuizAttempt('attempt-1'));await act(async()=>{await first.result.current.load();});act(()=>first.result.current.change({answers:{q2:'Do not lose this'},position:1,marked:[]}));await act(async()=>{await first.result.current.flush().catch(()=>{});});expect(readAttempt('attempt-1')?.edits.answers.q2).toBe('Do not lose this');first.unmount();
  const next=renderHook(()=>useQuizAttempt('attempt-1'));expect(next.result.current.attempt).toBeNull();await act(async()=>{await next.result.current.load();});expect(next.result.current.recovered).toBe(true);expect(next.result.current.edits?.answers.q2).toBe('Do not lose this');
 });
 it('requires an explicit choice before restoring edits over a newer server revision and clears backups on logout',async()=>{
  rememberAttempt('attempt-1',0,{answers:{q2:'Old local copy'},position:1,marked:[]});saved.revision=2;const {result}=renderHook(()=>useQuizAttempt('attempt-1'));await act(async()=>{await result.current.load();});expect(result.current.recovery?.answers.q2).toBe('Old local copy');expect(result.current.edits).toEqual(attemptEdits(saved));act(()=>clearStudyDraftBackups());expect(readAttempt('attempt-1')).toBeNull();
 });
});
