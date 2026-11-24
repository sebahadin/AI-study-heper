"""Recommend real authorized library materials with supported reasons."""

from app.schemas.context import ExecutionContext
from app.schemas.tasks import TaskRequest, TaskResult


async def run(task: TaskRequest, *, context: ExecutionContext) -> TaskResult:
    """Recommend real authorized library materials with supported reasons.

    Use scoped read tools. Return a typed result or pending proposal reference;
    library changes require the user's confirmation through Express.
    """
    raise NotImplementedError("The material_recommender specialist is not implemented.")
