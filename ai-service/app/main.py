"""Run with uvicorn app.main:create_app --factory; no integrations start on import."""

from contextlib import asynccontextmanager
from fastapi import FastAPI

from app.api.learning import router as learning_router
from app.api.study import router as study_router
from app.api.chat import router as chat_router
from app.api.documents import router as documents_router
from app.api.retrieval import router as retrieval_router
from app.api.health import internal_router, router
from app.core.config import Settings
from app.core.errors import install_error_handlers
from app.core.request_ids import RequestIdMiddleware
from app.rag.ingestion.pdf_validation import configure_pdf_logging


@asynccontextmanager
async def lifecycle(app):
    try:
        yield
    finally:
        runtime = getattr(app.state, 'retrieval_runtime', None)
        if runtime is not None:
            await runtime.close()
        models = getattr(app.state, 'chat_models', None)
        if models is not None:
            await models.close()


def create_app(settings: Settings | None = None) -> FastAPI:
    # A missing/invalid token aborts startup; there is no insecure default.
    settings = settings if settings is not None else Settings()
    configure_pdf_logging()
    app = FastAPI(lifespan=lifecycle, title="Classmate AI internal API", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    app.add_middleware(RequestIdMiddleware)
    install_error_handlers(app)
    app.include_router(router)
    app.include_router(internal_router)
    app.include_router(documents_router)
    app.include_router(retrieval_router)
    app.include_router(chat_router)
    app.include_router(study_router)
    app.include_router(learning_router)
    return app
