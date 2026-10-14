import json
import os
import re

from google import genai
from pydantic import ValidationError

from .models import ExtractedFields, ExtractionValues, normalize_date

_FIELD_LABELS = {
    "name": r"name",
    "roll_number": r"roll(?:\s*(?:number|no\.?))",
    "dob": r"(?:date\s+of\s+birth|dob)",
    "board": r"board",
    "year": r"(?:exam\s+)?year",
    "total": r"(?:total\s+marks|total)",
    "result": r"result",
}


def _label_value(text: str, label_pattern: str) -> str | None:
    match = re.search(
        rf"^\s*(?:{label_pattern})\s*[:=-]\s*(.*?)\s*$",
        text,
        flags=re.IGNORECASE | re.MULTILINE,
    )
    return match.group(1).strip() if match else None


def _parse_integer(value: str | None) -> int | None:
    if value is None:
        return None
    match = re.search(r"(?<!\d)\d+(?!\d)", value.replace(",", ""))
    return int(match.group()) if match else None


def _regex_extract(ocr_text: str) -> ExtractedFields:
    raw = {field: _label_value(ocr_text, label) for field, label in _FIELD_LABELS.items()}
    dob = normalize_date(raw["dob"]) if raw["dob"] else None
    year = _parse_integer(raw["year"])
    total = _parse_integer(raw["total"])
    extracted = ExtractedFields(
        name=raw["name"] or None,
        roll_number=raw["roll_number"] or None,
        dob=dob,
        board=raw["board"] or None,
        year=year,
        total=total,
        result=raw["result"] or None,
    )
    for field in ("name", "roll_number", "dob", "board", "year", "total", "result"):
        if raw[field] is None:
            extracted.warnings.append(f"The {field} field was not found in OCR text.")
        elif field == "dob" and dob is None:
            extracted.warnings.append("The date of birth was not a valid supported date.")
        elif field == "year" and year is None:
            extracted.warnings.append("The year field did not contain an integer.")
        elif field == "total" and total is None:
            extracted.warnings.append("The total field did not contain an integer.")
    return extracted


def _normalize_for_grounding(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.casefold())


def _date_is_grounded(value: str, ocr_text: str) -> bool:
    for candidate in re.findall(r"\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})\b", ocr_text):
        if normalize_date(candidate) == normalize_date(value):
            return True
    return False


def _grounded_extraction(values: ExtractionValues, ocr_text: str) -> ExtractedFields:
    extracted = ExtractedFields(**values.model_dump())
    normalized_text = _normalize_for_grounding(ocr_text)

    for field in ("name", "roll_number", "board", "result"):
        value = getattr(extracted, field)
        if value is not None and _normalize_for_grounding(value) not in normalized_text:
            setattr(extracted, field, None)
            extracted.warnings.append(f"The extracted {field} was not found in OCR text and was discarded.")

    if extracted.dob is not None and not _date_is_grounded(extracted.dob, ocr_text):
        extracted.dob = None
        extracted.warnings.append("The extracted dob was not found in OCR text and was discarded.")

    for field in ("year", "total"):
        value = getattr(extracted, field)
        if value is not None and re.search(rf"(?<!\d){value}(?!\d)", ocr_text) is None:
            setattr(extracted, field, None)
            extracted.warnings.append(f"The extracted {field} was not found as a standalone number and was discarded.")
    return extracted


def _gemini_extract(ocr_text: str) -> ExtractedFields:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY must be set when EXTRACTION_PROVIDER=gemini.")

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=(
            "Extract the marksheet fields from the OCR text. Return null for missing values. "
            "Do not infer or invent values. dob must be YYYY-MM-DD. "
            "Return JSON with name, roll_number, dob, board, year, total, result.\n\n"
            f"OCR text:\n{ocr_text}"
        ),
        config={
            "response_mime_type": "application/json",
            "response_schema": ExtractionValues,
        },
    )

    try:
        values = ExtractionValues.model_validate_json(response.text or "")
    except (ValidationError, ValueError, json.JSONDecodeError):
        return ExtractedFields(
            name=None,
            roll_number=None,
            dob=None,
            board=None,
            year=None,
            total=None,
            result=None,
            warnings=["Gemini response was invalid JSON or did not match the extraction schema."],
        )
    return _grounded_extraction(values, ocr_text)


def extract_fields(ocr_text: str, provider: str | None = None) -> ExtractedFields:
    selected_provider = (provider or os.getenv("EXTRACTION_PROVIDER", "regex")).strip().casefold()
    if selected_provider == "regex":
        return _regex_extract(ocr_text)
    if selected_provider == "gemini":
        return _gemini_extract(ocr_text)
    raise ValueError(f"Unsupported EXTRACTION_PROVIDER: {selected_provider}")
