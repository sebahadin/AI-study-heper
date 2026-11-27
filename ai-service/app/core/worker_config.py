"""Server-only worker configuration, independent of public HTTP settings."""
from pathlib import Path
from pydantic import PositiveFloat, PositiveInt
from app.core.application_config import ApplicationSettings
from app.core.retrieval_config import SERVICE_ROOT
from app.core.constants import DEFAULT_MAX_PDF_BYTES


class WorkerSettings(ApplicationSettings):
    worker_poll_seconds: PositiveFloat = 2
    worker_heartbeat_seconds: PositiveFloat = 25
    worker_maintenance_seconds: PositiveFloat = 60
    worker_job_timeout_seconds: PositiveFloat = 180
    worker_outbox_path: Path = SERVICE_ROOT / '.cache' / 'worker-outbox.sqlite'
    worker_allow_local_downloads: bool = False
    max_pdf_bytes: PositiveInt = DEFAULT_MAX_PDF_BYTES
