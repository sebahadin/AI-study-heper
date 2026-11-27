"""Private generation endpoint. Models propose; Express confirms and saves."""
import asyncio,json,re
from fastapi import APIRouter,Depends,Request
from fastapi.responses import StreamingResponse
from app.api.dependencies import require_service_auth
from app.api.chat import get_chat_models
from app.api.retrieval import get_retrieval_runtime
from app.core.chat_config import ChatSettings
from app.core.constants import DEFAULT_QUESTION_COUNT
from app.core.errors import APIError
from app.schemas.study import StudyRequest
from app.orchestration.study_graph import stream_study
router=APIRouter(prefix='/internal/study',dependencies=[Depends(require_service_auth)])

@router.get('/config')
async def config():
    settings=ChatSettings()
    return {'enabled':settings.configured,'model':settings.study_model,'defaultCount':DEFAULT_QUESTION_COUNT,'maxCount':10}

@router.post('/stream')
async def generate(request:Request):
    if request.headers.get('content-type','').split(';')[0].strip().lower()!='application/json':raise APIError(415,'unsupported_media_type','Send JSON.')
    raw=bytearray()
    async for chunk in request.stream():
        if len(raw)+len(chunk)>128*1024:raise APIError(413,'request_too_large','The request is too large.')
        raw.extend(chunk)
    try:
        body=StudyRequest.model_validate(json.loads(raw));context=body.context
        identity=context.proposal_id or context.conversation_id
        if (not re.fullmatch(r'[a-fA-F0-9]{24}',context.user_id) or not re.fullmatch(r'[a-fA-F0-9]{24}',identity or '') or bool(context.proposal_id)==bool(context.conversation_id)
            or len(context.scope.sources)>100 or context.scope.selection is None):raise ValueError('Invalid context')
    except ValueError:raise APIError(422,'validation_error','Invalid study request.') from None
    models=get_chat_models(request);runtime=get_retrieval_runtime(request)
    try:await asyncio.wait_for(request.app.state.chat_capacity.acquire(),timeout=.1)
    except TimeoutError:raise APIError(503,'chat_unavailable','Study generation is busy. Try again.') from None
    async def events():
        stream=stream_study(request=body,models=models,retriever=runtime.retriever)
        try:
            async with asyncio.timeout(90):
                async for event in stream:
                    if await request.is_disconnected():break
                    yield 'data: '+json.dumps(event,ensure_ascii=False)+'\n\n'
        except asyncio.CancelledError:raise
        except Exception as error:
            codes={'insufficient_evidence','source_changed','draft_invalid','model_unavailable','chat_context_too_long'}
            yield 'data: '+json.dumps({'type':'error','code':error.code if isinstance(error,APIError) and error.code in codes else 'chat_unavailable'})+'\n\n'
        finally:
            try:await stream.aclose()
            finally:request.app.state.chat_capacity.release()
    return StreamingResponse(events(),media_type='text/event-stream',headers={'Cache-Control':'no-store','X-Accel-Buffering':'no'})
