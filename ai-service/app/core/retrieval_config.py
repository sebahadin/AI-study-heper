"""Local retrieval configuration; importing it starts no model or database."""

from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, StringConstraints
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.config import ROOT_ENV_FILE

SERVICE_ROOT = Path(__file__).resolve().parents[2]


class RetrievalSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AI_", env_file=ROOT_ENV_FILE, extra="ignore", frozen=True,
        hide_input_in_errors=True,
    )

    embedding_model: Annotated[str, StringConstraints(pattern=r"^[\w.-]+/[\w.-]+$")] = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_revision: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{40}$")] = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
    embedding_device: Literal["cpu", "mps", "cuda"] = "cpu"
    embedding_batch_size: Annotated[int, Field(gt=0, le=64)] = 16
    embedding_local_files_only: bool = False
    embedding_cache_path: Path = SERVICE_ROOT / ".cache" / "models"
    chroma_path: Path = SERVICE_ROOT / ".cache" / "chroma"
