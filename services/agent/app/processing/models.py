from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator


# ── Application form (from Express API) ──────────────────────────────────────

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

    def is_placeholder(self) -> bool:
        """True when the upload page auto-generated dummy form data."""
        return self.name.lower() in ("document upload", "n/a", "") or self.roll_number in ("N/A", "n/a", "")


# ── Rich extraction from Gemini Vision ───────────────────────────────────────

class SubjectRow(BaseModel):
    model_config = ConfigDict(extra="ignore")
    subject: str
    marks_obtained: int | None = None
    max_marks: int | None = None
    grade: str | None = None


class ExtractedDocument(BaseModel):
    """All fields extracted from the document by Gemini Vision."""
    model_config = ConfigDict(extra="ignore")

    # Document identity
    document_type: str | None = None       # "SSC Marksheet", "HSC Certificate"
    issuing_board: str | None = None       # "Maharashtra State Board..."
    school_name: str | None = None

    # Student info
    student_name: str | None = None
    roll_number: str | None = None
    seat_number: str | None = None
    date_of_birth: str | None = None
    mother_name: str | None = None

    # Exam info
    exam_year: str | None = None
    exam_month: str | None = None

    # Marks table
    subjects: list[SubjectRow] = Field(default_factory=list)
    total_marks_obtained: int | None = None
    total_max_marks: int | None = None
    percentage: float | None = None
    result_status: str | None = None   # "PASS" / "FAIL"
    grade: str | None = None
    division: str | None = None        # "First", "Second", "Third"

    # Deprecated legacy fields are retained for response compatibility and are never used to decide authenticity.
    internal_consistency_score: float | None = None
    consistency_issues: list[str] = Field(default_factory=list)
    ai_generation_score: float | None = None
    suspicion_signals: list[str] = Field(default_factory=list)
    authenticity_signals: list[str] = Field(default_factory=list)

    gemini_verdict: Literal["needs_review"] = "needs_review"
    gemini_reasoning: str | None = None

    extraction_method: str = "gemini"
    warnings: list[str] = Field(default_factory=list)


# ── Field-level validation (internal consistency) ────────────────────────────

class FieldValidation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str
    expected: str | int | float | None
    extracted: str | int | float | None
    result: Literal["pass", "mismatch", "missing"]
    reason: str = Field(min_length=1)


# ── Quality flags (image quality pre-check) ──────────────────────────────────

class QualityFlags(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_blurry: bool = False
    is_too_dark: bool = False
    is_too_small: bool = False
    blur_score: float | None = None
    mean_brightness: float | None = None


# ── Agent reasoning (plain-language explanation) ─────────────────────────────

class AgentReasoning(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: str
    why_decision: str
    flags: list[str] = Field(default_factory=list)
    confidence_score: float | None = None  # Deprecated; new processing results always emit null.


# ── Final decision ────────────────────────────────────────────────────────────

Decision = Literal["verified", "needs_review", "missing"]


# ── Legacy (kept for worker compat) ──────────────────────────────────────────

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


def normalize_date(value: str) -> str | None:
    candidate = value.strip()
    for date_format in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y"):
        try:
            return datetime.strptime(candidate, date_format).date().isoformat()
        except ValueError:
            continue
    return None
