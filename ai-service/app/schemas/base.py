"""Shared wire-contract primitives; validation is not authentication."""

from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, strict=True)]
PositiveCount = Annotated[int, Field(gt=0, strict=True)]
Count = Annotated[int, Field(ge=0, strict=True)]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
