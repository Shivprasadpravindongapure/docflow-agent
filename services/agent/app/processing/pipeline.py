"""
Main document analysis pipeline.
Uses Gemini Vision as the primary engine — no Tesseract required.

Flow:
  1. Quality check  (blur / brightness — pure Python, no OpenCV)
  2. PDF text extraction  (pdfplumber selectable text)
  3. PDF → image conversion  (PyMuPDF first page)
  4. Gemini Vision analysis  (extraction + consistency + AI-gen detection)
  5. Internal validation  (rule-based cross-checks on extracted fields)
  6. Final verdict + agent reasoning
"""
from time import perf_counter
from typing import Literal

from pydantic import BaseModel, ConfigDict

from ..pdf import extract_pdf
from .extract import build_agent_reasoning, gemini_vision_analyze, pdf_all_pages_text, pdf_first_page_to_png
from .models import (
    AgentReasoning, ApplicationForm, Decision,
    ExtractedDocument, ExtractedFields, FieldValidation, QualityFlags,
)
from .quality import check_quality
from .validate import decide, validate_internal


class ProcessingResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_type: Literal["pdf", "image"]
    ocr_text: str                          # raw text extracted (selectable or empty for images)
    extracted: ExtractedFields             # legacy flat fields (backward compat with worker)
    extracted_document: ExtractedDocument  # rich Gemini extraction
    validations: list[FieldValidation]
    decision: Decision
    quality: QualityFlags
    reasoning: AgentReasoning
    timings_ms: dict[str, float]


def _to_legacy_extracted(doc: ExtractedDocument) -> ExtractedFields:
    """Map rich ExtractedDocument → legacy ExtractedFields for worker backward compat."""
    from .models import ExtractedFields, normalize_date
    dob_normalized = normalize_date(doc.date_of_birth) if doc.date_of_birth else None
    year_int: int | None = None
    if doc.exam_year:
        try:
            year_int = int(doc.exam_year)
        except ValueError:
            pass
    return ExtractedFields(
        name=doc.student_name,
        roll_number=doc.roll_number or doc.seat_number,
        dob=dob_normalized,
        board=doc.issuing_board,
        year=year_int,
        total=doc.total_marks_obtained,
        result=doc.result_status,
        warnings=doc.warnings,
    )


def analyze_document(
    document_bytes: bytes,
    application: ApplicationForm,
    provider: str | None = None,
    *,
    content_type: str = "image/png",
) -> ProcessingResult:
    started = perf_counter()
    timings: dict[str, float] = {}

    # ── Stage 1: Quality check ────────────────────────────────────────────────
    t = perf_counter()
    quality = QualityFlags()
    if content_type in ("image/png", "image/jpeg"):
        quality = check_quality(document_bytes, content_type)
    timings["quality"] = round((perf_counter() - t) * 1000, 1)

    # ── Stage 2: Get text + image bytes ready ─────────────────────────────────
    t = perf_counter()
    ocr_text = ""
    image_bytes: bytes = b""
    image_mime = "image/png"
    input_type: Literal["pdf", "image"] = "pdf"

    if content_type == "application/pdf":
        input_type = "pdf"
        # Extract selectable text (fast, no Gemini cost)
        ocr_text = pdf_all_pages_text(document_bytes)
        # Render first page to image for Gemini Vision
        try:
            image_bytes = pdf_first_page_to_png(document_bytes, zoom=2.0)
            image_mime = "image/png"
        except Exception as e:
            quality.is_too_small = True

        # Also try pdfplumber page-by-page for scanned pages
        # Note: Tesseract/OCR is NOT used — Gemini Vision handles image reading
        if not ocr_text.strip():
            try:
                doc = extract_pdf(document_bytes)
                import base64 as _b64
                texts = []
                for page in doc.pages:
                    if page.text:
                        texts.append(page.text)
                    elif page.image_png_base64:
                        try:
                            img = _b64.b64decode(page.image_png_base64)
                            if not image_bytes:
                                image_bytes = img
                                image_mime = "image/png"
                        except Exception:
                            pass
                ocr_text = "\n".join(t for t in texts if t)
            except Exception:
                pass

    elif content_type in ("image/png", "image/jpeg"):
        input_type = "image"
        image_bytes = document_bytes
        image_mime = content_type
        # No text extraction for raw images — Gemini Vision does it all

    timings["ocr"] = round((perf_counter() - t) * 1000, 1)

    # ── Stage 3: Gemini Vision analysis ──────────────────────────────────────
    t = perf_counter()
    if image_bytes:
        extracted_doc = gemini_vision_analyze(image_bytes, image_mime, extra_text=ocr_text)
    else:
        # No image available — Gemini can't help much
        from .models import ExtractedDocument
        extracted_doc = ExtractedDocument(
            warnings=["No image could be produced for Gemini Vision analysis."],
            gemini_verdict="needs_review",
            gemini_reasoning="Document could not be converted to image for analysis.",
        )
    timings["extraction"] = round((perf_counter() - t) * 1000, 1)

    # ── Stage 4: Internal consistency validation ──────────────────────────────
    t = perf_counter()
    validations = validate_internal(extracted_doc)
    decision = decide(extracted_doc, validations)
    timings["validation"] = round((perf_counter() - t) * 1000, 1)

    # ── Stage 5: Agent reasoning ──────────────────────────────────────────────
    t = perf_counter()
    reasoning = build_agent_reasoning(extracted_doc, validations, decision)
    timings["reasoning"] = round((perf_counter() - t) * 1000, 1)

    timings["total"] = round((perf_counter() - started) * 1000, 1)

    return ProcessingResult(
        input_type=input_type,
        ocr_text=ocr_text,
        extracted=_to_legacy_extracted(extracted_doc),
        extracted_document=extracted_doc,
        validations=validations,
        decision=decision,
        quality=quality,
        reasoning=reasoning,
        timings_ms=timings,
    )
