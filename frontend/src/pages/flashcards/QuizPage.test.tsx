import {beforeEach,describe,expect,it,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {QuizPage} from './QuizPage';
let courseOnly=false,empty=false;
beforeEach(()=>{courseOnly=false;empty=false;vi.stubGlobal('fetch',vi.fn(async(input,init)=>{
 const path=String(input);if(path==='/api/books')return Response.json({books:courseOnly?[]:[{_id:'book-one',title:'Algorithms'}]});
 if(path==='/api/courses')return Response.json({courses:courseOnly?[{_id:'course-one',title:'Psychology'}]:[]});
 if(path.startsWith('/api/study-tools?'))return Response.json({artifacts:[]});
 if(path==='/api/learning/attempts'&&init?.method==='POST')return empty?Response.json({error:'No flashcards found for these materials.'},{status:400}):Response.json({attempt:{_id:'attempt-one'}});
 return Response.json({});
}));});
function mount(path='/flashcards/quiz'){render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/flashcards/quiz" element={<QuizPage/>}/><Route path="/learning/attempts/:id" element={<h1>Recorded practice session</h1>}/></Routes></MemoryRouter>);}
describe('Existing flashcard quiz entry',()=>{
 it('requires materials and starts a durable server-owned attempt instead of scoring browser-supplied questions',async()=>{
  const user=userEvent.setup();mount();await screen.findByLabelText('Algorithms');await user.click(screen.getByRole('button',{name:'Start quiz'}));expect(screen.getByRole('alert')).toHaveTextContent('Select at least one book tag');
  await user.click(screen.getByLabelText('Algorithms'));await user.click(screen.getByRole('button',{name:'Start quiz'}));expect(await screen.findByRole('heading',{name:'Recorded practice session'})).toBeVisible();
  const call=vi.mocked(fetch).mock.calls.find(([p])=>String(p)==='/api/learning/attempts');expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({manual:{tags:['book-one'],course:''}});expect(String(call?.[1]?.body)).not.toContain('correctIndex');
 });
 it('preserves course-only practice when the course has no books',async()=>{
  courseOnly=true;const user=userEvent.setup();mount('/flashcards/quiz?course=course-one');await screen.findByRole('option',{name:'Psychology'});expect(screen.getByText('No related books. This quiz can use the course’s flashcards.')).toBeVisible();await user.click(screen.getByRole('button',{name:'Start quiz'}));await screen.findByRole('heading',{name:'Recorded practice session'});
  const call=vi.mocked(fetch).mock.calls.find(([p])=>String(p)==='/api/learning/attempts');expect(JSON.parse(String(call?.[1]?.body)).manual).toEqual({tags:[],course:'course-one'});
 });
 it('keeps selected materials and provides a useful error when no questions are available',async()=>{
  empty=true;const user=userEvent.setup();mount();await user.click(await screen.findByLabelText('Algorithms'));await user.click(screen.getByRole('button',{name:'Start quiz'}));expect(await screen.findByRole('alert')).toHaveTextContent('No flashcards found');expect(screen.getByLabelText('Algorithms')).toBeChecked();
 });
});
