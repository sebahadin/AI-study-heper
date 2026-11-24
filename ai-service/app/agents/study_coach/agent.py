"""Explain authoritative quiz statistics and suggest supported revision topics."""

from app.schemas.context import ExecutionContext
from app.schemas.tasks import TaskRequest, TaskResult


async def run(task: TaskRequest, *, context: ExecutionContext) -> TaskResult:
    """Explain authoritative quiz statistics and suggest supported revision topics.

    Use scoped read tools. Return a typed result or pending proposal reference;
    library changes require the user's confirmation through Express.
    """
    raise NotImplementedError("The study_coach specialist is not implemented.")
