"""Service-authenticated streaming study chat. Express owns all history writes."""
import asyncio
import json
import re
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from app.api.dependencies import require_service_auth
from app.api.retrieval import get_retrieval_runtime
from app.core.chat_config import ChatSettings
from app.core.errors import APIError
from app.providers.chat_models import ChatModels
from app.orchestration.chat_graph import stream_chat
from app.schemas.chat import ChatRequest

router = APIRouter(prefix='/internal/chat', dependencies=[Depends(require_service_auth)])


def get_chat_models(request):
    if not hasattr(request.app.state, 'chat_models'):
        request.app.state.chat_models = ChatModels(ChatSettings())
        request.app.state.chat_capacity = asyncio.Semaphore(2)
    return request.app.state.chat_models


@router.get('/config')
async def config():
    settings = ChatSettings()
    return {'enabled':settings.configured, 'provider':settings.chat_provider, 'model':settings.model}


@router.post('/stream')
async def stream(request: Request):
    if request.headers.get('content-type','').split(';')[0].strip().lower() != 'application/json':
        raise APIError(415,'unsupported_media_type','Send chat requests as JSON.')
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw)+len(chunk) > 256*1024: raise APIError(413,'request_too_large','The chat request is too large.')
        raw.extend(chunk)
    try:
        body = ChatRequest.model_validate(json.loads(raw))
        if (not re.fullmatch(r'[a-fA-F0-9]{24}', body.context.user_id) or not re.fullmatch(r'[a-fA-F0-9]{24}', body.context.conversation_id or '')
                or len(body.context.scope.sources)>100 or body.context.scope.selection is None or len(body.context.run_id)>128): raise ValueError('Invalid context')
    except ValueError: raise APIError(422,'validation_error','Request validation failed.') from None
    models = get_chat_models(request)
    runtime = get_retrieval_runtime(request)
    try: await asyncio.wait_for(request.app.state.chat_capacity.acquire(), timeout=.1)
    except TimeoutError: raise APIError(503,'chat_unavailable','The assistant is busy. Please try again.') from None

    async def events():
        workflow = stream_chat(request=body, models=models, retriever=runtime.retriever)
        try:
            async with asyncio.timeout(90):
                async for event in workflow:
                    if await request.is_disconnected(): break
                    yield 'data: '+json.dumps(event, ensure_ascii=False)+'\n\n'
        except asyncio.CancelledError: raise
        except Exception as error:
            code = error.code if isinstance(error,APIError) and error.code in ('model_unavailable','response_invalid','chat_context_too_long','draft_invalid','source_changed','scope_too_large','scope_changed') else 'chat_unavailable'
            if code == 'scope_changed': code = 'source_changed'
            yield 'data: '+json.dumps({'type':'error','code':code})+'\n\n'
        finally:
            try: await workflow.aclose()
            finally: request.app.state.chat_capacity.release()
    return StreamingResponse(events(), media_type='text/event-stream', headers={'Cache-Control':'no-store','X-Accel-Buffering':'no'})
