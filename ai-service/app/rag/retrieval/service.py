"""Shared RAG boundary beneath the model-visible material tools."""

from app.schemas.context import ExecutionContext
from app.schemas.evidence import EvidenceBundle


async def retrieve_evidence(
    query: str, *, context: ExecutionContext, limit: int = 6
) -> EvidenceBundle:
    """Search authorized sources, revalidate candidates, and return bounded evidence.

    An empty scope must return no evidence, never a library-wide search. Course
    membership and source versions come from Express, including on resumed runs.
    """
    raise NotImplementedError("Authorized evidence retrieval is not implemented.")
