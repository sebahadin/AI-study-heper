"""Bounded LangGraph performance -> coaching -> local recommendation -> validation."""
from langgraph.graph import StateGraph, START, END
from langsmith.run_helpers import tracing_context
from app.agents.study_coach.agent import run as coach
from app.agents.material_recommender.agent import run as recommend
from app.tools.learning import create_learning_tools
from app.schemas.learning import LearningContext
from app.core.errors import APIError

async def run_learning(*, context: LearningContext, models, goal='Help me plan my next study session.'):
    tools = {t.name: t for t in create_learning_tools(context=context)}
    async def read(state):
        performance = await tools['read_quiz_performance'].ainvoke({}, config={'callbacks': []})
        catalog = await tools['find_library_materials'].ainvoke({'query': goal[:160]}, config={'callbacks': []})
        return {'context': LearningContext(**performance, resources=catalog['resources'])}
    async def coaching(state):
        return {'coaching': await coach(state['context'], models=models, stats=state['stats'], goal=goal)}
    async def recommending(state):
        return {'recommendations': await recommend(state['context'], models=models, stats=state['stats'], goal=goal)}
    async def verify(state):
        result = {**state['coaching'].model_dump(mode='json'), **state['recommendations'].model_dump(mode='json')}
        attempts = {a['id'] for a in context.attempts}; resources = {r.id for r in context.resources}
        if any(i not in attempts for f in result['focusAreas'] for i in f['attemptIds']) or any(r['resourceId'] not in resources for r in result['recommendations']) or len({r['resourceId'] for r in result['recommendations']}) != len(result['recommendations']) or any(len(s)>500 for s in result['nextSteps']):
            raise APIError(503, 'coaching_invalid', 'The study suggestions could not be verified.')
        return {'result': result}
    from typing_extensions import TypedDict
    class State(TypedDict, total=False):
        context: object
        stats: dict
        coaching: object
        recommendations: object
        result: dict
    graph = StateGraph(State)
    for name, function in [('read', read), ('coach', coaching), ('recommend', recommending), ('verify', verify)]: graph.add_node(name, function)
    graph.add_edge(START, 'read'); graph.add_edge('read', 'coach'); graph.add_edge('coach', 'recommend'); graph.add_edge('recommend', 'verify'); graph.add_edge('verify', END)
    with tracing_context(enabled=False):
        output = await graph.compile().ainvoke({'stats': {'input_tokens': 0, 'output_tokens': 0}}, config={'callbacks': [], 'recursion_limit': 8})
    return {**output['result'], 'model': models.settings.coaching_model, 'usage': output['stats']}
