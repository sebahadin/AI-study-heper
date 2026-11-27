"""Opt-in billed generation with synthetic notes/PDFs and disposable services.

RUN_STUDY_LIVE_TEST=1 uv run --locked pytest tests/integration/test_study_tools_live.py
"""
import json,os,time
from uuid import uuid4
import httpx
import pytest
from test_worker_live import stack,pdf
pytestmark=pytest.mark.skipif(os.getenv('RUN_STUDY_LIVE_TEST')!='1',reason='Opt-in real-provider test')

NOTES="""Python lists are ordered sequences. A list preserves its item order, and indices start at zero. For example, values = [2, 4, 6] has values[0] equal to 2.

A for loop visits each item in a sequence. The syntax for value in values: processes each value in order. A loop can accumulate a result.

To sum a list of numbers, initialize total = 0, visit each number, and add it to total. The list [2, 4, 6] sums to 12. An empty list sums to 0 because no additions occur.

A function groups reusable instructions and returns a result using return. Define a function using def, a name, parentheses for arguments, a colon, and an indented body. A sum_numbers(values) function can return the accumulated total.

A condition uses if to decide whether to execute a block. value > 0 tests whether a number is positive. Counting positive numbers starts count at zero and increases count for each value greater than zero.

A test compares the function's actual output with an expected output. Useful test cases include a typical list, an empty list, and lists containing negative numbers. sum_numbers([-1, 3]) should return 2.

Python indentation marks blocks. All statements inside a loop or function must be indented consistently. A return inside a loop ends the function early; to return the completed total, place return after the loop.

An accumulator starts with a neutral value and updates each iteration. Addition uses 0; multiplication uses 1. A loop over n elements takes n iterations."""

def prepare_library(browser):
    credentials={'username':'study-live-student','password':'test-password123'}
    assert browser.post('/api/auth/register',json={**credentials,'email':'study-live@example.test','confirmPassword':credentials['password']}).status_code==201
    assert browser.post('/api/auth/login',json=credentials).status_code==200
    course=browser.post('/api/courses',json={'title':'Programming foundations'}).json()['course']
    book=browser.post('/api/books',json={'title':'Python workbook','author':'Test teacher','category':'Programming','courses':[course['_id']]}).json()['book']
    note=browser.post('/api/notes',json={'title':'Python lists and loops','content':NOTES,'book':book['_id']}).json()['note']
    data=pdf('Lists preserve item order. Accumulators collect results while a loop visits items in order. An addition accumulator starts at zero.',pages=2)
    intent=browser.post('/api/documents/uploads',json={'filename':'ordered-sequences.pdf','byteCount':len(data),'book':book['_id']}).json()
    assert httpx.put(intent['upload']['url'],headers=intent['upload']['headers'],content=data,timeout=30).status_code==200
    result=browser.post('/api/documents/'+intent['document']['_id']+'/complete',json={});assert result.status_code==200
    document=result.json()['document']
    for kind,source in [('notes',note),('documents',document)]:
        deadline=time.monotonic()+90
        while browser.get(f"/api/{kind}/{source['_id']}/indexing").json()['indexing']['status']!='ready':
            assert time.monotonic()<deadline;time.sleep(.2)
    return {'credentials':credentials,'course':course['_id'],'book':book['_id'],'note':note['_id'],'document':document['_id']}

def test_complete_confirmed_study_tools(stack):
    with httpx.Client(base_url=stack['url'],timeout=110) as browser:
        library=prepare_library(browser)
        config=browser.get('/api/study-tools/config').json();assert config['enabled'] and config['defaultCount']==5
        def generate(kind,scope=None,instruction='',count=None,format='auto'):
            body={'requestId':str(uuid4()),'kind':kind,'selection':scope or {'notes':[library['note']]},'instruction':instruction,'format':format}
            if count is not None:body['count']=count
            created=browser.post('/api/study-tools',json=body);assert created.status_code==201
            row=created.json()['artifact'];path='/api/study-tools/'+row['_id']
            with browser.stream('POST',path+'/generate',json={}) as response:
                assert response.status_code==200
                events=[json.loads(line[6:]) for line in response.iter_lines() if line.startswith('data: ')]
            errors=[e for e in events if e['type']=='error'];assert not errors,errors
            ready=next(e['artifact'] for e in events if e['type']=='done')
            assert ready['status']=='draft' and ready['content'] is None
            assert ready['draft']['citations']
            citation=ready['draft']['citations'][0]
            assert browser.get(path+'/sources/'+str(citation['number'])).status_code==200
            return ready
        def apply(row,action):
            path='/api/study-tools/'+row['_id'];confirmation=browser.post(path+'/confirmations',json={'action':action,'revision':row['revision']});assert confirmation.status_code==200
            body={k:confirmation.json()[k] for k in ('token','revision','action')}
            accepted=browser.post(path+'/actions',json=body);assert accepted.status_code==200
            assert browser.post(path+'/actions',json=body).status_code==200
            return accepted.json()
        quiz=generate('quiz',instruction='Make a balanced mixed-format Python quiz with at least one multiple-choice, one written explanation, and one coding task. Use only supported concepts.')
        assert len(quiz['draft']['questions'])==5
        assert {q['kind'] for q in quiz['draft']['questions']}=={'choice','written','code'}
        assert browser.get('/api/study-tools?status=saved').json()['artifacts']==[]
        changed={**quiz['draft'],'title':'My Python foundations practice'}
        updated=browser.patch('/api/study-tools/'+quiz['_id'],json={'revision':quiz['revision'],'draft':changed});assert updated.status_code==200
        quiz=apply(updated.json()['artifact'],'save')['artifact']
        practice=browser.get('/api/study-tools/'+quiz['_id']+'/practice').json()
        assert 'correctIndex' not in json.dumps(practice) and 'referenceAnswer' not in json.dumps(practice)
        for index,q in enumerate(quiz['content']['questions']):
            response=browser.post('/api/study-tools/'+quiz['_id']+'/feedback',json={'revision':practice['revision'],'questionId':'q'+str(index+1),'answer':q['correctIndex'] if q['kind']=='choice' else q['referenceAnswer']})
            assert response.status_code==200
            assert response.json().get('correct') if q['kind']=='choice' else response.json()['selfReview']
        summary=generate('summary',scope={'courses':[library['course']]},instruction='Summarize the connections between ordered lists, loops and accumulators, with source references.')
        apply(summary,'save')
        deck=generate('flashcards',count=3,instruction='Use different Python list, loop and accumulator concepts.')
        assert len(deck['draft']['cards'])==3;apply(deck,'save')
        explanation=generate('explanation',scope={'documents':[library['document']]},instruction='Explain why an addition accumulator starts at zero, using only this material.')
        assert any(c['source']['source_type']=='document' and c['page_start']==1 for c in explanation['draft']['citations'])
        code=generate('quiz',count=2,format='code',instruction='Write short Python list-processing functions supported by these notes.')
        assert all(q['kind']=='code' and q['referenceAnswer'] and q['rubric'] for q in code['draft']['questions'])
        conversation=browser.post('/api/chat',json={'selection':{'notes':[library['note']]}}).json()['conversation']
        with browser.stream('POST','/api/chat/'+conversation['_id']+'/messages',json={'content':'Generate exactly 3 flashcard drafts about Python loops from my selected notes.','requestId':str(uuid4())}) as response:
            events=[json.loads(line[6:]) for line in response.iter_lines() if line.startswith('data: ')]
        assert not [e for e in events if e['type']=='error'],events
        message=next(e['message'] for e in events if e['type']=='done');assert message['mode']=='draft' and message['proposalId']
        chat_draft=browser.get('/api/study-tools/'+message['proposalId']).json()['artifact'];assert len(chat_draft['draft']['cards'])==3 and chat_draft['status']=='draft'
        found=browser.get('/api/study-tools',params={'status':'saved','course':library['course']}).json()['artifacts'];assert quiz['_id'] in [r['_id'] for r in found]
        assert browser.post('/api/auth/logout').status_code==204
        assert browser.get('/api/study-tools/'+quiz['_id']).status_code==401
        assert browser.post('/api/auth/login',json=library['credentials']).status_code==200
        assert browser.get('/api/study-tools/'+quiz['_id']).json()['artifact']['content']['title']=='My Python foundations practice'
        apply(explanation,'delete');assert browser.get('/api/study-tools/'+explanation['_id']).status_code==404
