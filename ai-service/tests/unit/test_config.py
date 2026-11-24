"""Settings tests use temporary files and never load the user's actual .env."""

from pathlib import Path

from pydantic import ValidationError
import pytest

from app.core.config import ROOT_ENV_FILE, Settings
from app.main import create_app

FILE_TOKEN = "test-file-token-" + "x" * 32
ENV_TOKEN = "test-environment-token-" + "y" * 32


@pytest.fixture(autouse=True)
def isolate_service_environment(monkeypatch):
    monkeypatch.delenv("AI_SERVICE_TOKEN", raising=False)


def test_default_dotenv_path_is_anchored_to_repository_not_working_directory():
    assert ROOT_ENV_FILE == Path(__file__).resolve().parents[3] / ".env"
    assert Settings.model_config["env_file"] == ROOT_ENV_FILE


def test_only_service_settings_are_loaded_from_a_shared_dotenv(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        f"AI_SERVICE_TOKEN={FILE_TOKEN}\nOPENAI_API_KEY=test-private-key\nOTHER_APP_KEY=test-other-key\n"
    )
    settings = Settings(_env_file=env_file)
    assert settings.service_token.get_secret_value() == FILE_TOKEN
    assert set(type(settings).model_fields) == {"service_token"}
    assert "test-private-key" not in repr(settings)


def test_environment_overrides_the_shared_dotenv(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text(f"AI_SERVICE_TOKEN={FILE_TOKEN}\n")
    monkeypatch.setenv("AI_SERVICE_TOKEN", ENV_TOKEN)
    assert Settings(_env_file=env_file).service_token.get_secret_value() == ENV_TOKEN


def test_missing_token_fails_closed():
    with pytest.raises(ValidationError, match="service_token"):
        Settings(_env_file=None)


@pytest.mark.parametrize("value", ["", "short", "x" * 257, "spaces " * 10, "é" * 32, "x" * 32 + "\n"])
def test_invalid_tokens_fail_without_exposing_their_value(value):
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, service_token=value)
    assert "input_value=" not in str(error.value)
    assert "input_type=" not in str(error.value)


def test_secret_values_are_redacted_in_representations_and_json():
    settings = Settings(_env_file=None, service_token=FILE_TOKEN)
    assert FILE_TOKEN not in repr(settings)
    assert FILE_TOKEN not in settings.model_dump_json()


def test_create_app_fails_closed_when_settings_are_missing(monkeypatch):
    monkeypatch.setattr("app.main.Settings", lambda: Settings(_env_file=None))
    with pytest.raises(ValidationError):
        create_app()


def test_factories_keep_credentials_isolated_between_instances():
    first = create_app(Settings(_env_file=None, service_token=FILE_TOKEN))
    second = create_app(Settings(_env_file=None, service_token=ENV_TOKEN))
    assert first.state.settings.service_token.get_secret_value() == FILE_TOKEN
    assert second.state.settings.service_token.get_secret_value() == ENV_TOKEN
