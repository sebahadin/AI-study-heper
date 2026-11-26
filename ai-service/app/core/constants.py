"""Editable policy defaults shared by the AI-service contracts.

Keep the policy server-owned; browser/model arguments cannot override it.
The internal PDF API enforces these defaults and exposes the effective limits.
"""

from typing import Final

MAX_PDF_PAGES: Final[int] = 5
DEFAULT_MAX_PDF_BYTES: Final[int] = 10 * 1024 * 1024
DEFAULT_QUESTION_COUNT: Final[int] = 5

# Character-based preparation defaults; embedding-token limits are applied later.
DEFAULT_PDF_CHUNK_CHARACTERS: Final[int] = 1000
DEFAULT_PDF_CHUNK_OVERLAP: Final[int] = 150
MAX_PDF_TEXT_CHARACTERS: Final[int] = 250_000
MAX_PDF_CONTENT_STREAM_BYTES: Final[int] = 2 * 1024 * 1024
MAX_PDF_PREPARED_CHUNKS: Final[int] = 1000
PDF_PREPARATION_VERSION: Final[str] = "pdf-text-v1"
