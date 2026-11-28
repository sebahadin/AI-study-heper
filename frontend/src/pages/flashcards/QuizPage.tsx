import {SavedStudySets} from '../../components/SavedStudySets';
import {CourseFilter,courseIds} from '../../components/CourseFields';
import {useRef,useState} from 'react';
import {Link,useNavigate,useSearchParams} from 'react-router-dom';
import {useResource} from '../../hooks/useResource';
import {api,errorMessage} from '../../services/api';
import type {Book} from '../../types';
import type {QuizAttempt} from '../../services/learning';
import {ErrorBanner,Loading,LoadError} from '../../components/Feedback';
import {BookTags} from '../../components/BookTags';
import {PageHeader} from '../../components/PageElements';
import {Icon} from '../../components/Icon';
export function QuizPage(){
 const [params]=useSearchParams(),navigate=useNavigate(),books=useResource<{books:Book[]}>('/books');
 const [course,setCourse]=useState(params.get('course')||''),[tags,setTags]=useState<string[]>(()=>(params.get('tags')||'').split(',').filter(Boolean)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const pending=useRef<{key:string;requestId:string}|null>(null);
 async function start(){setError('');if(!tags.length&&!course){setError('Select at least one book tag or a course to start the quiz.');return;}setBusy(true);const key=JSON.stringify([tags,course]);if(pending.current?.key!==key)pending.current={key,requestId:crypto.randomUUID()};try{const {attempt}=await api<{attempt:QuizAttempt}>('/learning/attempts',{method:'POST',body:{requestId:pending.current.requestId,manual:{tags,course}}});navigate(`/learning/attempts/${attempt._id}`);}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
 if(books.loading)return <Loading/>;if(books.error||!books.data)return <LoadError message={books.error||'Could not load books.'} retry={books.reload}/>;
 return <section className="section quiz-section"><PageHeader eyebrow="A moment to focus" title="Take a quiz" description="Choose a course or books. Your questions, answers, and progress will be saved." action={<Link className="btn secondary" to="/learning"><Icon name="clock" size={17}/>Your learning history</Link>}/><SavedStudySets kind="quiz" course={course}/><ErrorBanner message={error}/><div className="controls"><div className="quiz-course-selector"><h3>Study by course</h3><p>Choose a course, or pick individual books below. Existing unfinished attempts resume where you left off.</p><CourseFilter allLabel="Choose a course" value={course} onChange={value=>{setCourse(value);setTags([]);}}/></div><BookTags label={course?'Narrow by books (optional)':'Filter by books'} emptyMessage={course?'No related books. This quiz can use the course’s flashcards.':'Add a book to start tagging flashcards.'} books={books.data.books.filter(book=>!course||(course==='none'?!courseIds(book.courses).length:courseIds(book.courses).includes(course)))} selected={tags} onChange={setTags} disabled={busy}/>{!books.data.books.length&&<Link to="/books/add">Add your first book</Link>}<button type="button" className="btn primary" disabled={busy||!books.data.books.length&&!course} onClick={()=>void start()}>{busy?'Opening saved practice…':'Start quiz'}</button><p className="study-soft-note">Practice uses up to 100 of the selected materials’ flashcards. Choice answers are scored by Classmate.</p></div><p className="back-link"><Link to="/dashboard">Back to dashboard</Link></p></section>;
}
