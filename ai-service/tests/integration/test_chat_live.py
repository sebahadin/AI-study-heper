"""Opt-in real-provider chat: synthetic sources in a disposable Mongo/Chroma stack.

RUN_CHAT_LIVE_TEST=1 uv run --locked pytest tests/integration/test_chat_live.py
Uses a small number of billed model calls. All test records are removed.
"""
import json
import os
import time
import httpx
import pytest
from uuid import uuid4
from test_worker_live import stack, pdf

pytestmark = pytest.mark.skipif(os.getenv('RUN_CHAT_LIVE_TEST') != '1', reason='Opt-in real-provider integration')

def test_complete_persistent_rag_chat(stack):
    with httpx.Client(base_url=stack['url'], timeout=110) as browser:
        credentials = {'username':'chat-live-student','password':'test-password123'}
        registered = browser.post('/api/auth/register', json={**credentials,'email':'chat-live@example.test','confirmPassword':credentials['password']})
        assert registered.status_code == 201
        assert browser.post('/api/auth/login', json=credentials).status_code == 200
        assert browser.get('/api/chat/config').json()['enabled']
        note = browser.post('/api/notes', json={'title':'Cell energy','content':'Mitochondria convert nutrients into ATP. ATP provides usable energy for cellular activities.'}).json()['note']
        deadline = time.monotonic()+90
        while browser.get('/api/notes/'+note['_id']+'/indexing').json()['indexing']['status'] != 'ready':
            assert time.monotonic() < deadline
            time.sleep(.2)
        conversation = browser.post('/api/chat', json={'selection':{'notes':[note['_id']]},'topic':'Cell energy'}).json()['conversation']
        path = '/api/chat/'+conversation['_id']
        def answer(question):
            with browser.stream('POST',path+'/messages',json={'content':question,'requestId':str(uuid4())}) as response:
                assert response.status_code == 200
                events = [json.loads(line[6:]) for line in response.iter_lines() if line.startswith('data: ')]
            errors = [event for event in events if event['type']=='error']
            assert not errors, errors
            assert any(event['type']=='delta' for event in events)
            return next(event['message'] for event in events if event['type']=='done')
        first = answer('Using only my selected material, what do mitochondria produce and what is it used for?')
        assert first['mode']=='grounded' and first['citations']
        assert 'ATP' in first['content']
        preview = browser.get(path+'/sources/'+first['id']+'/1')
        assert preview.status_code==200 and 'Mitochondria' in preview.json()['passage']['text']
        followup = answer('What does that molecule provide, according to the same note?')
        assert followup['mode']=='grounded' and followup['citations'] and 'energy' in followup['content'].lower()
        unsupported = answer('What is the capital city of Peru? Answer only if my selected note supports it.')
        assert unsupported['mode']=='insufficient_evidence'
        assert browser.patch(path,json={'allowGeneral':True}).status_code==200
        general = answer('Use general knowledge and clearly label it: what is the capital of Peru?')
        assert general['mode']=='general' and 'Lima' in general['content']
        assert browser.post('/api/auth/logout').status_code==204
        assert browser.get(path).status_code==401
        assert browser.post('/api/auth/login',json=credentials).status_code==200
        saved = browser.get(path).json()['conversation']
        assert len(saved['messages'])==8 and saved['messages'][1]['content']==first['content']
        assert browser.patch('/api/notes/'+note['_id'],json={'content':'The nucleus contains DNA.'}).status_code==200
        assert browser.get(path+'/sources/'+first['id']+'/1').status_code==410
        assert browser.delete(path).status_code==204
        assert browser.get(path).status_code==404

        # PDFs need no book identity, but can inherit a selected book/course scope.
        course = browser.post('/api/courses',json={'title':'Biology'}).json()['course']
        book = browser.post('/api/books',json={'title':'Biology references','author':'Test author','category':'Science','courses':[course['_id']]}).json()['book']
        data = pdf('Chloroplasts capture sunlight to produce sugars during photosynthesis.',pages=2)
        intent = browser.post('/api/documents/uploads',json={'filename':'photosynthesis.pdf','byteCount':len(data),'book':book['_id']}).json()
        assert httpx.put(intent['upload']['url'],headers=intent['upload']['headers'],content=data,timeout=30).status_code==200
        result = browser.post('/api/documents/'+intent['document']['_id']+'/complete',json={})
        assert result.status_code==200
        document=result.json()['document']
        deadline=time.monotonic()+90
        while browser.get('/api/documents/'+document['_id']+'/indexing').json()['indexing']['status']!='ready':
            assert time.monotonic()<deadline;time.sleep(.2)
        search=browser.post('/api/study/search',json={'query':'What do chloroplasts capture?','scope':{'books':[book['_id']]}}).json()
        assert search['passages'][0]['citation']['source']['source_id']==document['_id']
        pdf_conversation=browser.post('/api/chat',json={'selection':{'courses':[course['_id']]},'topic':'Photosynthesis'}).json()['conversation']
        path='/api/chat/'+pdf_conversation['_id']
        pdf_answer=answer('According to my materials, what do chloroplasts capture and produce?')
        assert pdf_answer['mode']=='grounded' and pdf_answer['citations']
        citation=pdf_answer['citations'][0]
        assert citation['source']['source_id']==document['_id'] and citation['source']['source_type']=='document' and citation['page_start']==1
        assert browser.get(path+'/sources/'+pdf_answer['id']+'/'+str(citation['number'])).status_code==200
