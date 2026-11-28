import type {ChatCitation} from './chat';
export interface LearningSummary {
 total:number;submitted:number;revealed:number;skipped:number;earned:number;possible:number;percentage:number|null;
 choice:{earned:number;possible:number;answered:number;correct:number};ai:{earned:number;possible:number;graded:number;pending:number};
 misses:{questionId:string;topic:string;reason:string}[];
}
export interface AttemptQuestion {id:string;kind:'choice'|'written'|'code';prompt:string;options:string[];language:string;starterCode:string;citationNumbers:number[];maxPoints:number;correctIndex?:number;referenceAnswer?:string;explanation?:string;rubric?:{description:string;maxPoints:number}[]}
export interface Assessment {status:'processing'|'ready'|'failed'|'interrupted';earned?:number;feedback?:string;error?:string;model?:string;assessedAt?:string;label?:string;criteria?:{description:string;maxPoints:number;points:number;reason:string}[]}
export interface AttemptBrief {_id:string;title:string;origin:'manual'|'generated';studyId:string|null;status:'in_progress'|'completed';revision:number;position:number;marked:string[];createdAt:string;updatedAt:string;completedAt:string|null;summary:LearningSummary}
export interface QuizAttempt extends AttemptBrief {questions:AttemptQuestion[];answers:Record<string,{value:string|number|null;submitted:boolean;revealed?:boolean}>;assessments:Record<string,Assessment>;citations:ChatCitation[]}
export interface LibraryRecommendation {id:string;type:string;title:string;href:string;hint:string;reason:string}
export interface LearningDashboard {stats:{completed:number;choiceCorrect:number;choiceAnswered:number;aiAssessed:number;aiEarned:number;aiPossible:number};coverage:string;canCoach?:boolean;resume:AttemptBrief[];revisit:{questionId:string;topic:string;reason:string;attemptId:string;title:string}[];recommendations:LibraryRecommendation[];coaching:{overview:string;focusAreas:{topic:string;reason:string;attemptIds:string[]}[];recommendations:LibraryRecommendation[];nextSteps:string[];generatedAt:string;stale:boolean}|null;coachingBusy:boolean}
export interface AttemptEdits {answers:Record<string,string|number|null>;position:number;marked:string[]}
export const attemptEdits=(a:QuizAttempt):AttemptEdits=>({answers:Object.fromEntries(Object.entries(a.answers).map(([id,v])=>[id,v.value])),position:a.position,marked:a.marked});
const prefix='classmate:quiz-attempt:';
export function rememberAttempt(id:string,revision:number,edits:AttemptEdits){try{sessionStorage.setItem(prefix+id,JSON.stringify({revision,edits}));}catch{/* Server autosave is still available. */}}
export function forgetAttempt(id:string){try{sessionStorage.removeItem(prefix+id);}catch{/* Storage may be disabled. */}}
export function readAttempt(id:string):{revision:number;edits:AttemptEdits}|null {try{const v=JSON.parse(sessionStorage.getItem(prefix+id)||'null');return v&&Number.isInteger(v.revision)&&Number.isInteger(v.edits?.position)&&Array.isArray(v.edits.marked)&&v.edits.answers&&typeof v.edits.answers==='object'?v:null;}catch{return null;}}
