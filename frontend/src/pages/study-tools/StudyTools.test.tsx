import {beforeEach,describe,expect,it,vi} from 'vitest';
import {render,screen,waitFor,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import StudyDetail from './StudyDetail';
import StudyPractice from './StudyPractice';
import StudyToolsPage from './StudyToolsPage';
import {StudyMarkdown} from './StudyShared';
import {streamDraft,type StudyArtifact,type PracticeSet,type StudyDraft} from '../../services/studyTools';
vi.mock('../../services/studyTools',async original=>({...await original<typeof import('../../services/studyTools')>(),streamDraft:vi.fn()}));
vi.mock('../../components/CodeAnswerEditor',()=>({default:({value,onChange,label,readOnly}:{value:string;onChange:(v:string)=>void;label:string;readOnly:boolean})=><textarea aria-label={label} value={value} readOnly={readOnly} onChange={e=>onChange(e.target.value)}/>}));
Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(){this.setAttribute('open','');}});
const citation={number:1,chunk_id:'note-'+'a'.repeat(64),source:{source_id:'note-1',source_type:'note' as const,source_version:'v1',index_generation:'g1'},locator:'paragraph 1',title:'Cell energy',href:'/notes/note-1'};
const draft:StudyDraft={kind:'summary',title:'Cell energy summary',body:'Mitochondria supply ATP [1].',cards:[],questions:[],citations:[citation],coverage:{passages:1,coveredSources:1,totalSources:1,excerpted:true}};
const initial:StudyArtifact={_id:'set-1',kind:'summary',title:draft.title,status:'draft',revision:1,savedRevision:0,updatedAt:'2026-11-27T12:00:00Z',hasDraft:true,count:0,request:{kind:'summary',selection:{library:false,notes:['note-1'],documents:[],books:[],courses:[]},topic:'',instruction:'',count:5,format:'auto'},draft,content:null,busy:false,error:null};
let saved=structuredClone(initial),rejectAction=false;
const practice:PracticeSet={_id:'quiz-1',title:'Python practice',kind:'quiz',revision:3,saved:true,citations:[citation],questions:[
 {id:'q1',kind:'choice',prompt:'Which sequence is ordered?',options:['List','Set'],language:'',starterCode:'',citationNumbers:[1]},
 {id:'q2',kind:'written',prompt:'Explain what an accumulator does.',options:[],language:'',starterCode:'',citationNumbers:[1]},
 {id:'q3',kind:'code',prompt:'Write a Python sum function.',options:[],language:'python',starterCode:'pass',citationNumbers:[1]}
]};
beforeEach(()=>{saved=structuredClone(initial);rejectAction=false;vi.mocked(streamDraft).mockReset();vi.stubGlobal('fetch',vi.fn(async(input,init)=>{
 const path=String(input),body=init?.body?JSON.parse(String(init.body)):{};
 if(path==='/api/study-tools/config')return Response.json({enabled:true,defaultCount:7,maxCount:10,model:'test'});
 if(path==='/api/chat/options')return Response.json({notes:[{_id:'note-1',title:'Cell energy'}],books:[],courses:[],documents:[]});
 if(path==='/api/study-tools'&&init?.method==='POST')return Response.json({artifact:{...saved,status:'queued'}});
 if(path.endsWith('/practice'))return Response.json(practice);
 if(path.endsWith('/feedback'))return Response.json(body.questionId==='q1'?{kind:'choice',correct:body.answer===0&&!body.reveal,correctIndex:0,revealed:body.reveal,explanation:'A list is ordered.'}:{kind:body.questionId==='q3'?'code':'written',referenceAnswer:body.questionId==='q3'?'return sum(values)':'It collects a result.',rubric:[{description:'Accumulate the correct result.',maxPoints:2}],selfReview:true,explanation:'Use a neutral starting value.'});
 if(path.includes('/sources/'))return Response.json({passage:{text:'Mitochondria supply ATP.'},href:'/notes/note-1'});
 if(path.endsWith('/confirmations'))return Response.json({token:'x'.repeat(43),action:body.action,revision:saved.revision,preview:saved.draft||saved.content,title:saved.title});
 if(path.endsWith('/actions')){if(rejectAction)return Response.json({error:'The draft changed. Review it again.'},{status:409});saved={...saved,content:saved.draft,draft:null,status:'saved',revision:saved.revision+1,hasDraft:false};return Response.json({artifact:saved});}
 if(path.endsWith('/cancel')){saved={...saved,status:'cancelled',busy:false,error:'Generation stopped.'};return Response.json({artifact:saved});}
 if(init?.method==='PATCH'){saved={...saved,draft:body.draft,revision:saved.revision+1};return Response.json({artifact:saved});}
 return Response.json({artifact:saved});
}));});
function mount(element:React.ReactNode,path='/study-tools/set-1'){return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/study-tools/new" element={element}/><Route path="/study-tools/:id" element={element}/><Route path="/study-tools/:id/practice" element={element}/></Routes></MemoryRouter>);}
describe('Complete study tools interface',()=>{
 it('keeps edits private until the user reviews and confirms the exact revision',async()=>{
  const user=userEvent.setup();mount(<StudyDetail/>);const title=await screen.findByLabelText('Title');await user.clear(title);await user.type(title,'My cell summary');await user.click(screen.getByRole('button',{name:'Review & save'}));
  const dialog=await screen.findByRole('dialog',{name:'Save study set?'});expect(within(dialog).getByText('My cell summary',{selector:'strong'})).toBeVisible();
  expect(vi.mocked(fetch).mock.calls.some(([p])=>String(p).endsWith('/actions'))).toBe(false);
  const confirm=vi.mocked(fetch).mock.calls.find(([p])=>String(p).endsWith('/confirmations'));expect(JSON.parse(String(confirm?.[1]?.body)).revision).toBe(2);
  await user.click(within(dialog).getByRole('button',{name:'Save study set'}));await screen.findByText('Saved to your study sets.');expect(saved.content?.title).toBe('My cell summary');
 });
 it('surfaces stale confirmation errors and keeps the review open for user control',async()=>{
  rejectAction=true;const user=userEvent.setup();mount(<StudyDetail/>);await screen.findByLabelText('Title');await user.click(screen.getByRole('button',{name:'Review & save'}));const dialog=await screen.findByRole('dialog');await user.click(within(dialog).getByRole('button',{name:'Save study set'}));expect(await within(dialog).findByRole('alert')).toHaveTextContent('draft changed');expect(saved.status).toBe('draft');
 });
 it('requires a separate confirmation before deleting a generated study set',async()=>{
  const user=userEvent.setup();mount(<StudyDetail/>);await screen.findByLabelText('Title');await user.click(screen.getByRole('button',{name:'Delete study set'}));const dialog=await screen.findByRole('dialog',{name:'Delete?'});expect(vi.mocked(fetch).mock.calls.some(([p])=>String(p).endsWith('/actions'))).toBe(false);await user.click(within(dialog).getByRole('button',{name:'Go back'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(saved.status).toBe('draft');
 });
 it('uses the server-owned default count and selected note when creating a draft request',async()=>{
  const user=userEvent.setup();mount(<StudyToolsPage create/>,'/study-tools/new?kind=quiz&note=note-1');await waitFor(()=>expect(screen.getByRole('spinbutton',{name:'Questions'})).toHaveValue(7));await user.click(screen.getByRole('button',{name:'Generate draft'}));await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([p,init])=>p==='/api/study-tools'&&init?.method==='POST')).toBe(true));const call=vi.mocked(fetch).mock.calls.find(([p,init])=>p==='/api/study-tools'&&init?.method==='POST');expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({kind:'quiz',count:7,selection:{notes:['note-1']}});
 });
 it('supports choice, written, and code answers with explicit self-review rubrics',async()=>{
  const user=userEvent.setup();mount(<StudyPractice/>,'/study-tools/quiz-1/practice');await screen.findByText('Which sequence is ordered?');await user.click(screen.getByRole('radio',{name:'A List'}));await user.click(screen.getByRole('button',{name:'Check answer'}));await screen.findByText('That’s right.');await user.click(screen.getByRole('button',{name:'Next'}));await user.type(screen.getByLabelText('Your answer'),'It collects a result.');await user.click(screen.getByRole('button',{name:'Compare with reference'}));await screen.findByText('Self-review checklist · no AI grade');await user.click(screen.getByRole('button',{name:'Next'}));await screen.findByLabelText('Your code answer');await user.click(screen.getByRole('button',{name:'Compare with reference'}));await screen.findByText('return sum(values)');const codeCall=vi.mocked(fetch).mock.calls.filter(([p])=>String(p).endsWith('/feedback')).at(-1);expect(JSON.parse(String(codeCall?.[1]?.body))).toMatchObject({questionId:'q3',answer:'pass'});await user.click(screen.getByRole('button',{name:'Finish'}));expect(await screen.findByText('3 of 3 questions reviewed.')).toBeVisible();
 });
 it('can stop generation without presenting an incomplete draft as saved',async()=>{
  saved={...saved,status:'queued',draft:null,hasDraft:false};let aborted=false;
  vi.mocked(streamDraft).mockImplementation(async(_id,onEvent,signal)=>{onEvent({type:'status',phase:'drafting'});await new Promise<void>(resolve=>signal.addEventListener('abort',()=>{aborted=true;saved={...saved,status:'cancelled'};resolve();},{once:true}));});
  const user=userEvent.setup();mount(<StudyDetail/>,'/study-tools/set-1?generate=1');await user.click(await screen.findByRole('button',{name:'Stop generation'}));expect(await screen.findByRole('button',{name:'Retry generation'})).toBeVisible();expect(aborted).toBe(true);expect(saved.content).toBeNull();
 });
 it('renders generated Markdown without loading images or raw HTML',()=>{
  const {container}=render(<StudyMarkdown text={'<script>alert(1)</script>\n![tracking](https://example.com/pixel)\n[unsafe](javascript:alert(1))'}/>);expect(container.querySelector('script')).toBeNull();expect(container.querySelector('img')).toBeNull();expect(container.querySelector('a')).toBeNull();
 });
});
