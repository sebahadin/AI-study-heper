"""LangGraph composition boundary. No graph or model is executed in this slice."""

from typing import Protocol, TypedDict

from app.schemas.context import ExecutionContext
from app.schemas.tasks import TaskRequest, TaskResult


class ChatState(TypedDict):
    message: str
    tasks: tuple[TaskRequest, ...]
    results: tuple[TaskResult, ...]


class ChatWorkflow(Protocol):
    async def ainvoke(self, state: ChatState, *, context: ExecutionContext) -> ChatState:
        """Execute the future graph with trusted context outside model-editable state."""
        ...


def build_chat_graph() -> ChatWorkflow:
    """Compile LangGraph planning, specialist, validation, and composition nodes.

    Add persistent, user-owned checkpoints and confirmation interrupts when those
    behaviors are implemented. Do not return an empty graph that appears functional.
    """
    raise NotImplementedError("The LangGraph chat workflow is not implemented.")
