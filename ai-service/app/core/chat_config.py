"""Configurable economical chat models; credentials never enter graph state."""
from typing import Literal
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from app.core.config import ROOT_ENV_FILE


class ChatSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix='AI_', env_file=(ROOT_ENV_FILE.parent/'backend/.env', ROOT_ENV_FILE),
        extra='ignore', frozen=True, hide_input_in_errors=True)
    chat_provider: Literal['openai', 'anthropic'] = 'openai'
    chat_model: str | None = None
    chat_router_model: str | None = None
    study_model_name: str | None = Field(default=None, validation_alias='AI_STUDY_MODEL')
    study_max_output_tokens: int = Field(default=6000, ge=1000, le=8000)
    chat_reasoning_effort: Literal['none', 'low', 'medium'] = 'none'
    chat_max_output_tokens: int = Field(default=1500, ge=128, le=3000)
    chat_max_input_tokens: int = Field(default=8000, ge=2000, le=12000)
    openai_api_key: SecretStr | None = Field(default=None, validation_alias='OPENAI_API_KEY')
    anthropic_api_key: SecretStr | None = Field(default=None, validation_alias='ANTHROPIC_API_KEY')

    @property
    def model(self):
        return self.chat_model or ('gpt-6-luna' if self.chat_provider == 'openai' else 'claude-haiku-4-5-20251001')

    @property
    def study_model(self):
        return self.study_model_name or self.model

    @property
    def router_model(self):
        return self.chat_router_model or self.model

    @property
    def configured(self):
        value = self.openai_api_key if self.chat_provider == 'openai' else self.anthropic_api_key
        return bool(value and value.get_secret_value().strip())
