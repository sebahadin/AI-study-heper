"""Authenticated retrieval profile; loading a profile never loads model weights."""
from hashlib import sha256
from fastapi import APIRouter, Depends
from app.api.dependencies import require_service_auth
from app.core.retrieval_config import RetrievalSettings
from app.providers.local_embeddings import LocalHuggingFaceEmbeddings
from app.integrations.chroma_client import INDEX_SCHEMA_VERSION

router = APIRouter(prefix="/internal/retrieval", dependencies=[Depends(require_service_auth)])

@router.get('/profile')
async def profile():
    model = LocalHuggingFaceEmbeddings(RetrievalSettings())
    return {"embedding_model": model.model_id, "index_version": INDEX_SCHEMA_VERSION + '-' + sha256(model.model_id.encode()).hexdigest()[:24]}
