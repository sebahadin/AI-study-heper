import type {StudyDraft} from './studyTools';
const prefix='classmate:study-draft:';
export interface DraftBackup {revision:number;draft:StudyDraft}
export function readDraftBackup(id:string):DraftBackup|null {
 try {const value=JSON.parse(sessionStorage.getItem(prefix+id)||'null');
  return value&&Number.isInteger(value.revision)&&value.draft&&typeof value.draft.title==='string'&&Array.isArray(value.draft.cards)&&Array.isArray(value.draft.questions)&&Array.isArray(value.draft.citations)&&value.draft.coverage?value:null;
 } catch{return null;}
}
export function rememberDraft(id:string,revision:number,draft:StudyDraft){try{sessionStorage.setItem(prefix+id,JSON.stringify({revision,draft}));}catch{/* Server autosave still works if local storage is unavailable. */}}
export function forgetDraft(id:string){try{sessionStorage.removeItem(prefix+id);}catch{/* Storage can be disabled. */}}
export function clearStudyDraftBackups(){window.dispatchEvent(new Event('classmate:study-drafts-cleared'));try{for(let i=sessionStorage.length-1;i>=0;i--){const key=sessionStorage.key(i);if(key?.startsWith(prefix)||key?.startsWith('classmate:quiz-attempt:'))sessionStorage.removeItem(key);}}catch{/* Storage can be disabled. */}}
