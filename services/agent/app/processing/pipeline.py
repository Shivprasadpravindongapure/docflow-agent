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
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ..pdf import extract_pdf
from .extract import build_agent_reasoning, extract_fields, gemini_vision_analyze, pdf_all_pages_text, pdf_first_page_to_png
from .models import (
    AgentReasoning, ApplicationForm, Decision,
    ExtractedDocument, ExtractedFields, FieldValidation, QualityFlags,
)
from .quality import check_quality
from .ocr import OcrTimeoutError, OcrUnavailableError, run_ocr
from .validate import decide, validate as validate_application, validate_internal
from .schemas import MarksheetPayload, adapt_legacy_marksheet


class EvidenceReference(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reference_id: str
    page_number: int
    source: Literal["selectable_text", "tesseract_ocr", "uploaded_page"]


class ProcessingResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_type: Literal["pdf", "image"]
    document_type: str
    document_type_status: Literal["supported", "unsupported", "uncertain"]
    processing_state: Literal["completed"] = "completed"
    page_count: int
    evidence_refs: list[EvidenceReference]
    field_provenance: dict[str, list[str]] = Field(default_factory=dict)
    ocr_text: str                          # raw text extracted (selectable or empty for images)
    extracted: ExtractedFields             # legacy flat fields (backward compat with worker)
    extracted_document: ExtractedDocument  # rich Gemini extraction
    typed_payload: MarksheetPayload | None = None  # additive V2 contract; legacy response fields remain
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


def _local_document(text: str) -> ExtractedDocument | None:
    fields = extract_fields(text)
    return _document_from_fields(fields, method="tesseract")


def _document_from_fields(fields: ExtractedFields, *, method: str) -> ExtractedDocument | None:
    values = [fields.name, fields.roll_number, fields.dob, fields.board, fields.year, fields.total, fields.result]
    if not any(value is not None for value in values):
        return None
    return ExtractedDocument(
        student_name=fields.name,
        roll_number=fields.roll_number,
        date_of_birth=fields.dob,
        issuing_board=fields.board,
        exam_year=str(fields.year) if fields.year is not None else None,
        total_marks_obtained=fields.total,
        result_status=fields.result,
        extraction_method=method,
        warnings=fields.warnings,
    )


def _has_usable_marksheet_fields(document: ExtractedDocument) -> bool:
    return any((
        document.student_name,
        document.roll_number,
        document.seat_number,
        document.date_of_birth,
        document.issuing_board,
        document.exam_year,
        document.total_marks_obtained,
        document.result_status,
        document.subjects,
    ))


def analyze_document(
    document_bytes: bytes,
    application: ApplicationForm,
    provider: str | None = None,
    *,
    content_type: str = "image/png",
    document_type: str = "marksheet",
) -> ProcessingResult:
    document_type = document_type.strip().lower()
    if not document_type or len(document_type) > 80 or not document_type.replace("_", "").isalnum():
        raise ValueError("Document type must be a non-empty identifier of at most 80 characters.")
    started = perf_counter()
    timings: dict[str, float] = {}

    # ── Stage 1: Quality check ────────────────────────────────────────────────
    t = perf_counter()
    quality = QualityFlags()
    if content_type in ("image/png", "image/jpeg"):
        quality = check_quality(document_bytes, content_type)
    quality_duration = round((perf_counter() - t) * 1000, 1)

    # ── Stage 2: Get text + image bytes ready ─────────────────────────────────
    t = perf_counter()
    ocr_text = ""
    image_bytes: bytes = b""
    image_mime = "image/png"
    input_type: Literal["pdf", "image"] = "pdf"
    ocr_images: list[bytes] = []
    page_texts: list[str] = []
    page_sources: list[str] = []
    page_count = 1
    fallback_reason: str | None = None

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
            fallback_reason = f"Local PDF rendering failed: {type(e).__name__}."

        try:
            doc = extract_pdf(document_bytes)
            page_count = doc.page_count
            page_texts = [page.text or "" for page in doc.pages]
            page_sources = ["selectable_text" if page.text.strip() else "uploaded_page" for page in doc.pages]
            import base64 as _b64
            for page in doc.pages:
                if page.text and page.text.strip():
                    continue
                if page.image_png_base64:
                    try:
                        page_image = _b64.b64decode(page.image_png_base64)
                        ocr_images.append(page_image)
                        if not image_bytes:
                            image_bytes = page_image
                            image_mime = "image/png"
                    except Exception:
                        continue
        except Exception as error:
            fallback_reason = f"Local PDF page extraction failed: {type(error).__name__}."
        if not page_texts:
            page_texts = [ocr_text] if ocr_text.strip() else [""]
            page_sources = ["selectable_text" if ocr_text.strip() else "uploaded_page"]
            page_count = max(page_count, 1)
        if not ocr_text.strip() and image_bytes and not ocr_images:
            ocr_images.append(image_bytes)

    elif content_type in ("image/png", "image/jpeg"):
        input_type = "image"
        image_bytes = document_bytes
        image_mime = content_type
        ocr_images.append(document_bytes)
        page_texts = [""]
        page_sources = ["uploaded_page"]
        # No text extraction for raw images — Gemini Vision does it all

    timings["document"] = round((perf_counter() - t) * 1000, 1) + quality_duration

    # ── Stage 3: local OCR with per-page evidence ──────────────────────────────────────
    t = perf_counter()
    ocr_warnings: list[str] = []
    for page_index, page_image in enumerate(ocr_images):
        try:
            page_text = run_ocr(page_image)
            if page_text.strip():
                separator = "\n" if ocr_text and not ocr_text.endswith("\n") else ""
                ocr_text = f"{ocr_text}{separator}{page_text}"
                # OCR image order follows PDF page order; image uploads have one page.
                target_page = next((i for i, source in enumerate(page_sources) if source == "uploaded_page"), page_index)
                while len(page_texts) <= target_page:
                    page_texts.append("")
                    page_sources.append("uploaded_page")
                page_texts[target_page] = page_text
                page_sources[target_page] = "tesseract_ocr"
        except (OcrUnavailableError, OcrTimeoutError) as error:
            fallback_reason = str(error)
            ocr_warnings.append(f"Local Tesseract OCR failed: {error}")
            break
    timings["ocr"] = round((perf_counter() - t) * 1000, 1)

    evidence_refs: list[EvidenceReference] = []
    for index in range(page_count):
        evidence_refs.append(EvidenceReference(
            reference_id=f"page:{index + 1}:uploaded_page",
            page_number=index + 1,
            source="uploaded_page",
        ))
        source = page_sources[index] if index < len(page_sources) else "uploaded_page"
        if source != "uploaded_page":
            evidence_refs.append(EvidenceReference(
                reference_id=f"page:{index + 1}:{source}",
                page_number=index + 1,
                source=source,
            ))

    ocr_header = ocr_text[:1200].casefold()
    category_hint = None
    if re.search(r"\b(?:birth certificate|certificate of birth)\b", ocr_header):
        category_hint = "birth_certificate"
    elif re.search(r"\b(?:identity card|photo identity card)\b", ocr_header):
        category_hint = "identity_card"
    type_conflict = category_hint is not None and document_type not in {"unknown", "other", category_hint}

    if document_type != "marksheet" or type_conflict:
        unknown = document_type in {"unknown", "other", ""}
        uncertain = unknown or type_conflict
        if type_conflict:
            issue = f"The selected type '{document_type}' conflicts with OCR text indicating '{category_hint}'. Human classification is required."
        elif unknown:
            issue = "Document type is unknown and needs human classification."
        else:
            issue = f"Document type '{document_type}' is not supported by the current verification rules."
        warning = f"{issue} OCR/page evidence is retained; no marksheet extraction or type-specific checks were run."
        empty_doc = ExtractedDocument(warnings=[warning, *ocr_warnings], extraction_method="ocr_evidence_only")
        empty_fields = ExtractedFields(
            name=None, roll_number=None, dob=None, board=None, year=None, total=None, result=None,
            warnings=[warning, *ocr_warnings],
        )
        decision: Decision = "needs_review"
        reasoning = AgentReasoning(
            summary=issue,
            why_decision="No document-specific verification rules were run. A human reviewer must classify the document and select an approved workflow.",
            flags=["No type-specific checks were run."],
            confidence_score=None,
        )
        timings["extraction"] = 0.0
        timings["validation"] = 0.0
        timings["total"] = round((perf_counter() - started) * 1000, 1)
        return ProcessingResult(
            input_type=input_type,
            document_type=document_type,
            document_type_status="uncertain" if uncertain else "unsupported",
            page_count=page_count,
            evidence_refs=evidence_refs,
            field_provenance={},
            ocr_text=ocr_text,
            extracted=empty_fields,
            extracted_document=empty_doc,
            typed_payload=None,
            validations=[],
            decision=decision,
            quality=quality,
            reasoning=reasoning,
            timings_ms=timings,
        )

    t = perf_counter()
    extracted_doc = _local_document(ocr_text)
    if extracted_doc is not None:
        extracted_doc.warnings.extend(ocr_warnings)
    elif image_bytes:
        fallback_reason = fallback_reason or "Tesseract/local extraction returned no usable labelled marksheet fields."
        extracted_doc = gemini_vision_analyze(image_bytes, image_mime, extra_text=ocr_text)
        extracted_doc.warnings.insert(0, fallback_reason)
        extracted_doc.warnings.extend(ocr_warnings)
        if not _has_usable_marksheet_fields(extracted_doc):
            if ocr_text.strip():
                groq_fields = extract_fields(ocr_text, provider="groq")
                groq_document = _document_from_fields(groq_fields, method="groq")
                if groq_document is not None:
                    groq_document.warnings = [
                        *extracted_doc.warnings,
                        "Groq text fallback used after Gemini returned no usable marksheet fields.",
                        *groq_document.warnings,
                    ]
                    extracted_doc = groq_document
                else:
                    extracted_doc.warnings.extend(groq_fields.warnings)
            else:
                extracted_doc.warnings.append("Groq text fallback skipped because no OCR text was available.")
    else:
        extracted_doc = ExtractedDocument(
            warnings=[fallback_reason or "No usable text or page image was available for extraction.", *ocr_warnings],
            extraction_method="unavailable",
        )
    timings["extraction"] = round((perf_counter() - t) * 1000, 1)

    # ── Stage 4: Internal consistency validation ──────────────────────────────
    t = perf_counter()
    legacy_extracted = _to_legacy_extracted(extracted_doc)
    validations = validate_application(application, legacy_extracted)
    validations.extend(validate_internal(extracted_doc))
    decision = decide(validations)
    timings["validation"] = round((perf_counter() - t) * 1000, 1)

    # ── Stage 5: Agent reasoning ──────────────────────────────────────────────
    t = perf_counter()
    reasoning = build_agent_reasoning(extracted_doc, validations, decision)

    timings["total"] = round((perf_counter() - started) * 1000, 1)

    typed_payload = adapt_legacy_marksheet(extracted_doc)
    field_provenance: dict[str, list[str]] = {}
    def provenance_for(value: object) -> list[str]:
        if value is None:
            return []
        needle = " ".join(str(value).casefold().split())
        refs = [
            f"page:{index + 1}:{page_sources[index]}"
            for index, page_text in enumerate(page_texts[:page_count])
            if needle and page_text and needle in " ".join(page_text.casefold().split())
        ]
        if not refs and extracted_doc.extraction_method.lower().startswith("gemini") and page_count:
            refs = ["page:1:uploaded_page"]
        return refs

    for field_name in (
        "candidate_name", "candidate_identifier", "roll_number", "seat_number", "date_of_birth",
        "board", "school_name", "exam_year", "exam_month", "marks_obtained", "maximum_marks",
        "percentage", "result", "grade", "division",
    ):
        value = getattr(typed_payload, field_name)
        if value is not None:
            field_provenance[field_name] = provenance_for(value)
    for index, subject in enumerate(typed_payload.subjects):
        for field_name in ("subject", "marks_obtained", "maximum_marks", "grade"):
            value = getattr(subject, field_name)
            if value is not None:
                field_provenance[f"subjects[{index}].{field_name}"] = provenance_for(value)

    return ProcessingResult(
        input_type=input_type,
        document_type=document_type,
        document_type_status="supported",
        page_count=page_count,
        evidence_refs=evidence_refs,
        field_provenance=field_provenance,
        ocr_text=ocr_text,
        extracted=_to_legacy_extracted(extracted_doc),
        extracted_document=extracted_doc,
        typed_payload=typed_payload,
        validations=validations,
        decision=decision,
        quality=quality,
        reasoning=reasoning,
        timings_ms=timings,
    )
