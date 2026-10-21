"""
Gemini Vision-based document extraction.
Replaces Tesseract OCR — sends the document image directly to Gemini,
which reads text, extracts structured fields, checks internal consistency,
and flags AI-generation signals in one pass.
"""
import base64
import json
import os

import fitz  # PyMuPDF — PDF → image conversion

from .models import ExtractedDocument, SubjectRow


# ── PDF → PNG conversion ──────────────────────────────────────────────────────

def pdf_first_page_to_png(pdf_bytes: bytes, zoom: float = 2.0) -> bytes:
    """Render the first page of a PDF to a high-res PNG via PyMuPDF."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc[0]
    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
    return pix.tobytes("png")


def pdf_all_pages_text(pdf_bytes: bytes) -> str:
    """Extract selectable text from all PDF pages using pdfplumber."""
    try:
        import pdfplumber
        with pdfplumber.open(__import__("io").BytesIO(pdf_bytes)) as pdf:
            return "\n".join(
                (page.extract_text() or "") for page in pdf.pages
            ).strip()
    except Exception:
        return ""


# ── Gemini Vision schema (used as response_schema for structured output) ──────

_GEMINI_PROMPT = """You are an expert document verification agent for Indian educational institutions (10th / SSC / 12th / HSC marksheets, certificates).

Analyze this document image carefully and return a complete JSON analysis.

EXTRACTION RULES:
- Extract EVERY visible field. Do not skip or guess values not present.
- For marks tables, extract each subject row with marks_obtained, max_marks, grade.
- Compute total_marks_obtained by summing subject marks if not directly shown.
- date_of_birth: convert to DD/MM/YYYY if possible.
- exam_year: 4-digit year only.
- result_status: "PASS" or "FAIL" as shown.

CONSISTENCY CHECK (internal_consistency_score 0.0–1.0):
- Do subject marks sum to total_marks_obtained? (critical check)
- Does percentage = (total_marks_obtained / total_max_marks) * 100?
- Is the exam year realistic (1990–2030)?
- Are all required fields present?
Set to 1.0 if all checks pass, lower for each issue found.

AI GENERATION DETECTION (ai_generation_score 0.0–1.0):
Red flags that raise the score:
- Perfect, suspiciously uniform fonts with zero variation
- Numbers that are clearly rounded or made up (e.g., exactly 500/500 total)
- Missing official watermarks, seals, or embossing expected on real docs
- Inconsistent fonts within the same section (some fields different font)
- Background looks computer-generated (too perfect or generic)
- Missing or incorrect school/board logo
- Subject marks that are implausibly uniform (e.g., exactly 70 in every subject)
- Date format inconsistencies

Good authenticity signals (lower the score):
- Visible official seal / stamp / watermark
- Natural font variation expected in real prints
- Marks that vary realistically across subjects
- Official board code / certificate number present
- Realistic imperfections (slight misalignment, scan artifacts)

VERDICT:
- "verified": ai_generation_score < 0.3 AND internal_consistency_score >= 0.8 AND key fields extracted
- "suspicious": ai_generation_score >= 0.5 OR (internal_consistency_score < 0.4 AND multiple consistency issues)
- "needs_review": everything else

Return ONLY a valid JSON object (no markdown, no explanation) with EXACTLY these fields:
{
  "document_type": "<string or null>",
  "issuing_board": "<string or null>",
  "school_name": "<string or null>",
  "student_name": "<string or null>",
  "roll_number": "<string or null>",
  "seat_number": "<string or null>",
  "date_of_birth": "<DD/MM/YYYY or null>",
  "mother_name": "<string or null>",
  "exam_year": "<4-digit year string or null>",
  "exam_month": "<month name or null>",
  "subjects": [
    {"subject": "<name>", "marks_obtained": <int or null>, "max_marks": <int or null>, "grade": "<string or null>"}
  ],
  "total_marks_obtained": <int or null>,
  "total_max_marks": <int or null>,
  "percentage": <float or null>,
  "result_status": "<PASS or FAIL or null>",
  "grade": "<string or null>",
  "division": "<First/Second/Third or null>",
  "internal_consistency_score": <float 0.0-1.0>,
  "consistency_issues": ["<issue1>", ...],
  "ai_generation_score": <float 0.0-1.0>,
  "suspicion_signals": ["<signal1>", ...],
  "authenticity_signals": ["<signal1>", ...],
  "gemini_verdict": "<verified|needs_review|suspicious>",
  "gemini_reasoning": "<plain English explanation of verdict>"
}"""


def gemini_vision_analyze(
    image_bytes: bytes,
    mime_type: str = "image/png",
    extra_text: str = "",
) -> ExtractedDocument:
    """
    Send a document image to Gemini Vision and get a fully structured extraction + analysis.
    Falls back to empty ExtractedDocument if Gemini is unavailable.
    """
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return ExtractedDocument(
            warnings=["GEMINI_API_KEY not set — Gemini Vision analysis skipped."],
            gemini_verdict="needs_review",
            gemini_reasoning="Gemini API key not configured. Cannot perform document analysis.",
        )

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)

        # Build prompt — add any selectable text as extra context
        prompt_text = _GEMINI_PROMPT
        if extra_text.strip():
            prompt_text += f"\n\nSELECTABLE TEXT already extracted from PDF (use as reference, image is ground truth):\n{extra_text[:3000]}"

        # Build multimodal contents
        img_b64 = base64.standard_b64encode(image_bytes).decode()

        contents = [
            types.Content(
                role="user",
                parts=[
                    types.Part(
                        inline_data=types.Blob(
                            mime_type=mime_type,
                            data=img_b64,
                        )
                    ),
                    types.Part(text=prompt_text),
                ],
            )
        ]

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.0,  # deterministic
                # Note: no response_schema — Gemini rejects schemas with default values.
                # We parse the JSON manually and validate with Pydantic instead.
            ),
        )

        raw = response.text or ""
        # Strip markdown code fences if Gemini wraps response
        raw_clean = raw.strip()
        if raw_clean.startswith("```"):
            raw_clean = raw_clean.split("```", 2)[-1].lstrip("json").strip()
            if raw_clean.endswith("```"):
                raw_clean = raw_clean[:-3].strip()
        try:
            data = json.loads(raw_clean)
            # Map gemini_verdict to valid literal
            verdict = data.get("gemini_verdict", "needs_review")
            if verdict not in ("verified", "needs_review", "suspicious"):
                verdict = "needs_review"
            data["gemini_verdict"] = verdict
            # Parse subjects
            subjects = []
            for s in data.get("subjects", []):
                try:
                    subjects.append(SubjectRow(**{k: v for k, v in s.items() if k in SubjectRow.model_fields}))
                except Exception:
                    pass
            data["subjects"] = subjects
            data["extraction_method"] = "gemini"
            return ExtractedDocument.model_validate(data)
        except Exception as parse_err:
            return ExtractedDocument(
                warnings=[f"Gemini response parse error: {parse_err}", f"Raw: {raw[:300]}"],
                gemini_verdict="needs_review",
                gemini_reasoning="Could not parse Gemini response.",
                extraction_method="gemini_failed",
            )

    except Exception as err:
        return ExtractedDocument(
            warnings=[f"Gemini Vision call failed: {err}"],
            gemini_verdict="needs_review",
            gemini_reasoning=f"Gemini Vision unavailable: {err}",
            extraction_method="failed",
        )


# ── Build plain-language reasoning ───────────────────────────────────────────

def build_agent_reasoning(
    extracted: ExtractedDocument,
    validations: list,
    decision: str,
) -> "AgentReasoning":
    from .models import AgentReasoning

    passes = [v for v in validations if v.result == "pass"]
    fails  = [v for v in validations if v.result in ("mismatch", "missing")]

    # Confidence = Gemini consistency × (1 - AI score) × extraction completeness
    key_fields = [
        extracted.student_name, extracted.roll_number,
        extracted.exam_year, extracted.result_status,
    ]
    filled = sum(1 for f in key_fields if f)
    extraction_ratio = filled / len(key_fields)
    confidence = round(
        extracted.internal_consistency_score
        * (1.0 - extracted.ai_generation_score)
        * extraction_ratio,
        2,
    )
    confidence = max(0.0, min(1.0, confidence))

    # Build flag list
    flags: list[str] = []
    for sig in extracted.authenticity_signals:
        flags.append(f"✓ {sig}")
    for v in passes:
        flags.append(f"✓ {v.field}: {v.reason}")
    for sig in extracted.suspicion_signals:
        flags.append(f"⚠ {sig}")
    for issue in extracted.consistency_issues:
        flags.append(f"⚠ Consistency: {issue}")
    for v in fails:
        flags.append(f"✗ {v.field}: {v.reason}")
    for w in extracted.warnings[:3]:
        flags.append(f"ℹ {w}")

    if decision == "verified":
        summary = "Document verified — looks authentic and all fields are consistent."
        why = (
            extracted.gemini_reasoning
            or f"Gemini Vision analyzed the document and found it internally consistent "
               f"(score {extracted.internal_consistency_score:.0%}). "
               f"AI-generation likelihood is low ({extracted.ai_generation_score:.0%}). "
               f"Key fields were successfully extracted."
        )
    elif decision == "suspicious":
        summary = "Document flagged as suspicious — significant inconsistencies or AI-generation signals detected."
        why = (
            extracted.gemini_reasoning
            or f"Gemini Vision detected high AI-generation likelihood "
               f"({extracted.ai_generation_score:.0%}) or critical internal inconsistencies "
               f"(consistency score {extracted.internal_consistency_score:.0%}). "
               f"This requires close human review. This is NOT an auto-rejection."
        )
    else:
        summary = "Document requires manual review — some fields unclear or incomplete."
        why = (
            extracted.gemini_reasoning
            or f"The agent could not fully verify all fields automatically. "
               f"Extraction completeness: {extraction_ratio:.0%}. "
               f"A human reviewer should inspect the document."
        )

    return AgentReasoning(
        summary=summary,
        why_decision=why,
        flags=flags[:15],  # cap at 15 bullet points
        confidence_score=confidence,
    )
