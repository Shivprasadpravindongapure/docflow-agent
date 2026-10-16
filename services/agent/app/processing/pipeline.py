import base64
from time import perf_counter
from typing import Literal

from pydantic import BaseModel, ConfigDict

from ..pdf import extract_pdf
from .extract import extract_fields
from .models import ApplicationForm, Decision, ExtractedFields, FieldValidation
from .ocr import run_ocr
from .validate import decide, validate


class ProcessingResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_type: Literal["pdf", "image"]
    ocr_text: str
    extracted: ExtractedFields
    validations: list[FieldValidation]
    decision: Decision
    timings_ms: dict[str, float]


def analyze_document(
    document_bytes: bytes,
    application: ApplicationForm,
    provider: str | None = None,
    *,
    content_type: str = "image/png",
) -> ProcessingResult:
    started = perf_counter()
    document_ms = 0.0
    ocr_ms = 0.0

    if content_type == "application/pdf":
        document_started = perf_counter()
        document = extract_pdf(document_bytes)
        document_ms = (perf_counter() - document_started) * 1000

        ocr_started = perf_counter()
        page_texts: list[str] = []
        for page in document.pages:
            if page.text:
                page_texts.append(page.text)
            elif page.image_png_base64 is not None:
                image_bytes = base64.b64decode(page.image_png_base64, validate=True)
                page_texts.append(run_ocr(image_bytes))
            else:
                page_texts.append("")
        ocr_text = "\n".join(text for text in page_texts if text)
        ocr_ms = (perf_counter() - ocr_started) * 1000
        input_type: Literal["pdf", "image"] = "pdf"
    elif content_type in {"image/png", "image/jpeg"}:
        ocr_started = perf_counter()
        ocr_text = run_ocr(document_bytes)
        ocr_ms = (perf_counter() - ocr_started) * 1000
        input_type = "image"
    else:
        raise ValueError(f"Unsupported processing content type: {content_type}")

    extraction_started = perf_counter()
    extracted = extract_fields(ocr_text, provider=provider)
    extraction_ms = (perf_counter() - extraction_started) * 1000

    validation_started = perf_counter()
    validations = validate(application, extracted)
    decision = decide(validations)
    validation_ms = (perf_counter() - validation_started) * 1000

    return ProcessingResult(
        input_type=input_type,
        ocr_text=ocr_text,
        extracted=extracted,
        validations=validations,
        decision=decision,
        timings_ms={
            "document": round(document_ms, 3),
            "ocr": round(ocr_ms, 3),
            "extraction": round(extraction_ms, 3),
            "validation": round(validation_ms, 3),
            "total": round((perf_counter() - started) * 1000, 3),
        },
    )
