"""Model-visible catalog arguments and bounded, application-owned tool results."""
from typing import Literal
from pydantic import Field, StrictInt
from app.schemas.base import Contract
LibraryKind = Literal['library', 'books', 'courses', 'notes', 'documents', 'flashcards', 'study_sets', 'quiz_attempts', 'conversations']
LibraryOperation = Literal['list_library_items', 'get_library_item', 'explore_connections', 'get_library_overview']

class LibraryArguments(Contract):
    kind: LibraryKind = 'library'
    query: str = Field(default='', max_length=160)
    item_id: str = Field(default='', max_length=24, pattern=r'^(?:[a-fA-F0-9]{24})?$')
    cursor: str = Field(default='', max_length=300)
    limit: StrictInt = Field(default=10, ge=1, le=20)
    course_id: str = Field(default='', max_length=24, pattern=r'^(?:[a-fA-F0-9]{24})?$')
    book_id: str = Field(default='', max_length=24, pattern=r'^(?:[a-fA-F0-9]{24})?$')
    course_query: str = Field(default='', max_length=160)
    book_query: str = Field(default='', max_length=160)
    study_kind: Literal['', 'summary', 'explanation', 'flashcards', 'quiz'] = ''

class LibraryFact(Contract):
    label: str = Field(max_length=80)
    value: str = Field(max_length=500)

class LibraryItem(Contract):
    id: str = Field(pattern=r'^[a-fA-F0-9]{24}$')
    kind: LibraryKind
    title: str = Field(max_length=200)
    href: str = Field(max_length=120)
    facts: tuple[LibraryFact, ...] = Field(max_length=12)
    excerpt: str = Field(default='', max_length=4000)
    truncated: bool = False

class RelatedGroup(Contract):
    kind: LibraryKind
    total: StrictInt = Field(ge=0)
    items: tuple[LibraryItem, ...] = Field(max_length=3)

class LibraryResult(Contract):
    operation: LibraryOperation
    kind: LibraryKind = 'library'
    query: LibraryArguments
    scope_label: Literal['My library', 'Selected materials']
    status: Literal['ok', 'ambiguous', 'not_found']
    total: StrictInt = Field(ge=0)
    items: tuple[LibraryItem, ...] = Field(max_length=20)
    next_cursor: str | None = Field(default=None, max_length=300)
    related: tuple[RelatedGroup, ...] = Field(default=(), max_length=8)

class LibraryHistoryItem(Contract):
    id: str = Field(pattern=r'^[a-fA-F0-9]{24}$')
    kind: LibraryKind
    title: str = Field(max_length=200)

class LibraryMemory(Contract):
    operation: LibraryOperation
    kind: LibraryKind = 'library'
    query: LibraryArguments
    total: StrictInt = Field(ge=0)
    next_cursor: str | None = Field(default=None, max_length=300)
    scope_label: Literal['My library', 'Selected materials']
    items: tuple[LibraryHistoryItem, ...] = Field(max_length=20)
