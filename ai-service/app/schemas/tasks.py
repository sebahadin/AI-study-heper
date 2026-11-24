"""Small task/result envelopes; generation payload schemas arrive with generators."""

from enum import StrEnum
from typing import Literal, Self

from pydantic import model_validator

from app.schemas.base import Contract, PositiveCount, Text
from app.schemas.evidence import Citation


class SpecialistRole(StrEnum):
    TUTOR = "tutor"
    SUMMARIZER = "summarizer"
    FLASHCARD_GENERATOR = "flashcard_generator"
    QUIZ_GENERATOR = "quiz_generator"
    STUDY_COACH = "study_coach"
    MATERIAL_RECOMMENDER = "material_recommender"


class TaskRequest(Contract):
    task_id: Text
    specialist: SpecialistRole
    goal: Text
    source_ids: tuple[Text, ...] = ()
    evidence_ids: tuple[Text, ...] = ()
    depends_on: tuple[Text, ...] = ()
    question_count: PositiveCount | None = None


class TaskResult(Contract):
    task_id: Text
    status: Literal["completed", "draft_ready", "needs_clarification", "insufficient_evidence", "failed"]
    text: Text
    citations: tuple[Citation, ...] = ()
    proposal_id: Text | None = None
    warnings: tuple[Text, ...] = ()

    @model_validator(mode="after")
    def require_draft_reference(self) -> Self:
        if self.status == "draft_ready" and self.proposal_id is None:
            raise ValueError("A draft_ready result requires a pending proposal reference.")
        return self
