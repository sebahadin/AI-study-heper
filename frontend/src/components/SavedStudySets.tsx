import {Link} from 'react-router-dom';
import {useResource} from '../hooks/useResource';
import type {StudyPage,StudyKind} from '../services/studyTools';
import {Icon} from './Icon';
export function SavedStudySets({kind,course}:{kind:StudyKind;course?:string}){
 const query=new URLSearchParams({kind,status:'saved',...(course&&course!=='none'?{course}:{})});
 const {data}=useResource<StudyPage>(course==='none'?null:`/study-tools?${query}`);
 if(!Array.isArray(data?.artifacts)||!data.artifacts.length)return <div className="saved-study-shortcut"><Link className="study-secondary-action" to={`/study-tools/new?kind=${kind}${course&&course!=='none'?`&course=${course}`:''}`}><Icon name="spark" size={17}/>Create {kind==='quiz'?'a practice quiz':kind==='flashcards'?'a recall deck':'a summary'} from your materials</Link></div>;
 return <section className="saved-study-strip"><header><h2>{kind==='quiz'?'Your saved practice quizzes':kind==='flashcards'?'Your saved recall decks':'Your saved summaries'}</h2><Link className="text-link" to={`/study-tools?kind=${kind}&status=saved`}>All study sets</Link></header><div>{data.artifacts.slice(0,4).map(item=><Link key={item._id} to={`/study-tools/${item._id}`}><Icon name={kind==='flashcards'?'cards':kind==='quiz'?'play':'note'} size={22}/><span><strong>{item.title}</strong><small>{item.count?`${item.count} ${kind==='quiz'?'questions':'cards'} · `:''}Open study set</small></span><span aria-hidden="true">↗</span></Link>)}</div></section>;
}
