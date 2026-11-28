"""Bounded learning data supplied only by Express after ownership checks."""
from typing import Literal
from pydantic import Field, StrictInt
from app.schemas.base import Contract

class RubricCriterion(Contract):
    description: str = Field(min_length=1, max_length=500)
    maxPoints: StrictInt = Field(ge=1, le=10)

class AssessmentQuestion(Contract):
    kind: Literal['written', 'code']
    prompt: str = Field(min_length=1, max_length=4000)
    referenceAnswer: str = Field(min_length=1, max_length=4000)
    rubric: tuple[RubricCriterion, ...] = Field(min_length=1, max_length=5)
    language: str = Field(default='', max_length=30)

class AssessmentRequest(Contract):
    question: AssessmentQuestion
    answer: str = Field(min_length=1, max_length=12000)

class CriterionAssessment(Contract):
    index: StrictInt = Field(ge=0, le=4)
    points: StrictInt = Field(ge=0, le=10)
    reason: str = Field(min_length=1, max_length=600)

class AssessmentOutput(Contract):
    criteria: tuple[CriterionAssessment, ...] = Field(min_length=1, max_length=5)
    feedback: str = Field(min_length=1, max_length=3000)

class LearningStats(Contract):
    completed: StrictInt = Field(ge=0, le=12)
    choiceCorrect: StrictInt = Field(ge=0)
    choiceAnswered: StrictInt = Field(ge=0)
    aiAssessed: StrictInt = Field(ge=0)
    aiEarned: StrictInt = Field(ge=0)
    aiPossible: StrictInt = Field(ge=0)

class LibraryResource(Contract):
    id: str = Field(min_length=1, max_length=64)
    type: Literal['course', 'book', 'note', 'document', 'study']
    title: str = Field(min_length=1, max_length=200)
    href: str = Field(min_length=1, max_length=100)
    hint: str = Field(default='', max_length=160)

class LearningContext(Contract):
    stats: LearningStats
    attempts: tuple[dict, ...] = Field(default=(), max_length=12)
    chatTopics: tuple[str, ...] = Field(default=(), max_length=6)
    resources: tuple[LibraryResource, ...] = Field(default=(), max_length=40)
    coverage: str = Field(max_length=300)

class CoachingRequest(Contract):
    context: LearningContext

class FocusArea(Contract):
    topic: str = Field(min_length=1, max_length=200)
    reason: str = Field(min_length=1, max_length=600)
    attemptIds: tuple[str, ...] = Field(max_length=12)

class CoachingDraft(Contract):
    overview: str = Field(min_length=1, max_length=2000)
    focusAreas: tuple[FocusArea, ...] = Field(max_length=5)
    nextSteps: tuple[str, ...] = Field(max_length=5)

class Recommendation(Contract):
    resourceId: str = Field(min_length=1, max_length=64)
    reason: str = Field(min_length=1, max_length=600)

class RecommendationOutput(Contract):
    recommendations: tuple[Recommendation, ...] = Field(max_length=5)
