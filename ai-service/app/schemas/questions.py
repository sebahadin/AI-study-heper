"""Typed generation/review drafts, including private answer keys and rubrics.

These are server-side draft contracts. The quiz implementation must expose
separate attempt-facing schemas without correct/reference answers. Render each
question by its own kind; an automatic-format batch may mix kinds.
"""

from typing import Annotated, Literal, Self

from pydantic import Field, model_validator

from app.schemas.base import Contract, Count, PositiveCount, Text
from app.schemas.evidence import Citation

QuestionFormatPreference = Literal["auto", "choice", "written", "code"]


class RubricCriterion(Contract):
    criterion_id: Text
    description: Text
    max_points: PositiveCount


class QuestionBase(Contract):
    question_id: Text
    prompt: Text
    citations: tuple[Citation, ...] = ()


class ChoiceQuestionDraft(QuestionBase):
    kind: Literal["choice"] = "choice"
    options: tuple[Text, ...] = Field(min_length=2)
    correct_index: Count
    explanation: Text

    @model_validator(mode="after")
    def validate_answer(self) -> Self:
        if self.correct_index >= len(self.options):
            raise ValueError("correct_index must identify one of the options.")
        if len({option.casefold() for option in self.options}) != len(self.options):
            raise ValueError("Choice options must be distinct.")
        return self


class OpenQuestionBase(QuestionBase):
    reference_answer: Text
    rubric: tuple[RubricCriterion, ...] = Field(min_length=1)


class WrittenQuestionDraft(OpenQuestionBase):
    kind: Literal["written"] = "written"


class CodeQuestionDraft(OpenQuestionBase):
    kind: Literal["code"] = "code"
    language: Text
    starter_code: str = ""


QuestionDraft = Annotated[
    ChoiceQuestionDraft | WrittenQuestionDraft | CodeQuestionDraft,
    Field(discriminator="kind"),
]


class QuestionBatchDraft(Contract):
    """The generator must also check the batch size against the requested count."""

    questions: tuple[QuestionDraft, ...] = Field(min_length=1)

    @model_validator(mode="after")
    def require_unique_question_ids(self) -> Self:
        ids = [question.question_id for question in self.questions]
        if len(ids) != len(set(ids)):
            raise ValueError("Question IDs must be unique within a batch.")
        return self
