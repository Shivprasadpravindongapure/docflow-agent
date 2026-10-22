"""Versioned, document-specific result payload registry.

Only marksheets are supported by the current processing version. Unknown types
must remain unsupported instead of being coerced into marksheet fields.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .models import ExtractedDocument, ExtractedFields


class MarksheetSubjectPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    subject: str
    marks_obtained: int | None = None
    maximum_marks: int | None = None
    grade: str | None = None


class MarksheetPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_type: Literal["marksheet"] = "marksheet"
    schema_version: Literal["marksheet.v1"] = "marksheet.v1"
    candidate_name: str | None = None
    candidate_identifier: str | None = None
    roll_number: str | None = None
    seat_number: str | None = None
    date_of_birth: str | None = None
    board: str | None = None
    school_name: str | None = None
    exam_year: int | None = None
    exam_month: str | None = None
    subjects: list[MarksheetSubjectPayload] = Field(default_factory=list)
    marks_obtained: int | None = None
    maximum_marks: int | None = None
    percentage: float | None = None
    result: str | None = None
    grade: str | None = None
    division: str | None = None
    warnings: list[str] = Field(default_factory=list)


class MarksheetEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    application_id: str
    document_id: str
    document_type: Literal["marksheet"]
    payload: MarksheetPayload


PAYLOAD_SCHEMAS = {"marksheet": MarksheetPayload}


class UnsupportedDocumentTypeError(ValueError):
    pass


def validate_document_payload(document_type: str, payload: dict) -> MarksheetPayload:
    """Validate a category payload without silently accepting other types."""
    schema = PAYLOAD_SCHEMAS.get(document_type)
    if schema is None:
        raise UnsupportedDocumentTypeError(f"Unsupported document type: {document_type}.")
    return schema.model_validate(payload)


def adapt_legacy_marksheet(document: ExtractedDocument | ExtractedFields) -> MarksheetPayload:
    """Map the existing marksheet output to the versioned V2 payload."""
    if isinstance(document, ExtractedDocument):
        return MarksheetPayload(
            candidate_name=document.student_name,
            candidate_identifier=document.roll_number or document.seat_number,
            roll_number=document.roll_number,
            seat_number=document.seat_number,
            date_of_birth=document.date_of_birth,
            board=document.issuing_board,
            school_name=document.school_name,
            exam_year=int(document.exam_year) if document.exam_year and document.exam_year.isdigit() else None,
            exam_month=document.exam_month,
            subjects=[
                MarksheetSubjectPayload(
                    subject=row.subject,
                    marks_obtained=row.marks_obtained,
                    maximum_marks=row.max_marks,
                    grade=row.grade,
                )
                for row in document.subjects
            ],
            marks_obtained=document.total_marks_obtained,
            maximum_marks=document.total_max_marks,
            percentage=document.percentage,
            result=document.result_status,
            grade=document.grade,
            division=document.division,
            warnings=list(document.warnings),
        )
    return MarksheetPayload(
        candidate_name=document.name,
        candidate_identifier=document.roll_number,
        roll_number=document.roll_number,
        date_of_birth=document.dob,
        board=document.board,
        exam_year=document.year,
        marks_obtained=document.total,
        result=document.result,
        warnings=list(document.warnings),
    )
