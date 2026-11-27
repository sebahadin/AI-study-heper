"""Server-only connection to Express, shared by read tools and indexing workers."""
from urllib.parse import urlparse
from pydantic import SecretStr, field_validator
from app.core.config import Settings
from app.core.retrieval_config import RetrievalSettings


class ApplicationSettings(RetrievalSettings):
    service_token: SecretStr
    classmate_url: str = 'http://127.0.0.1:3000'

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
