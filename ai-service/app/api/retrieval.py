"""Authenticated, bounded retrieval API; model weights load on the first search."""
import asyncio
from hashlib import sha256
import json
import re
from typing import Self
from fastapi import APIRouter, Depends, Request
from pydantic import ValidationError, model_validator
from app.api.dependencies import require_service_auth
from app.core.application_config import ApplicationSettings
from app.core.errors import APIError
from app.core.retrieval_config import RetrievalSettings
from app.integrations.classmate_client import ClassmateClient
from app.providers.local_embeddings import LocalHuggingFaceEmbeddings
from app.integrations.chroma_client import ChromaIndex, INDEX_SCHEMA_VERSION
from app.rag.retrieval.service import EvidenceRetriever
from app.schemas.context import ExecutionContext
from app.schemas.evidence import EvidenceBundle
from app.schemas.tools import SearchMaterialsArguments

router = APIRouter(prefix='/internal/retrieval', dependencies=[Depends(require_service_auth)])
MAX_REQUEST_BYTES = 128 * 1024


class RetrievalSearchRequest(SearchMaterialsArguments):
    context: ExecutionContext

    @model_validator(mode='after')
    def bounded_context(self) -> Self:
        if (not re.fullmatch(r'[a-fA-F0-9]{24}', self.context.user_id)
                or len(self.context.run_id) > 128 or len(self.context.scope.scope_id) > 128
                or len(self.context.scope.sources) > 100
                or any(not re.fullmatch(r'[a-fA-F0-9]{24}', ref.source_id) or not ref.index_generation
                       or len(ref.source_version) > 200 or len(ref.index_generation) > 200 for ref in self.context.scope.sources)):
            raise ValueError('Use a bounded Express-resolved source context.')
        return self


class RetrievalRuntime:
    def __init__(self, settings):
        self.embeddings = LocalHuggingFaceEmbeddings(settings)
        self.classmate = ClassmateClient(settings)
        self.settings, self.index = settings, None
        self.capacity = asyncio.Semaphore(2)
        self.retriever = EvidenceRetriever(embeddings=self.embeddings, index=self.index_for, classmate=self.classmate)

    def index_for(self, vector):
        if self.index is None:
            self.index = ChromaIndex.shared(self.settings, self.embeddings.model_id, len(vector))
        return self.index

    async def close(self):
        await self.classmate.close()


def get_retrieval_runtime(request: Request):
    if not hasattr(request.app.state, 'retrieval_runtime'):
        settings = ApplicationSettings(service_token=request.app.state.settings.service_token)
        request.app.state.retrieval_runtime = RetrievalRuntime(settings)
    return request.app.state.retrieval_runtime


@router.get('/profile')
async def profile():
    model = LocalHuggingFaceEmbeddings(RetrievalSettings())
    return {'embedding_model': model.model_id, 'index_version': INDEX_SCHEMA_VERSION + '-' + sha256(model.model_id.encode()).hexdigest()[:24]}


@router.post('/search', response_model=EvidenceBundle)
async def search(request: Request):
    # No FastAPI Body parameter: service authentication runs before JSON parsing.
    if request.headers.get('content-type', '').split(';')[0].strip().lower() != 'application/json':
        raise APIError(415, 'unsupported_media_type', 'Send retrieval requests as JSON.')
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_REQUEST_BYTES:
            raise APIError(413, 'request_too_large', 'The retrieval request is too large.')
        body.extend(chunk)
    try:
        payload = RetrievalSearchRequest.model_validate(json.loads(body))
    except (ValueError, ValidationError):
        raise APIError(422, 'validation_error', 'Request validation failed.') from None
    runtime = get_retrieval_runtime(request)
    try:
        await asyncio.wait_for(runtime.capacity.acquire(), timeout=.1)
    except TimeoutError:
        raise APIError(503, 'retrieval_busy', 'Study search is busy. Please try again.') from None
    try:
        async with asyncio.timeout(30):
            return await runtime.retriever.retrieve(payload.query, context=payload.context, limit=payload.limit)
    except TimeoutError:
        raise APIError(503, 'retrieval_unavailable', 'Study search is temporarily unavailable.') from None
    finally:
        runtime.capacity.release()
