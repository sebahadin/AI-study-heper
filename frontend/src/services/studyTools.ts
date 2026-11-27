import { ApiError } from './api';
import type { ChatCitation, ChatSelection } from './chat';
export type StudyKind = 'summary' | 'explanation' | 'flashcards' | 'quiz';
export type QuestionKind = 'choice' | 'written' | 'code';
export interface Criterion { description: string; maxPoints: number }
export interface StudyCard { front: string; back: string; explanation: string; citationNumbers: number[] }
export interface StudyQuestion { kind: QuestionKind; prompt: string; options: string[]; correctIndex: number | null; explanation: string; referenceAnswer: string; rubric: Criterion[]; language: string; starterCode: string; citationNumbers: number[] }
export interface StudyDraft { kind: StudyKind; title: string; body: string; cards: StudyCard[]; questions: StudyQuestion[]; citations: ChatCitation[]; coverage: { passages: number; coveredSources: number; totalSources: number; excerpted: true } }
export interface StudyRequest { kind: StudyKind; selection: ChatSelection; topic: string; instruction: string; count: number; format: 'auto' | QuestionKind }
export interface StudyArtifact { _id: string; kind: StudyKind; title: string; status: 'queued' | 'generating' | 'draft' | 'saved' | 'failed' | 'cancelled'; revision: number; savedRevision: number; updatedAt: string; hasDraft: boolean; count: number; request: StudyRequest; draft: StudyDraft | null; content: StudyDraft | null; busy: boolean; error: string | null }
export interface StudyConfig { enabled: boolean; model: string; defaultCount: number | null; maxCount: number }
export interface StudyPage { artifacts: StudyArtifact[]; nextCursor: string | null }
export interface PracticeQuestion { id: string; kind: QuestionKind; prompt: string; options: string[]; language: string; starterCode: string; citationNumbers: number[] }
export interface PracticeSet { _id: string; title: string; kind: 'quiz' | 'flashcards'; revision: number; saved: boolean; citations: ChatCitation[]; questions?: PracticeQuestion[]; cards?: StudyCard[] }
export interface Feedback { kind: QuestionKind; correct?: boolean; correctIndex?: number; revealed?: boolean; explanation: string; referenceAnswer?: string; rubric?: Criterion[]; selfReview?: boolean }
export const kindLabels: Record<StudyKind,string> = {summary:'Summary',explanation:'Explanation',flashcards:'Flashcard deck',quiz:'Practice quiz'};
export const kindDescriptions: Record<StudyKind,string> = {summary:'Find the main ideas and connections.',explanation:'Work through a concept with a clear example.',flashcards:'Turn important ideas into recall practice.',quiz:'Check your understanding in the right format.'};
export async function streamDraft(id: string, onEvent: (event: {type:string;phase?:string;artifact?:StudyArtifact;message?:string}) => void, signal:AbortSignal) {
 const response=await fetch(`/api/study-tools/${id}/generate`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',Accept:'text/event-stream'},body:'{}',signal});
 if(!response.ok){if(response.status===401)window.dispatchEvent(new Event('classmate:unauthenticated'));const body=await response.json().catch(()=>({}));throw new ApiError(body.error||'Could not start this draft.',response.status);}
 if(!response.body||!response.headers.get('content-type')?.includes('text/event-stream'))throw new Error('Unexpected generation response.');
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',completed=false;
 try{while(true){const{value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});buffer=buffer.replace(/\r\n/g,'\n');if(buffer.length>262144)throw new Error('The draft was too large.');let split;
  while((split=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,split);buffer=buffer.slice(split+2);const data=frame.split('\n').filter(s=>s.startsWith('data:')).map(s=>s.slice(5).trimStart()).join('\n');if(!data)continue;const event=JSON.parse(data);if(['status','done','error'].includes(event.type))onEvent(event);if(event.type==='done'||event.type==='error')completed=true;}
  if(done)break;
 }if(!completed&&!signal.aborted)throw new Error('Generation was interrupted. Your draft request is saved; retry when ready.');}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
