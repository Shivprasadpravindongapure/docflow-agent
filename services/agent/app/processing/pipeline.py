from time import perf_counter

from pydantic import BaseModel, ConfigDict

from .extract import extract_fields
from .models import ApplicationForm, Decision, ExtractedFields, FieldValidation
from .ocr import run_ocr
from .validate import decide, validate


class ProcessingResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ocr_text: str
    extracted: ExtractedFields
    validations: list[FieldValidation]
    decision: Decision
    timings_ms: dict[str, float]


def analyze_document(
    image_bytes: bytes,
    application: ApplicationForm,
    provider: str | None = None,
) -> ProcessingResult:
    started = perf_counter()
    ocr_started = perf_counter()
    ocr_text = run_ocr(image_bytes)
    ocr_ms = (perf_counter() - ocr_started) * 1000

    extraction_started = perf_counter()
    extracted = extract_fields(ocr_text, provider=provider)
    extraction_ms = (perf_counter() - extraction_started) * 1000

    validation_started = perf_counter()
    validations = validate(application, extracted)
    decision = decide(validations)
    validation_ms = (perf_counter() - validation_started) * 1000

    return ProcessingResult(
        ocr_text=ocr_text,
        extracted=extracted,
        validations=validations,
        decision=decision,
        timings_ms={
            "ocr": round(ocr_ms, 3),
            "extraction": round(extraction_ms, 3),
            "validation": round(validation_ms, 3),
            "total": round((perf_counter() - started) * 1000, 3),
        },
    )
