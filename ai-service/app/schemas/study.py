"""Validated generated drafts. The model supplies references, never permissions/actions."""
from typing import Literal, Annotated
from pydantic import Field, StrictInt, StrictBool, model_validator
from app.schemas.base import Contract, Text
from app.schemas.context import ExecutionContext
from app.schemas.chat import NumberedCitation
from app.core.constants import DEFAULT_QUESTION_COUNT

Kind = Literal['summary','explanation','flashcards','quiz']
Format = Literal['auto','choice','written','code']
Short = Annotated[Text, Field(max_length=120)]
Numbers = Annotated[tuple[Annotated[StrictInt,Field(ge=1,le=12)],...],Field(min_length=1,max_length=12)]

class Criterion(Contract):
    description: Text = Field(max_length=500)
    maxPoints: StrictInt = Field(ge=1,le=10)

class Card(Contract):
    front: Text = Field(max_length=1000)
    back: Text = Field(max_length=3000)
    explanation: str = Field(max_length=1500)
    citationNumbers: Numbers

class Question(Contract):
    kind: Literal['choice','written','code']
    prompt: Text = Field(max_length=2000)
    options: tuple[Annotated[Text,Field(max_length=500)],...] = Field(max_length=4)
    correctIndex: StrictInt | None
    explanation: Text = Field(max_length=2000)
    referenceAnswer: str = Field(max_length=4000)
    rubric: tuple[Criterion,...] = Field(max_length=5)
    language: str = Field(max_length=30)
    starterCode: str = Field(max_length=4000)
    citationNumbers: Numbers

    @model_validator(mode='after')
    def answer_shape(self):
        if self.kind=='choice':
            if len(self.options)<2 or self.correctIndex is None or not 0<=self.correctIndex<len(self.options) or len({v.casefold() for v in self.options})!=len(self.options): raise ValueError('Invalid choice answers')
            if self.referenceAnswer or self.rubric or self.language or self.starterCode: raise ValueError('Unexpected choice fields')
        else:
            if self.options or self.correctIndex is not None or not self.referenceAnswer.strip() or not self.rubric: raise ValueError('A written/code question needs an answer and rubric')
            if self.kind=='code' and not self.language.strip(): raise ValueError('Code needs a language')
            if self.kind=='written' and (self.language or self.starterCode): raise ValueError('Unexpected written fields')
        return self

class GenerationOutput(Contract):
    supported: StrictBool
    limitation: str = Field(max_length=300)

class TextOutput(GenerationOutput):
    title: Short
    body: str = Field(max_length=16000)

class CardsOutput(GenerationOutput):
    title: Short
    cards: tuple[Card,...] = Field(max_length=10)

class QuizOutput(GenerationOutput):
    title: Short
    questions: tuple[Question,...] = Field(max_length=10)

class Coverage(Contract):
    passages: StrictInt = Field(ge=1,le=12)
    coveredSources: StrictInt = Field(ge=1,le=100)
    totalSources: StrictInt = Field(ge=1,le=100)
    excerpted: Literal[True] = True

class StudyDraft(Contract):
    kind: Kind
    title: Short
    body: str = Field(default='',max_length=16000)
    cards: tuple[Card,...] = Field(default=(),max_length=10)
    questions: tuple[Question,...] = Field(default=(),max_length=10)
    citations: tuple[NumberedCitation,...] = Field(min_length=1,max_length=12)
    coverage: Coverage

    @model_validator(mode='after')
    def correct_kind(self):
        if self.kind in ('summary','explanation') and (not self.body.strip() or self.cards or self.questions): raise ValueError('Invalid explanation/summary')
        if self.kind=='flashcards' and (not self.cards or self.body or self.questions): raise ValueError('Invalid deck')
        if self.kind=='quiz' and (not self.questions or self.body or self.cards): raise ValueError('Invalid quiz')
        return self

class StudyRequest(Contract):
    kind: Kind
    instruction: str = Field(default='',max_length=4000)
    topic: str = Field(default='',max_length=120)
    count: StrictInt = Field(default=DEFAULT_QUESTION_COUNT,ge=1,le=10)
    format: Format = 'auto'
    context: ExecutionContext
