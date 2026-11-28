"""Actual LangGraph supervisor/read-tool/tutor workflow; context is executor-owned."""
from typing import TypedDict
from contextlib import aclosing
from langgraph.graph import StateGraph, START, END
from langgraph.config import get_stream_writer
from langsmith.run_helpers import tracing_context
from pydantic import ValidationError
from app.agents.orchestrator.agent import plan_tasks, compose_response
from app.agents.tutor.agent import run as run_tutor
from app.core.errors import APIError
from app.schemas.evidence import EvidenceBundle
from app.tools.materials import create_material_tools


class ChatState(TypedDict, total=False):
    plan: object
    evidence: tuple
    steps: int
    answer: str
    mode: str
    stats: dict


def build_chat_graph(*, request, models, retriever):
    tools = {tool.name: tool for tool in create_material_tools(retriever=retriever, context=request.context)}

    async def history_current(refresh=False):
        if not refresh: return request.history
        current = await retriever._current_context(request.context)
        allowed = set(current.scope.sources)
        result = []
        for message in request.history:
            if message.role == 'assistant' and any(c.source not in allowed for c in message.citations):
                result.append(message.model_copy(update={'content': '[Earlier source-based content is unavailable in the current scope.]', 'citations': ()}))
            else: result.append(message)
        return tuple(result)

    async def supervisor(state):
        get_stream_writer()({'type':'status', 'phase':'planning'})
        plan = await plan_tasks(request, models=models, history=await history_current(), evidence=state['evidence'], steps=state['steps'], stats=state['stats'])
        return {'plan': plan}

    def next_node(state):
        if state['plan'].action in ('list_library_items', 'get_library_item', 'explore_connections', 'get_library_overview'): return 'library_tool'
        if state['plan'].action == 'respond': return 'assistant_reply'
        if state['plan'].action in ('review_performance', 'recommend_materials'): return 'learning_tool'
        if state['plan'].action in ('summarize','explain','generate_flashcards','generate_quiz'): return 'study_tool'
        if state['plan'].action in ('search_materials', 'fetch_passages') and state['steps'] < 2: return 'read_tools'
        return 'tutor'

    async def read_tools(state):
        plan = state['plan']; get_stream_writer()({'type':'status', 'phase':'searching' if plan.action=='search_materials' else 'reading'})
        empty_scope = False
        try:
            current = await retriever._current_context(request.context)
            empty_scope = not current.scope.sources
            if empty_scope:
                passages = ()
            elif plan.action == 'search_materials':
                result = await tools['search_materials'].ainvoke({'query':plan.query, 'limit':6}, config={'callbacks':[]})
                passages = EvidenceBundle.model_validate(result).passages
            else:
                from app.schemas.evidence import Passage
                result = await tools['fetch_passages'].ainvoke({'chunk_ids':plan.chunk_ids}, config={'callbacks':[]})
                passages = tuple(Passage.model_validate(row) for row in result)
        except (ValidationError, APIError) as error:
            if isinstance(error, APIError) and (error.status_code >= 500 or error.code in ('scope_too_large', 'scope_changed')): raise
            passages = ()
        found = {p.citation.chunk_id: p for p in (*state['evidence'], *passages)}
        evidence, characters = [], 0
        for passage in found.values():
            if len(evidence) < 12 and characters + len(passage.text) <= 12000:
                evidence.append(passage); characters += len(passage.text)
        return {'evidence':tuple(evidence), 'steps':2 if empty_scope else state['steps']+1}

    async def library_tool(state):
        from app.tools.library import create_library_tools
        from app.schemas.library import LibraryResult
        plan = state['plan']; writer = get_stream_writer(); writer({'type': 'status', 'phase': 'reading'})
        library_tools = {tool.name: tool for tool in create_library_tools(classmate=retriever.classmate, context=request.context)}
        arguments = plan.library.model_dump(mode='json')
        result = LibraryResult.model_validate(await library_tools[plan.action].ainvoke(arguments, config={'callbacks': []}))
        # Express re-executes the authorized query and renders canonical current data.
        # Neither model prose nor a forged tool-result title can become a library fact.
        writer({'type': 'final', 'mode': 'library', 'answer': 'Library results are ready.', 'citations': [],
            'library_request': {'operation': plan.action, 'arguments': arguments}, 'model': models.settings.router_model if hasattr(models.settings, 'router_model') else models.settings.model, 'usage': state['stats']})
        return {}

    async def assistant_reply(state):
        from app.core.persona import ASSISTANT_REPLIES
        writer = get_stream_writer()
        writer({'type': 'final', 'mode': 'assistant', 'answer': ASSISTANT_REPLIES[state['plan'].response_kind], 'citations': [], 'model': models.settings.model, 'usage': state['stats']})
        return {}

    async def study_tool(state):
        from app.schemas.study import StudyRequest
        from app.orchestration.study_graph import stream_study
        plan=state['plan'];kind={'summarize':'summary','explain':'explanation','generate_flashcards':'flashcards','generate_quiz':'quiz'}[plan.action]
        writer=get_stream_writer()
        study=StudyRequest(kind=kind,instruction=request.message+(('\nResolved study focus: '+plan.query) if plan.query else ''),topic=request.topic,count=plan.count,format=plan.format,context=request.context)
        try:
            async with aclosing(stream_study(request=study,models=models,retriever=retriever)) as stream:
                async for event in stream:
                    if event['type']=='status':writer({'type':'status','phase':'searching' if event['phase']=='searching' else 'checking' if event['phase']=='checking' else 'writing'})
                    elif event['type']=='final':
                        writer({'type':'final','answer':'Your study draft is ready to review. Nothing has been saved to your library.', 'mode':'draft','citations':[], 'draft':event['draft'],'model':event['model'],'usage':{key:state['stats'].get(key,0)+event['usage'].get(key,0) for key in ('input_tokens','output_tokens')}})
        except APIError as error:
            if error.code!='insufficient_evidence':raise
            writer({'type':'final','answer':'The selected excerpts do not support that draft. Choose other indexed materials or narrow the task.','mode':'insufficient_evidence','citations':[],'model':models.settings.model,'usage':state['stats']})
        return {}

    async def learning_tool(state):
        from app.orchestration.learning_graph import run_learning
        writer = get_stream_writer(); writer({'type': 'status', 'phase': 'reading'})
        context = await retriever.classmate.fetch_learning_context(context=request.context)
        result = await run_learning(context=context, models=models, goal=request.message)
        writer({'type': 'final', 'mode': 'coaching', 'coaching': result, 'answer': 'Your study suggestions are ready.', 'citations': [], 'model': result['model'], 'usage': {key: state['stats'].get(key, 0)+result['usage'].get(key, 0) for key in ('input_tokens', 'output_tokens')}})
        return {}

    async def tutor(state):
        writer = get_stream_writer(); plan = state['plan']
        if plan.action == 'clarify':
            answer = plan.clarification or 'Which concept or study material would you like me to explain?'
            mode = 'clarification'; writer({'type':'mode','mode':mode}); writer({'type':'delta','text':answer})
        elif plan.action == 'unsupported':
            answer = 'I can discuss and explain your materials here. Direct library changes are not available in chat. I can prepare study drafts; open a draft to review and confirm a save, update or deletion.'
            mode = 'clarification'; writer({'type':'mode','mode':mode}); writer({'type':'delta','text':answer})
        else:
            writer({'type':'status','phase':'writing'})
            evidence = await retriever.fetch([p.citation.chunk_id for p in state['evidence']], context=request.context) if state['evidence'] else ()
            answer, mode = await run_tutor(request, models=models, history=await history_current(refresh=True), evidence=evidence, stats=state['stats'], emit=writer)
            return {'answer':answer, 'mode':mode, 'evidence':evidence}
        return {'answer':answer, 'mode':mode}

    async def verify(state):
        writer = get_stream_writer(); writer({'type':'status','phase':'checking'})
        evidence = state['evidence']
        if evidence:
            fresh = await retriever.fetch([p.citation.chunk_id for p in evidence], context=request.context)
            by_id = {p.citation.chunk_id:p for p in fresh}
            if any(p.citation.chunk_id not in by_id or by_id[p.citation.chunk_id].citation != p.citation for p in evidence):
                writer({'type':'final', 'answer':'Your study materials changed while I was answering. Please ask again to use the latest version.',
                    'mode':'insufficient_evidence','citations':[], 'model':models.settings.model,'usage':state['stats']})
                return {}
        result = compose_response(state['answer'], state['mode'], evidence, request.allow_general)
        writer({'type':'final', **result, 'model':models.settings.model, 'usage':state['stats']})
        return {}

    graph = StateGraph(ChatState)
    graph.add_node('library_tool',library_tool); graph.add_edge('library_tool',END); graph.add_node('assistant_reply',assistant_reply); graph.add_edge('assistant_reply',END); graph.add_node('learning_tool',learning_tool); graph.add_edge('learning_tool',END); graph.add_node('study_tool',study_tool); graph.add_node('supervisor', supervisor); graph.add_node('read_tools', read_tools); graph.add_node('tutor', tutor); graph.add_node('verify', verify)
    graph.add_edge(START, 'supervisor'); graph.add_conditional_edges('supervisor', next_node)
    graph.add_edge('study_tool',END); graph.add_edge('read_tools','supervisor'); graph.add_edge('tutor','verify'); graph.add_edge('verify',END)
    return graph.compile()


async def stream_chat(*, request, models, retriever):
    graph = build_chat_graph(request=request, models=models, retriever=retriever)
    # Never export private prompts/passages to LangSmith, even if globally enabled.
    with tracing_context(enabled=False):
        async with aclosing(graph.astream({'evidence':(), 'steps':0, 'stats':{'input_tokens':0,'output_tokens':0}},
            stream_mode='custom', config={'recursion_limit':12,'callbacks':[]})) as stream:
            async for event in stream:
                yield event
