from typing import Literal
from pydantic import Field, StrictBool
from app.schemas.base import Contract, Text
from app.schemas.context import ExecutionContext
from app.schemas.library import LibraryArguments, LibraryMemory
from app.core.constants import DEFAULT_QUESTION_COUNT
from app.schemas.evidence import Citation

ChatMode = Literal['grounded', 'general', 'mixed', 'clarification', 'insufficient_evidence', 'draft', 'coaching', 'library', 'assistant']


class NumberedCitation(Citation):
    number: int = Field(ge=1, le=12)
    title: str | None = None
    href: str | None = None


class HistoryMessage(Contract):
    role: Literal['user', 'assistant']
    content: str = Field(max_length=12000)
    citations: tuple[NumberedCitation, ...] = Field(default=(), max_length=12)
    library: LibraryMemory | None = None


class ChatRequest(Contract):
    message: Text = Field(max_length=4000)
    history: tuple[HistoryMessage, ...] = Field(default=(), max_length=12)
    context: ExecutionContext
    topic: str = Field(default='', max_length=120)
    allow_general: StrictBool = False


class ChatPlan(Contract):
    action: Literal['search_materials', 'fetch_passages', 'answer', 'clarify', 'unsupported', 'summarize', 'explain', 'generate_flashcards', 'generate_quiz', 'review_performance', 'recommend_materials', 'list_library_items', 'get_library_item', 'explore_connections', 'get_library_overview', 'respond']
    query: str = Field(max_length=160)
    chunk_ids: list[str] = Field(max_length=12)
    clarification: str = Field(max_length=300)

    count: int = Field(default=DEFAULT_QUESTION_COUNT, ge=1, le=10)
    format: Literal['auto','choice','written','code'] = 'auto'

    library: LibraryArguments | None = None
    response_kind: Literal['greeting', 'identity', 'capabilities'] = 'greeting'
