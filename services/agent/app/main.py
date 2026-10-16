from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, ValidationError

from .pdf import MAX_PDF_BYTES, PdfPageLimitError, PdfProcessingError, extract_pdf
from .processing.models import ApplicationForm
from .processing.ocr import InvalidImageError, OcrTimeoutError, OcrUnavailableError
from .processing.pipeline import ProcessingResult, analyze_document

app = FastAPI(
    title="DocFlow Processing Agent",
    version="0.1.0",
    description="Synthetic marksheet processing for the DocFlow processing agent.",
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
    file: Annotated[UploadFile, File(description="A PDF, PNG, or JPEG synthetic marksheet.")],
    application: Annotated[
        str,
        Form(description="JSON application-form fields used for deterministic validation."),
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
        return analyze_document(
            content,
            application_form,
            content_type=file.content_type,
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
