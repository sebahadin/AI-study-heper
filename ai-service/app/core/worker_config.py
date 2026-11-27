"""Server-only worker configuration, independent of public HTTP settings."""
from pydantic import SecretStr, PositiveFloat, PositiveInt, field_validator
from pathlib import Path
from urllib.parse import urlparse
from app.core.retrieval_config import RetrievalSettings, SERVICE_ROOT
from app.core.config import Settings
from app.core.constants import DEFAULT_MAX_PDF_BYTES

class WorkerSettings(RetrievalSettings):
    service_token: SecretStr
    classmate_url: str = 'http://127.0.0.1:3000'
    worker_poll_seconds: PositiveFloat = 2
    worker_heartbeat_seconds: PositiveFloat = 25
    worker_maintenance_seconds: PositiveFloat = 60
    worker_job_timeout_seconds: PositiveFloat = 180
    worker_outbox_path: Path = SERVICE_ROOT / '.cache' / 'worker-outbox.sqlite'
    worker_allow_local_downloads: bool = False
    max_pdf_bytes: PositiveInt = DEFAULT_MAX_PDF_BYTES

    @field_validator('service_token')
    @classmethod
    def token(cls, value):
        return Settings.validate_service_token(value)

    @field_validator('classmate_url')
    @classmethod
    def url(cls, value):
        parsed = urlparse(value)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError('Use a server HTTP URL without credentials, query or fragment.')
        return value.rstrip('/')
