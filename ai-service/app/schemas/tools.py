"""Only these arguments are model-visible; the executor supplies trusted context."""

from typing import Annotated
from pydantic import Field, StringConstraints

from app.schemas.base import Contract, PositiveCount, Text


class SearchMaterialsArguments(Contract):
    query: Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=2000)]
    limit: PositiveCount = Field(default=6, le=12)


class FetchPassagesArguments(Contract):
    chunk_ids: tuple[Annotated[Text, Field(max_length=100)], ...] = Field(min_length=1, max_length=100)
