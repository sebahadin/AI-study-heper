import {beforeEach,describe,expect,it,vi} from 'vitest';
import {render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import AttemptPractice from './AttemptPractice';
import LearningPage from './LearningPage';
import AttemptEntry from './AttemptEntry';
import {attemptFixture,dashboardFixture} from './fixtures.test-data';
import type {QuizAttempt,LearningDashboard} from '../../services/learning';
vi.mock('../../components/CodeAnswerEditor',()=>({default:({value,onChange,label,readOnly}:{value:string;onChange:(v:string)=>void;label:string;readOnly:boolean})=><textarea aria-label={label} value={value} readOnly={readOnly} onChange={e=>onChange(e.target.value)}/>}));
let row:QuizAttempt,overview:LearningDashboard,assessmentFails=false;
beforeEach(()=>{row=structuredClone(attemptFixture);overview=structuredClone(dashboardFixture);assessmentFails=false;sessionStorage.clear();vi.stubGlobal('fetch',vi.fn(async(input,init)=>{
 const path=String(input),body=init?.body?JSON.parse(String(init.body)):{};
 if(path==='/api/learning')return Response.json(overview);
 if(path==='/api/learning/attempts'&&!init?.method)return Response.json({attempts:[row],nextCursor:null});
 if(path==='/api/learning/coaching'){overview={...overview,coaching:{overview:'Revisit lists, then practice.',focusAreas:[{topic:'Lists',reason:'One recent mistake.',attemptIds:['old-attempt']}],recommendations:overview.recommendations,nextSteps:['Explain an example.'],generatedAt:'2026-11-27T12:00:00Z',stale:false}};return Response.json(overview);}
 if(path==='/api/learning/attempts'&&init?.method==='POST')return Response.json({attempt:row});
 if(init?.method==='PATCH'){row={...row,revision:row.revision+1,position:body.position,marked:body.marked,answers:{...row.answers,...Object.fromEntries(Object.entries(body.answers as Record<string,string|number|null>).filter(([id])=>!row.answers[id]?.submitted).map(([id,value])=>[id,{value,submitted:false}]))}};return Response.json({attempt:row});}
 if(path.includes('/answers/')){const id=path.split('/').at(-1)!;row={...row,revision:row.revision+1,answers:{...row.answers,[id]:{value:body.reveal?null:body.answer,submitted:true,revealed:body.reveal}},questions:row.questions.map(q=>q.id===id?{...q,correctIndex:q.kind==='choice'?0:undefined,referenceAnswer:q.kind==='code'?'return sum(values)':'It gathers a result.',explanation:'Start with a neutral value.',rubric:q.kind==='choice'?[]:[{description:'Explain the result.',maxPoints:q.maxPoints}]}:q)};return Response.json({attempt:row});}
 if(path.includes('/assessments/')){if(assessmentFails)return Response.json({error:'AI feedback was interrupted. Your answer is saved.'},{status:503});const id=path.split('/').at(-1)!;row={...row,assessments:{...row.assessments,[id]:{status:'ready',earned:1,feedback:'Explain the starting value.',criteria:[{description:'Explain the result.',maxPoints:2,points:1,reason:'Needs a clearer explanation.'}]}}};return Response.json({attempt:row});}
 if(path.endsWith('/complete')){row={...row,status:'completed',revision:row.revision+1,summary:{...row.summary,submitted:1,skipped:2,percentage:17,choice:{earned:1,possible:1,answered:1,correct:1}}};return Response.json({attempt:row});}
 return Response.json({attempt:row});
}));});
function mount(element:React.ReactNode,path='/learning/attempts/attempt-1'){render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/learning" element={element}/><Route path="/learning/attempts/:id" element={element}/><Route path="/entry" element={element}/></Routes></MemoryRouter>);}
describe('Durable quiz experience',()=>{
 it('saves drafts before submitting, shows server feedback, and persists a completed result',async()=>{
  const user=userEvent.setup();mount(<AttemptPractice/>);await user.click(await screen.findByRole('radio',{name:'A List'}));await user.click(screen.getByRole('button',{name:'Check answer'}));expect(await screen.findByRole('heading',{name:'That’s right.'})).toBeVisible();
  const calls=vi.mocked(fetch).mock.calls;expect(calls.findIndex(([,init])=>init?.method==='PATCH')).toBeLessThan(calls.findIndex(([p])=>String(p).includes('/answers/')));
  await user.click(screen.getByRole('button',{name:'Finish attempt'}));expect(await screen.findByText('17%')).toBeVisible();expect(screen.getByText('Results saved')).toBeVisible();expect(screen.getByRole('button',{name:'Try this quiz again'})).toBeEnabled();
 });
 it('preserves a submitted written answer after an AI outage and retries assessment without a second answer submission',async()=>{
  assessmentFails=true;const user=userEvent.setup();mount(<AttemptPractice/>);await user.click(await screen.findByRole('button',{name:'Question 2'}));await user.type(screen.getByLabelText('Your answer'),'It collects a running result.');await user.click(screen.getByRole('button',{name:'Submit & get AI feedback'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your answer is saved');expect(screen.getByLabelText('Your answer')).toBeDisabled();expect(row.answers.q2.submitted).toBe(true);
  assessmentFails=false;await user.click(screen.getByRole('button',{name:'Get AI feedback'}));expect(await screen.findByText('AI assessment · 1/2')).toBeVisible();expect(vi.mocked(fetch).mock.calls.filter(([p])=>String(p).includes('/answers/q2'))).toHaveLength(1);
 });
 it('keeps draft answers when changing questions and uses the appropriate code editor',async()=>{
  const user=userEvent.setup();mount(<AttemptPractice/>);await user.click(await screen.findByRole('button',{name:'Question 2'}));await user.type(screen.getByLabelText('Your answer'),'My unfinished idea.');await user.click(screen.getByRole('button',{name:'Review later'}));await user.click(screen.getByRole('button',{name:'Question 3'}));expect(await screen.findByLabelText('Your code answer')).toHaveValue('# Start here');await user.click(screen.getByRole('button',{name:'Question 2, marked for review'}));expect(screen.getByLabelText('Your answer')).toHaveValue('My unfinished idea.');
 });
 it('restores an unfinished written answer with a stable accessible field name',async()=>{
  row={...row,position:1,answers:{q2:{value:'A saved unfinished answer.',submitted:false}}};mount(<AttemptPractice/>);expect(await screen.findByRole('textbox',{name:'Your answer'})).toHaveValue('A saved unfinished answer.');
 });
 it('opens an existing saved quiz through the durable attempt API',async()=>{
  mount(<AttemptEntry studyId="set-1"/>,'/entry');await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([p,init])=>p==='/api/learning/attempts'&&init?.method==='POST')).toBe(true));const call=vi.mocked(fetch).mock.calls.find(([p,init])=>p==='/api/learning/attempts'&&init?.method==='POST');expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({studyId:'set-1'});
 });
});
describe('Learning history and guidance',()=>{
 it('offers resume, mistakes and library links without automatically generating paid coaching',async()=>{
  mount(<LearningPage/>,'/learning');expect(await screen.findByRole('link',{name:/Pick up where you left off/})).toHaveAttribute('href','/learning/attempts/attempt-1');expect(screen.getByRole('link',{name:/Incorrect choice/})).toHaveAttribute('href','/learning/attempts/old-attempt?question=q1');expect(screen.getByRole('link',{name:/Python lists/})).toHaveAttribute('href','/books/book-1');expect(vi.mocked(fetch).mock.calls.some(([p])=>String(p).endsWith('/coaching'))).toBe(false);
 });
 it('requests coaching explicitly and shows current-resource recommendations with supporting attempts',async()=>{
  const user=userEvent.setup();mount(<LearningPage/>,'/learning');await user.click(await screen.findByRole('button',{name:'Prepare study suggestions'}));expect(await screen.findByText('Revisit lists, then practice.')).toBeVisible();expect(screen.getByRole('link',{name:'Review the supporting attempt'})).toHaveAttribute('href','/learning/attempts/old-attempt');
 });
 it('shows empty history and a useful first-session entry',async()=>{
  overview={...overview,resume:[],revisit:[],recommendations:[],canCoach:false};vi.mocked(fetch).mockImplementation(async input=>Response.json(String(input)==='/api/learning'?overview:{attempts:[],nextCursor:null}));mount(<LearningPage/>,'/learning');expect(await screen.findByRole('heading',{name:'Your first session is a starting point.'})).toBeVisible();expect(screen.getByRole('button',{name:'Prepare study suggestions'})).toBeDisabled();
 });
 it('labels results as provisional while open-answer assessment is pending',async()=>{
  row={...row,status:'completed',summary:{...row.summary,ai:{...row.summary.ai,pending:1}}};mount(<AttemptPractice/>);const label=await screen.findByText('Awaiting assessment');expect(within(label.parentElement!).getByText('Pending')).toBeVisible();expect(screen.getByText(/keep the combined result provisional/)).toBeVisible();
 });
});
