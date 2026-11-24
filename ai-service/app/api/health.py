"""Process health only: neither route claims an AI integration is ready."""

from fastapi import APIRouter, Depends

from app.api.dependencies import require_service_auth
from app.schemas.http import HealthResponse

router = APIRouter()
internal_router = APIRouter(prefix="/internal", dependencies=[Depends(require_service_auth)])


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse()


@internal_router.get("/health", response_model=HealthResponse)
async def internal_health() -> HealthResponse:
    return HealthResponse()
