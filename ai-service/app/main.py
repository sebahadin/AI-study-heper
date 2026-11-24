"""Run with uvicorn app.main:create_app --factory; no integrations start on import."""

from fastapi import FastAPI

from app.api.health import internal_router, router
from app.core.config import Settings
from app.core.errors import install_error_handlers
from app.core.request_ids import RequestIdMiddleware


def create_app(settings: Settings | None = None) -> FastAPI:
    # A missing/invalid token aborts startup; there is no insecure default.
    settings = settings if settings is not None else Settings()
    app = FastAPI(title="Classmate AI internal API", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    app.add_middleware(RequestIdMiddleware)
    install_error_handlers(app)
    app.include_router(router)
    app.include_router(internal_router)
    return app
