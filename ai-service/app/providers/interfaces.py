"""Provider-neutral interfaces; provider implementations arrive in later slices."""

from collections.abc import Sequence
from typing import Protocol, TypeVar

from pydantic import BaseModel

Response = TypeVar("Response", bound=BaseModel)


class StructuredModel(Protocol):
    async def generate(
        self, *, instructions: str, input_text: str, response_model: type[Response]
    ) -> Response:
        """Generate validated content. Never request trusted identity as model output."""
        ...


class EmbeddingModel(Protocol):
    async def embed(self, texts: Sequence[str]) -> tuple[tuple[float, ...], ...]:
        """Use the same versioned local Hugging Face model for indexing and queries."""
        ...
