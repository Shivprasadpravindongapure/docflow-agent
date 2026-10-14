from typing import Annotated

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict

from .pdf import MAX_PDF_BYTES, PdfPageLimitError, PdfProcessingError, extract_pdf

app = FastAPI(
    title="DocFlow Processing Agent",
    version="0.1.0",
    description="Synthetic marksheet PDF extraction for the DocFlow processing agent.",
)


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
