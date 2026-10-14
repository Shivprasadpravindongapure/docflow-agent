from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator


class ApplicationForm(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    roll_number: str = Field(min_length=1, max_length=100)
    dob: str = Field(min_length=1, max_length=30)
    year: int = Field(ge=1900, le=2100)
    board: str | None = Field(default=None, max_length=200)
    total: int | None = Field(default=None, ge=0, le=500)

    @field_validator("name", "roll_number", "dob", mode="before")
    @classmethod
    def strip_required_strings(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class ExtractionValues(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None
    roll_number: str | None
    dob: str | None
    board: str | None
    year: StrictInt | None
    total: StrictInt | None
    result: str | None


class ExtractedFields(ExtractionValues):
    warnings: list[str] = Field(default_factory=list)


class FieldValidation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: Literal["name", "roll_number", "dob", "board", "year", "total"]
    expected: str | int | None
    extracted: str | int | None
    result: Literal["pass", "mismatch", "missing"]
    reason: str = Field(min_length=1)


Decision = Literal["verified", "needs_review", "missing"]


def normalize_date(value: str) -> str | None:
    candidate = value.strip()
    for date_format in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y"):
        try:
            return datetime.strptime(candidate, date_format).date().isoformat()
        except ValueError:
            continue
    return None
