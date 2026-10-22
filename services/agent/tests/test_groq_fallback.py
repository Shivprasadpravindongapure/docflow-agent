import json
import sys
from types import SimpleNamespace

from services.agent.app.processing import pipeline
from services.agent.app.processing.groq_fallback import extract_fields_groq
from services.agent.app.processing.models import ApplicationForm, ExtractedDocument
from services.agent.app.processing.ocr import OcrUnavailableError
from services.agent.tests.test_tesseract_first import application, png_bytes


def test_groq_extracts_only_values_grounded_in_ocr_text(monkeypatch):
    ocr_text = "Name: Synthetic Student\nRoll number: SYN-0001\nYear: 2026\nTotal marks: 400"

    class FakeGroq:
        def __init__(self, *, api_key, timeout, max_retries):
            assert api_key == "synthetic-key"
            assert timeout == 8.0
            assert max_retries == 0
            self.chat = SimpleNamespace(completions=self)

        def create(self, **kwargs):
            assert kwargs["model"] == "openai/gpt-oss-20b"
            assert kwargs["messages"][1]["content"] == ocr_text
            assert kwargs["response_format"] == {"type": "json_object"}
            payload = {
                "name": "Synthetic Student", "roll_number": "SYN-9999", "board": None,
                "dob": None, "year": 2026, "total": 500, "result": None,
            }
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(payload)))])

    monkeypatch.setenv("GROQ_API_KEY", "synthetic-key")
    monkeypatch.setitem(sys.modules, "groq", SimpleNamespace(Groq=FakeGroq))
    result = extract_fields_groq(ocr_text)
    assert result.name == "Synthetic Student"
    assert result.roll_number is None
    assert result.year == 2026
    assert result.total is None
    assert any("roll_number was not grounded" in warning for warning in result.warnings)
    assert any("total was not a grounded integer" in warning for warning in result.warnings)


def test_groq_skips_cleanly_without_key_or_ocr_text(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    no_key = extract_fields_groq("Name: Synthetic Student")
    empty = extract_fields_groq("  ")
    assert "GROQ_API_KEY" in no_key.warnings[0]
    assert "no OCR text" in empty.warnings[0]


def test_groq_failure_does_not_expose_provider_error_text(monkeypatch):
    class FailingGroq:
        def __init__(self, **_kwargs):
            self.chat = SimpleNamespace(completions=self)

        def create(self, **_kwargs):
            raise RuntimeError("private response: SYNTHETIC_SECRET")

    monkeypatch.setenv("GROQ_API_KEY", "synthetic-key")
    monkeypatch.setitem(sys.modules, "groq", SimpleNamespace(Groq=FailingGroq))
    result = extract_fields_groq("Name: Synthetic Student")
    assert result.warnings == ["Groq text fallback failed (RuntimeError)."]
    assert "SYNTHETIC_SECRET" not in " ".join(result.warnings)


def test_groq_runs_only_after_gemini_has_no_usable_fields(monkeypatch):
    monkeypatch.setattr(pipeline, "run_ocr", lambda _image: "unlabelled candidate Synthetic Student year 2026")
    monkeypatch.setattr(
        pipeline, "gemini_vision_analyze",
        lambda *_args, **_kwargs: ExtractedDocument(extraction_method="gemini_failed"),
    )
    calls = []
    original = pipeline.extract_fields

    def extract(text, *, provider="regex"):
        if provider == "groq":
            calls.append(text)
            return original_fields()
        return original(text, provider=provider)

    def original_fields():
        from services.agent.app.processing.models import ExtractedFields
        return ExtractedFields(
            name="Synthetic Student", roll_number=None, dob=None, board=None,
            year=2026, total=None, result=None,
        )

    monkeypatch.setattr(pipeline, "extract_fields", extract)
    result = pipeline.analyze_document(png_bytes(), application(), content_type="image/png")
    assert result.extracted_document.extraction_method == "groq"
    assert result.extracted.name == "Synthetic Student"
    assert calls == ["unlabelled candidate Synthetic Student year 2026"]


def test_groq_is_not_called_when_tesseract_fields_are_usable(monkeypatch):
    monkeypatch.setattr(pipeline, "run_ocr", lambda _image: "Name: Synthetic Student\nYear: 2026")
    monkeypatch.setattr(
        pipeline, "extract_fields",
        lambda text, *, provider="regex": (
            __import__("services.agent.app.processing.extract", fromlist=["extract_fields"]).extract_fields(text)
            if provider == "regex" else (_ for _ in ()).throw(AssertionError("Groq should not run"))
        ),
    )
    monkeypatch.setattr(pipeline, "gemini_vision_analyze", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("Gemini should not run")))
    result = pipeline.analyze_document(png_bytes(), application(), content_type="image/png")
    assert result.extracted_document.extraction_method == "tesseract"


def test_groq_is_not_called_without_ocr_text(monkeypatch):
    monkeypatch.setattr(pipeline, "run_ocr", lambda _image: (_ for _ in ()).throw(OcrUnavailableError("Tesseract unavailable")))
    monkeypatch.setattr(pipeline, "gemini_vision_analyze", lambda *_args, **_kwargs: ExtractedDocument(extraction_method="failed"))
    original = pipeline.extract_fields

    def extract(text, *, provider="regex"):
        if provider == "groq":
            raise AssertionError("Groq must not run with no OCR text")
        return original(text, provider=provider)

    monkeypatch.setattr(pipeline, "extract_fields", extract)
    result = pipeline.analyze_document(png_bytes(), application(), content_type="image/png")
    assert result.extracted_document.extraction_method == "failed"
    assert any("Groq text fallback skipped" in warning for warning in result.extracted_document.warnings)
