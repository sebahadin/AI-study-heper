"""LangGraph retrieval -> specialist -> source verification; writes stay in Express."""
from contextlib import aclosing
import re
import logging
from langgraph.graph import StateGraph, START, END
from langgraph.config import get_stream_writer
from langsmith.run_helpers import tracing_context
from app.agents.summarizer.agent import run as summarize
from app.agents.flashcard_generator.agent import run as cards
from app.agents.quiz_generator.agent import run as quiz
from app.schemas.study import StudyDraft, Coverage
from app.schemas.evidence import EvidenceBundle, Passage
from app.tools.materials import create_material_tools
from app.core.errors import APIError


def reject(reason):
    # Fixed diagnostic codes only: never log prompts, source text or draft values.
    logging.getLogger(__name__).warning('study_draft_rejected:%s',reason)
    raise APIError(503,'draft_invalid','The generated draft could not be verified.')

def numbered(text):
    plain=re.sub(r'```[\s\S]*?(?:```|$)|`[^`]*`','',text)
    return set(int(n) for n in re.findall(r'\[(\d{1,4})\]',plain))

async def stream_study(*, request, models, retriever):
    context=request.context
    async def retrieve(state):
        writer=get_stream_writer();writer({'type':'status','phase':'searching'})
        current=await retriever._current_context(context)
        if not current.scope.sources: raise APIError(422,'insufficient_evidence','Choose ready indexed materials before generating a draft.')
        tools={t.name:t for t in create_material_tools(retriever=retriever,context=context,include_overview=True)}
        overview=await tools['read_material_overview'].ainvoke({},config={'callbacks':[]})
        passages=tuple(Passage.model_validate(p) for p in overview['passages'])
        if request.instruction.strip() or request.topic.strip():
            found=await tools['search_materials'].ainvoke({'query':(request.topic+' '+request.instruction).strip()[:2000],'limit':6},config={'callbacks':[]})
            selected=EvidenceBundle.model_validate(found).passages
        else:selected=()
        result={};chars=0
        for p in (*selected,*passages):
            if p.citation.chunk_id not in result and len(result)<12 and chars+len(p.text)<=12000:
                result[p.citation.chunk_id]=p;chars+=len(p.text)
        evidence=tuple(result.values())
        if not evidence:raise APIError(422,'insufficient_evidence','No supporting passages are available in this scope.')
        return {'evidence':evidence,'total':len(current.scope.sources)}
    async def generate(state):
        get_stream_writer()({'type':'status','phase':'drafting'})
        function=cards if request.kind=='flashcards' else quiz if request.kind=='quiz' else summarize
        output=await function(request,models=models,evidence=state['evidence'],stats=state['stats'])
        raw=output.model_dump(mode='json')
        if not raw.pop('supported'):raise APIError(422,'insufficient_evidence','The selected excerpts do not support this request. Choose different materials or narrow the task.')
        raw.pop('limitation')
        if request.kind=='flashcards' and len(raw['cards'])!=request.count or request.kind=='quiz' and len(raw['questions'])!=request.count:
            reject('count_mismatch')
        if request.kind=='quiz' and request.format!='auto' and any(q['kind']!=request.format for q in raw['questions']):
            reject('format_mismatch')
        evidence=state['evidence'];allowed=set(range(1,len(evidence)+1))
        used=numbered(raw['body']) if request.kind in ('summary','explanation') else set(n for item in raw.get('cards',raw.get('questions',[])) for n in item['citationNumbers'])
        if not used or not used<=allowed:reject('source_numbers')
        # Cards/questions use explicit citationNumbers. Numeric brackets in their
        # text may be list indices or test inputs, not citation markers.
        for item in raw.get('cards',raw.get('questions',[])):
            if not set(item['citationNumbers']) or not set(item['citationNumbers'])<=allowed:reject('item_source_numbers')
        citations=[dict(evidence[n-1].citation.model_dump(mode='json'),number=n) for n in sorted(used)]
        draft=StudyDraft(kind=request.kind,**raw,citations=citations,coverage=Coverage(passages=len(evidence),coveredSources=len({p.citation.source for p in evidence}),totalSources=state['total']))
        return {'draft':draft}
    async def verify(state):
        get_stream_writer()({'type':'status','phase':'checking'})
        evidence=state['evidence'];fresh=await retriever.fetch([p.citation.chunk_id for p in evidence],context=context)
        approved={p.citation for p in fresh}
        if any(p.citation not in approved for p in evidence):raise APIError(409,'source_changed','The source materials changed. Generate a new draft.')
        get_stream_writer()({'type':'final','draft':state['draft'].model_dump(mode='json'),'model':models.settings.study_model,'usage':state['stats']})
        return {}
    from typing import TypedDict
    class State(TypedDict,total=False):
        evidence:tuple
        total:int
        stats:dict
        draft:object
    graph=StateGraph(State)
    graph.add_node('retrieve',retrieve);graph.add_node('specialist',generate);graph.add_node('verify',verify)
    graph.add_edge(START,'retrieve');graph.add_edge('retrieve','specialist');graph.add_edge('specialist','verify');graph.add_edge('verify',END)
    with tracing_context(enabled=False):
        async with aclosing(graph.compile().astream({'stats':{'input_tokens':0,'output_tokens':0}},stream_mode='custom',config={'callbacks':[],'recursion_limit':6})) as stream:
            async for event in stream:yield event
