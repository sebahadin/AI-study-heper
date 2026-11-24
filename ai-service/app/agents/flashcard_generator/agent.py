"""Prepare source-grounded study question drafts in the appropriate format."""

from app.schemas.context import ExecutionContext
from app.schemas.tasks import TaskRequest, TaskResult


async def run(task: TaskRequest, *, context: ExecutionContext) -> TaskResult:
    """Prepare source-grounded study question drafts in the appropriate format.

    Use the default count when no count is requested. Keep per-question format
    information; mapping these drafts to library records belongs to the generator
    implementation and confirmed-save workflow.

    Use scoped read tools. Return a typed result or pending proposal reference;
    library changes require the user's confirmation through Express.
    """
    raise NotImplementedError("The flashcard_generator specialist is not implemented.")
