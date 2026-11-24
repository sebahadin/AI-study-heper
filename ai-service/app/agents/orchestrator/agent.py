"""Supervisor entry points; delegation is bounded by the future LangGraph workflow."""

from collections.abc import Sequence

from app.schemas.context import ExecutionContext
from app.schemas.tasks import TaskRequest, TaskResult


async def plan_tasks(message: str, *, context: ExecutionContext) -> tuple[TaskRequest, ...]:
    """Clarify scope and plan specialist tasks/dependencies without granting permissions."""
    raise NotImplementedError("The orchestrator task planner is not implemented.")


async def compose_response(
    results: Sequence[TaskResult], *, context: ExecutionContext
) -> TaskResult:
    """Compose validated results; distinguish evidence, general knowledge, and drafts.

    A draft is not a saved library record. Application writes require an exact user
    confirmation through Express, with actual receipts before reporting completion.
    """
    raise NotImplementedError("The orchestrator response composer is not implemented.")
