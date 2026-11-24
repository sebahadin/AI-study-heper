"""Prepare source-grounded multiple-choice flashcard drafts for user review."""

from app.schemas.context import ExecutionContext
from app.schemas.tasks import TaskRequest, TaskResult


async def run(task: TaskRequest, *, context: ExecutionContext) -> TaskResult:
    """Prepare source-grounded multiple-choice flashcard drafts for user review.

    Use scoped read tools. Return a typed result or pending proposal reference;
    library changes require the user's confirmation through Express.
    """
    raise NotImplementedError("The flashcard_generator specialist is not implemented.")
