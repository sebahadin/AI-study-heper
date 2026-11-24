"""Editable policy defaults shared by the AI-service contracts.

Upload enforcement and UI policy discovery will use these settings when built.
Keep the policy server-owned; browser/model arguments cannot override it.
"""

from typing import Final

MAX_PDF_PAGES: Final[int] = 5
DEFAULT_QUESTION_COUNT: Final[int] = 5
