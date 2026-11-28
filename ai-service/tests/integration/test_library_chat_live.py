"""Opt-in billed routing regression with synthetic materials and disposable services.
RUN_LIBRARY_LIVE_TEST=1 uv run --locked pytest tests/integration/test_library_chat_live.py
"""
import json, os
from uuid import uuid4
import httpx
import pytest
from test_worker_live import stack
from test_study_tools_live import prepare_library
pytestmark=pytest.mark.skipif(os.getenv('RUN_LIBRARY_LIVE_TEST')!='1',reason='Opt-in real-provider test')

def prepare_catalog(browser):
    library=prepare_library(browser)
    course=browser.post('/api/courses',json={'title':'Biology','code':'BIO101'}).json()['course']
    book=browser.post('/api/books',json={'title':'Biology basics','author':'Synthetic teacher','category':'Science','description':'An introduction to cells.','courses':[course['_id']]}).json()['book']
    note=browser.post('/api/notes',json={'title':'Cell energy notes','content':'Mitochondria supply ATP to cells.','book':book['_id']}).json()['note']
    browser.post('/api/flashcards',json={'question':'Which organelle supplies ATP?','options':['Mitochondria','Nucleus'],'correctIndex':0,'tags':[book['_id']]})
    for i in range(12):
        assert browser.post('/api/books',json={'title':f'Practice reference {i+1:02d}','author':'Synthetic teacher','category':'Reference'}).status_code==201
    conversation=browser.post('/api/chat',json={'selection':{'library':True}}).json()['conversation']
    return {**library,'biologyCourse':course['_id'],'biologyBook':book['_id'],'biologyNote':note['_id'],'conversation':conversation['_id']}

def send(browser,conversation,message):
    with browser.stream('POST',f'/api/chat/{conversation}/messages',json={'content':message,'requestId':str(uuid4())}) as response:
        assert response.status_code==200
        events=[json.loads(line[6:]) for line in response.iter_lines() if line.startswith('data: ')]
    errors=[e for e in events if e['type']=='error'];assert not errors,errors
    return next(e['message'] for e in events if e['type']=='done')

def exercise_catalog(browser,library):
    conversation=library['conversation'];results=[]
    def ask(text,mode):
        reply=send(browser,conversation,text);assert reply['mode']==mode,{'question':text,'mode':reply['mode']};results.append({'question':text,'mode':reply['mode']});return reply
    assert 'Classmate' in ask('hi','assistant')['content']
    books=ask('list all my books','library');assert books['library']['kind']=='books' and books['library']['total']==14 and books['library']['next_cursor'];assert 'Biology basics' in books['content'];assert 'quiz attempt' not in books['content'].lower()
    next_page=ask('show the next page of my books','library');assert len(next_page['library']['items'])==4 and not next_page['library']['next_cursor']
    expected=next_page['library']['items'][0]['id'];opened=ask('Open the first of those books','library');assert opened['library']['operation']=='get_library_item' and opened['library']['items'][0]['id']==expected, {'operation':opened['library']['operation'],'items':opened['library']['items'],'expected':expected}
    pdfs=ask('what pdf documents do i have','library');assert pdfs['library']['kind']=='documents' and pdfs['library']['total']==1 and 'ordered-sequences.pdf' in pdfs['content']
    biology=ask('do i have a biology course','library');assert biology['library']['kind']=='courses' and biology['library']['total']==1 and biology['library']['items'][0]['id']==library['biologyCourse']
    absent=ask('Do I have a chemistry course?','library');assert absent['library']['total']==0
    notes=ask('List my notes in the Biology course','library');assert notes['library']['kind']=='notes' and notes['library']['total']==1 and notes['library']['items'][0]['id']==library['biologyNote']
    linked=ask('What study materials are linked to my Biology course?','library');assert linked['library']['operation']=='explore_connections' and 'Cell energy notes' in linked['content']
    read=ask('Read my Cell energy notes','library');assert read['library']['operation']=='get_library_item' and 'Mitochondria supply ATP' in read['content']
    overview=ask('Give me an overview of everything in my library','library');assert overview['library']['operation']=='get_library_overview' and 'PDF documents' in overview['content']
    identity=ask('Who are you and who built you?','assistant');assert 'built by Classmate' in identity['content']
    grounded=ask('In my Python notes, what starting value does an addition accumulator use, and why?','grounded');assert grounded['citations']
    draft=ask('Generate exactly three flashcard drafts about Python list accumulators from my materials.','draft');assert draft['proposalId']
    return results

def test_real_model_catalog_routing_and_followups(stack):
    with httpx.Client(base_url=stack['url'],timeout=110) as browser:
        library=prepare_catalog(browser);exercise_catalog(browser,library)
