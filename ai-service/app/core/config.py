"""Server-only settings; importing this module never reads credentials."""

from pathlib import Path
import re

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_ENV_FILE = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    """Load the shared root .env at app creation, with environment precedence.

    Ignore other services' keys. Provider credentials are not needed or loaded
    into fields until their adapters exist. Never reuse a provider/session key
    as the internal service credential.
    """

    model_config = SettingsConfigDict(
        env_prefix="AI_",
        env_file=ROOT_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
        hide_input_in_errors=True,
    )

    service_token: SecretStr

    @field_validator("service_token")
    @classmethod
    def validate_service_token(cls, value: SecretStr) -> SecretStr:
        if not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", value.get_secret_value()):
            raise ValueError("Use a dedicated random URL-safe service token of 32–256 characters.")
        return value
