import hmac
import os
import re
from typing import Annotated

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, ValidationError
import psycopg
from psycopg.rows import dict_row

from . import config as _config  # Load local API keys without overriding deployment environment.
from .bounded_agent import CaseAgentRequest, CaseAgentResult, run_case_agent
from .db import database_url
from .pdf import MAX_PDF_BYTES, PdfPageLimitError, PdfProcessingError, extract_pdf
from .processing.models import ApplicationForm
from .processing.ocr import InvalidImageError, OcrTimeoutError, OcrUnavailableError
from .processing.pipeline import ProcessingResult, analyze_document

app = FastAPI(
    title="DocFlow Processing Agent",
    version="0.1.0",
    description="Synthetic document OCR and marksheet verification for the DocFlow processing agent.",
)

SUPPORTED_PROCESSING_TYPES = {"application/pdf", "image/png", "image/jpeg"}
MAX_PROCESSING_UPLOAD_BYTES = MAX_PDF_BYTES


class ExtractedPageResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page_number: int
    text: str
    image_png_base64: str | None


class ExtractedPdfResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page_count: int
    pages: list[ExtractedPageResponse]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "agent"}


@app.post("/internal/cases/run", response_model=CaseAgentResult)
def run_case(request: CaseAgentRequest, x_docflow_internal_token: Annotated[str | None, Header()] = None) -> CaseAgentResult:
    """Private processing endpoint. Express must authenticate the user and scope the case first."""
    expected = os.getenv("DOCFLOW_INTERNAL_TOKEN", "")
    if not expected or not x_docflow_internal_token or not hmac.compare_digest(expected, x_docflow_internal_token):
        raise HTTPException(status_code=401, detail="Internal service authentication required.")
    try:
        with psycopg.connect(database_url(), row_factory=dict_row, connect_timeout=10) as db:
            db.execute("SET search_path TO public")
            return run_case_agent(db, request)
    except Exception as error:
        # Never expose database URLs, policy content, or upstream error text to the caller.
        raise HTTPException(status_code=503, detail=f"Case assistant unavailable ({type(error).__name__}).") from error


@app.post("/extract", response_model=ExtractedPdfResponse)
def extract(file: Annotated[UploadFile, File()]) -> ExtractedPdfResponse:
    if file.content_type != "application/pdf":
        raise HTTPException(
            status_code=415,
            detail="Upload a PDF using the application/pdf content type.",
        )

    content = file.file.read(MAX_PDF_BYTES + 1)
    if len(content) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="The PDF must be no larger than 2 MB.")

    try:
        extracted = extract_pdf(content)
    except PdfPageLimitError as error:
        raise HTTPException(status_code=413, detail=str(error)) from error
    except PdfProcessingError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    return ExtractedPdfResponse(
        page_count=extracted.page_count,
        pages=[
            ExtractedPageResponse(
                page_number=page.page_number,
                text=page.text,
                image_png_base64=page.image_png_base64,
            )
            for page in extracted.pages
        ],
    )


@app.post("/process", response_model=ProcessingResult)
def process(
    file: Annotated[UploadFile, File(description="A PDF, PNG, or JPEG synthetic document.")],
    application: Annotated[
        str,
        Form(description="JSON application-form fields used for deterministic validation."),
    ],
    document_type: Annotated[
        str,
        Form(description="Explicit document category selected by the applicant or reviewer."),
    ],
) -> ProcessingResult:
    if file.content_type is None or file.content_type not in SUPPORTED_PROCESSING_TYPES:
        raise HTTPException(
            status_code=415,
            detail="Upload a PDF, PNG, or JPEG using its matching content type.",
        )

    content = file.file.read(MAX_PROCESSING_UPLOAD_BYTES + 1)
    if len(content) > MAX_PROCESSING_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The upload must be no larger than 2 MB.")

    document_type = document_type.strip().lower()
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,79}", document_type):
        raise HTTPException(status_code=422, detail="Document type must be an explicit category identifier.")

    try:
        application_form = ApplicationForm.model_validate_json(application)
    except ValidationError as error:
        details = [
            {
                "field": ".".join(str(part) for part in issue["loc"]) or "application",
                "message": issue["msg"],
            }
            for issue in error.errors(include_url=False)
        ]
        raise HTTPException(status_code=422, detail=details) from error

    try:
        if file.content_type == "application/pdf":
            # Validate PDF structure, size and page count before the pipeline's
            # best-effort extraction path can turn parse failures into empty text.
            extract_pdf(content)
        return analyze_document(
            content,
            application_form,
            content_type=file.content_type,
            document_type=document_type,
        )
    except PdfPageLimitError as error:
        raise HTTPException(status_code=413, detail=str(error)) from error
    except PdfProcessingError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except InvalidImageError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except OcrUnavailableError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except OcrTimeoutError as error:
        raise HTTPException(status_code=504, detail=str(error)) from error
