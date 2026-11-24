"""Executor-side read tools, with model arguments separate from trusted context.

Do not expose these complete Python signatures directly as LLM tool schemas.
The future LangGraph adapter exposes only the Arguments models, then supplies
context after authentication and authorization.
"""

from app.schemas.context import ExecutionContext
from app.schemas.evidence import EvidenceBundle, Passage
from app.schemas.tools import FetchPassagesArguments, SearchMaterialsArguments


async def search_materials(
    arguments: SearchMaterialsArguments, *, context: ExecutionContext
) -> EvidenceBundle:
    """Expose the authorized retrieval workflow to a specialist."""
    raise NotImplementedError("The search_materials tool is not implemented.")


async def fetch_passages(
    arguments: FetchPassagesArguments, *, context: ExecutionContext
) -> tuple[Passage, ...]:
    """Fetch only current passages belonging to this user's permitted scope."""
    raise NotImplementedError("The fetch_passages tool is not implemented.")
