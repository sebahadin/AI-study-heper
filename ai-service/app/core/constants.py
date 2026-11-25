"""Editable policy defaults shared by the AI-service contracts.

Keep the policy server-owned; browser/model arguments cannot override it.
The internal PDF API enforces these defaults and exposes the effective limits.
"""

from typing import Final

MAX_PDF_PAGES: Final[int] = 5
DEFAULT_MAX_PDF_BYTES: Final[int] = 10 * 1024 * 1024
DEFAULT_QUESTION_COUNT: Final[int] = 5
