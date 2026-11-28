import {useState} from 'react';
import {useResource} from '../../hooks/useResource';
import type {LearningDashboard} from '../../services/learning';
import {LearningOverview} from './LearningOverview';
export default function LearningWidget(){const {data,error,reload}=useResource<LearningDashboard>('/learning');const [updated,setUpdated]=useState<LearningDashboard|null>(null);const value=updated||data;if(error)return <div className="panel"><p>Study progress is temporarily unavailable.</p><button className="text-link" onClick={reload}>Try again</button></div>;if(!Array.isArray(value?.resume))return null;return <LearningOverview data={value!} onUpdate={setUpdated} compact/>;}
