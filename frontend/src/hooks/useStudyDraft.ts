import {useCallback,useEffect,useRef,useState} from 'react';
import {api,ApiError,errorMessage} from '../services/api';
import type {StudyArtifact,StudyDraft} from '../services/studyTools';
import {readDraftBackup,rememberDraft,forgetDraft,type DraftBackup} from '../services/studyDraftBackup';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function useStudyDraft(id:string|undefined,paused=false){
 const [artifact,setArtifact]=useState<StudyArtifact|null>(null),[draft,setLocal]=useState<StudyDraft|null>(null);
 const [saving,setSaving]=useState(false),[saveError,setSaveError]=useState(''),[conflict,setConflict]=useState(false),[recovered,setRecovered]=useState<DraftBackup|null>(null),[restored,setRestored]=useState(false);
 const server=useRef<StudyArtifact|null>(null),local=useRef<StudyDraft|null>(null),flight=useRef<Promise<StudyArtifact|null>|null>(null),alive=useRef(true),route=useRef(id),reads=useRef(0),canPersist=useRef(true),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 route.current=id;
 useEffect(()=>{alive.current=true;canPersist.current=true;const clear=()=>{canPersist.current=false;};window.addEventListener('classmate:study-drafts-cleared',clear);return()=>{alive.current=false;window.removeEventListener('classmate:study-drafts-cleared',clear);};},[]);
 const receive=useCallback((row:StudyArtifact,recover=false)=>{
  if(!alive.current||row._id!==route.current)return;
  reads.current++;server.current=row;setArtifact(row);setRestored(false);setRecovered(null);const candidate=row.draft||row.content;
  local.current=candidate;setLocal(candidate);setSaveError('');setConflict(false);
  if(recover&&candidate){const backup=readDraftBackup(row._id);
   if(backup?.draft.kind===row.kind&&!same(backup.draft,candidate)){
    if(backup.revision===row.revision){local.current=backup.draft;setLocal(backup.draft);setRestored(true);}
    else setRecovered(backup);
   }else forgetDraft(row._id);
  }else forgetDraft(row._id);
 },[]);
 const load=useCallback(async(shouldApply?:()=>boolean)=>{const read=++reads.current;const result=await api<{artifact:StudyArtifact}>(`/study-tools/${id}`);if(route.current===id&&read===reads.current&&(!shouldApply||shouldApply()))receive(result.artifact,true);return server.current||result.artifact;},[id,receive]);
 const change=useCallback((value:StudyDraft)=>{local.current=value;setLocal(value);setSaveError('');setRestored(false);if(server.current)rememberDraft(server.current._id,server.current.revision,value);},[]);
 const flush=useCallback(async():Promise<StudyArtifact|null>=>{
  clearTimeout(timer.current);
  if(flight.current)return flight.current;
  const task=(async()=>{
   if(alive.current){setSaving(true);setSaveError('');}
   try{
    while(canPersist.current&&server.current&&local.current&&!same(local.current,server.current.draft||server.current.content)){
     const current=server.current,snapshot=local.current;
     const result=await api<{artifact:StudyArtifact}>(`/study-tools/${current._id}`,{method:'PATCH',body:{revision:current.revision,draft:snapshot}});
     if(!canPersist.current||route.current!==current._id)return result.artifact;
     reads.current++;server.current=result.artifact;if(alive.current)setArtifact(result.artifact);
     if(same(local.current,result.artifact.draft||result.artifact.content))forgetDraft(current._id);
     else if(local.current)rememberDraft(current._id,result.artifact.revision,local.current);
    }
    return server.current;
   }catch(error){if(alive.current){setSaveError(error instanceof ApiError&&error.status===400?'Finish the required draft fields to save these edits.':errorMessage(error));setConflict(error instanceof ApiError&&error.status===409);}throw error;}
   finally{if(alive.current)setSaving(false);}
  })();
  flight.current=task;
  try{return await task;}finally{if(flight.current===task)flight.current=null;}
 },[]);
 useEffect(()=>()=>{if(canPersist.current&&local.current&&server.current&&!same(local.current,server.current.draft||server.current.content))void flush().catch(()=>{});},[flush]);
 const dirty=!!draft&&!same(draft,artifact?.draft||artifact?.content);
 useEffect(()=>{if(!dirty||saveError||conflict||paused)return;timer.current=setTimeout(()=>{void flush().catch(()=>{});},900);return()=>clearTimeout(timer.current);},[draft,dirty,saveError,conflict,paused,flush]);
 useEffect(()=>{const warn=(event:BeforeUnloadEvent)=>{if(local.current&&server.current&&!same(local.current,server.current.draft||server.current.content)){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[]);
 const settled=useCallback(async()=>{clearTimeout(timer.current);try{await flight.current;}catch{/* Deletion can proceed even if private edits are incomplete. */}return server.current;},[]);
 function dispose(){canPersist.current=false;local.current=null;if(id)forgetDraft(id);}
 function restore(){if(recovered){change(recovered.draft);setRecovered(null);setRestored(true);}}
 function dismissRecovery(){if(id)forgetDraft(id);setRecovered(null);}
 return {artifact,draft,dirty,saving,saveError,conflict,recovered,restored,load,receive,change,flush,settled,dispose,restore,dismissRecovery};
}
