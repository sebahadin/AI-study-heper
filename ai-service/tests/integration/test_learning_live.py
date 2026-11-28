"""Opt-in billed learning checks using synthetic records and disposable services.
RUN_LEARNING_LIVE_TEST=1 uv run --locked pytest tests/integration/test_learning_live.py
"""
import json, os
from uuid import uuid4
import httpx
import pytest
from test_worker_live import stack
from test_study_tools_live import prepare_library
pytestmark=pytest.mark.skipif(os.getenv('RUN_LEARNING_LIVE_TEST')!='1', reason='Opt-in real-provider test')

def prepare_quiz(browser, library):
    created=browser.post('/api/study-tools',json={'requestId':str(uuid4()),'kind':'quiz','selection':{'notes':[library['note']]},'instruction':'Create five mixed-format Python questions: include multiple-choice, a written explanation, and a coding task, all supported by these notes.','count':5,'format':'auto'})
    assert created.status_code==201
    row=created.json()['artifact'];path='/api/study-tools/'+row['_id']
    with browser.stream('POST',path+'/generate',json={}) as response:
        events=[json.loads(line[6:]) for line in response.iter_lines() if line.startswith('data: ')]
    assert not [e for e in events if e['type']=='error']
    row=next(e['artifact'] for e in events if e['type']=='done')
    assert {q['kind'] for q in row['draft']['questions']}=={'choice','written','code'}
    confirmation=browser.post(path+'/confirmations',json={'action':'save','revision':row['revision']}).json()
    saved=browser.post(path+'/actions',json={k:confirmation[k] for k in ('action','revision','token')})
    assert saved.status_code==200
    return saved.json()['artifact']

def test_persistent_attempts_real_assessments_and_coaching(stack):
    with httpx.Client(base_url=stack['url'],timeout=110) as browser:
        library=prepare_library(browser);quiz=prepare_quiz(browser,library)
        response=browser.post('/api/learning/attempts',json={'requestId':str(uuid4()),'studyId':quiz['_id']});assert response.status_code==201
        a=response.json()['attempt'];path='/api/learning/attempts/'+a['_id']
        for index,q in enumerate(quiz['content']['questions']):
            qid='q'+str(index+1);answer=q['correctIndex'] if q['kind']=='choice' else q['referenceAnswer']
            response=browser.post(path+'/answers/'+qid,json={'revision':a['revision'],'answer':answer,'reveal':False});assert response.status_code==200;a=response.json()['attempt']
            if q['kind']!='choice':
                response=browser.post(path+'/assessments/'+qid,json={});assert response.status_code==200;a=response.json()['attempt'];assert a['assessments'][qid]['status']=='ready'
        response=browser.post(path+'/complete',json={'revision':a['revision']});assert response.status_code==200;assert response.json()['attempt']['summary']['percentage'] is not None
        response=browser.post('/api/learning/coaching',json={});assert response.status_code==200;assert response.json()['coaching']['overview']
        browser.post('/api/auth/logout');browser.post('/api/auth/login',json=library['credentials']);assert browser.get(path).json()['attempt']['status']=='completed'
