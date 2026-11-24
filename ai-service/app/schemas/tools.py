"""Only these arguments are model-visible; the executor supplies trusted context."""

from pydantic import Field

from app.schemas.base import Contract, PositiveCount, Text


class SearchMaterialsArguments(Contract):
    query: Text
    limit: PositiveCount = 6


class FetchPassagesArguments(Contract):
    chunk_ids: tuple[Text, ...] = Field(min_length=1)
