import {useEffect,useRef,useState} from 'react';
import {Link,useNavigate} from 'react-router-dom';
import {api,errorMessage} from '../../services/api';
import type {QuizAttempt} from '../../services/learning';
export default function AttemptEntry({studyId}:{studyId:string}){
 const navigate=useNavigate(),key=useRef(crypto.randomUUID()),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;void api<{attempt:QuizAttempt}>('/learning/attempts',{method:'POST',body:{studyId,requestId:key.current}}).then(({attempt})=>{if(active)navigate(`/learning/attempts/${attempt._id}`,{replace:true});}).catch(e=>{if(active)setError(errorMessage(e));});return()=>{active=false;};},[studyId,navigate,retry]);
 return <section className="panel">{error?<><p role="alert">{error}</p><button className="btn secondary" onClick={()=>{setError('');setRetry(n=>n+1);}}>Try again</button></>:<p role="status">Opening your saved practice session…</p>}<Link className="text-link" to={`/study-tools/${studyId}`}>Back to study set</Link></section>;
}
