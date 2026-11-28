"""Service-authenticated, bounded advisory assessment and study coaching."""
import asyncio
import json
from fastapi import APIRouter, Depends, Request
from langsmith.run_helpers import tracing_context
from app.api.dependencies import require_service_auth
from app.api.chat import get_chat_models
from app.schemas.learning import AssessmentRequest, CoachingRequest
from app.agents.answer_assessor.agent import run as assess
from app.orchestration.learning_graph import run_learning
from app.core.errors import APIError
router = APIRouter(prefix='/internal/learning', dependencies=[Depends(require_service_auth)])

async def payload(request, schema):
    if request.headers.get('content-type', '').split(';')[0].strip().lower() != 'application/json':
        raise APIError(415, 'unsupported_media_type', 'Send JSON.')
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw)+len(chunk)>128*1024: raise APIError(413, 'request_too_large', 'The learning request is too large.')
        raw.extend(chunk)
    try: return schema.model_validate(json.loads(raw))
    except ValueError: raise APIError(422, 'validation_error', 'Invalid learning request.') from None

async def bounded(request, operation):
    models = get_chat_models(request)
    try: await asyncio.wait_for(request.app.state.chat_capacity.acquire(), timeout=.1)
    except TimeoutError: raise APIError(503, 'learning_busy', 'AI feedback is busy. Try again shortly.') from None
    try:
        with tracing_context(enabled=False):
            async with asyncio.timeout(85): return await operation(models)
    except TimeoutError: raise APIError(503, 'learning_unavailable', 'AI feedback timed out. Your answers are saved.') from None
    finally: request.app.state.chat_capacity.release()

@router.post('/assess')
async def assessment(request: Request):
    body = await payload(request, AssessmentRequest)
    async def operation(models):
        stats = {'input_tokens': 0, 'output_tokens': 0}
        result = await assess(body, models=models, stats=stats)
        return {**result.model_dump(mode='json'), 'model': models.settings.assessment_model, 'usage': stats}
    return await bounded(request, operation)

@router.post('/coach')
async def coaching(request: Request):
    body = await payload(request, CoachingRequest)
    return await bounded(request, lambda models: run_learning(context=body.context, models=models))
