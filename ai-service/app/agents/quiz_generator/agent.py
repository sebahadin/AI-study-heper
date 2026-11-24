"""Prepare mixed-format quiz drafts, answer references, and marking rubrics."""

from app.schemas.context import ExecutionContext
from app.schemas.tasks import TaskRequest, TaskResult


async def run(task: TaskRequest, *, context: ExecutionContext) -> TaskResult:
    """Prepare mixed-format quiz drafts, answer references, and marking rubrics.

    Choose choice, written, or code per question when the preference is auto.
    The future UI renders options, a text area, or a code editor by question kind.
    Code answers receive rubric-based assessment; code execution is a separate
    sandboxed feature, not part of this stub.

    Use scoped read tools. Return a typed result or pending proposal reference;
    library changes require the user's confirmation through Express.
    """
    raise NotImplementedError("The quiz_generator specialist is not implemented.")
