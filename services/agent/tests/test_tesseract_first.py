from io import BytesIO

from PIL import Image

from services.agent.app.processing import pipeline
from services.agent.app.processing.models import ApplicationForm, ExtractedDocument
from services.agent.app.processing.ocr import OcrUnavailableError


OCR_TEXT = """Name: Aarav Sharma
Roll number: SYN27-0001
Date of birth: 01/01/2005
Board: North State Board
Year: 2024
Total marks: 300 / 500
Result: PASS
"""


def png_bytes() -> bytes:
    image = Image.new("RGB", (100, 50), "white")
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def application() -> ApplicationForm:
    return ApplicationForm(
        name="Aarav Sharma", roll_number="SYN27-0001", dob="2005-01-01",
        board="North State Board", year=2024, total=300,
    )


def test_usable_tesseract_text_skips_gemini(monkeypatch):
    gemini_calls = []
    monkeypatch.setattr(pipeline, "run_ocr", lambda _image: OCR_TEXT)
    monkeypatch.setattr(
        pipeline, "gemini_vision_analyze",
        lambda *_args, **_kwargs: gemini_calls.append(True),
    )

    result = pipeline.analyze_document(png_bytes(), application(), content_type="image/png")

    assert result.extracted.name == "Aarav Sharma"
    assert result.extracted.roll_number == "SYN27-0001"
    assert result.ocr_text == OCR_TEXT
    assert gemini_calls == []


def test_tesseract_failure_uses_gemini_fallback(monkeypatch):
    gemini_calls = []
    monkeypatch.setattr(
        pipeline, "run_ocr",
        lambda _image: (_ for _ in ()).throw(OcrUnavailableError("Tesseract unavailable")),
    )

    def gemini(*_args, **_kwargs):
        gemini_calls.append(True)
        return ExtractedDocument(student_name="Aarav Sharma", extraction_method="gemini")

    monkeypatch.setattr(pipeline, "gemini_vision_analyze", gemini)

    result = pipeline.analyze_document(png_bytes(), application(), content_type="image/png")

    assert result.extracted.name == "Aarav Sharma"
    assert gemini_calls == [True]
    assert any("Tesseract unavailable" in warning for warning in result.extracted.warnings)


def test_unusable_tesseract_text_uses_gemini_fallback(monkeypatch):
    gemini_calls = []
    monkeypatch.setattr(pipeline, "run_ocr", lambda _image: "unlabelled noise")
    monkeypatch.setattr(
        pipeline, "gemini_vision_analyze",
        lambda *_args, **_kwargs: gemini_calls.append(True) or ExtractedDocument(extraction_method="gemini"),
    )

    pipeline.analyze_document(png_bytes(), application(), content_type="image/png")

    assert gemini_calls == [True]
