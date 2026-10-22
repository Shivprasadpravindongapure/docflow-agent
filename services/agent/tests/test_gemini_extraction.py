import json
from types import SimpleNamespace

from services.agent.app.processing import extract

OCR_TEXT = "Name: Aarav Sharma\nRoll number: SYN27-0001\nDate of birth: 01/01/2005\nYear: 2024\nTotal marks: 300 / 500"


def test_gemini_values_are_schema_checked_and_grounded(monkeypatch):
    payload = {
        "name": "Aarav Sharma",
        "roll_number": "SYN27-9999",
        "dob": "2005-01-01",
        "board": None,
        "year": 2024,
        "total": 300,
        "result": None,
    }

    class FakeClient:
        def __init__(self, *, api_key, http_options):
            assert api_key == "test-key"
            assert http_options.timeout == 8_000
            self.models = self

        def generate_content(self, **kwargs):
            assert kwargs["model"] == "gemini-2.5-flash"
            return SimpleNamespace(text=json.dumps(payload))

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(extract.genai, "Client", FakeClient)

    result = extract.extract_fields(OCR_TEXT, provider="gemini")

    assert result.name == "Aarav Sharma"
    assert result.roll_number is None
    assert result.dob == "2005-01-01"
    assert result.warnings == [
        "The extracted roll_number was not found in OCR text and was discarded."
    ]


def test_gemini_rejects_non_integer_numeric_fields(monkeypatch):
    payload = {
        "name": None,
        "roll_number": None,
        "dob": None,
        "board": None,
        "year": True,
        "total": "300",
        "result": None,
    }

    class FakeClient:
        def __init__(self, *, api_key, http_options):
            assert http_options.timeout == 8_000
            self.models = self

        def generate_content(self, **kwargs):
            return SimpleNamespace(text=json.dumps(payload))

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(extract.genai, "Client", FakeClient)

    result = extract.extract_fields(OCR_TEXT, provider="gemini")

    assert result.year is None
    assert result.total is None
    assert result.warnings == [
        "Gemini response was invalid JSON or did not match the extraction schema."
    ]


def test_vision_response_ignores_model_authenticity_and_confidence_fields(monkeypatch):
    payload = {
        "student_name": "Synthetic Student",
        "exam_year": "2026",
        "ai_generation_score": 0.99,
        "internal_consistency_score": 0.01,
        "suspicion_signals": ["fabricated signal"],
        "authenticity_signals": ["fabricated authenticity"],
        "gemini_verdict": "suspicious",
        "gemini_reasoning": "model decision",
    }

    class FakeClient:
        def __init__(self, *, api_key, http_options):
            assert api_key == "test-key"
            assert http_options.timeout == 8_000
            self.models = self

        def generate_content(self, **kwargs):
            prompt = kwargs["contents"][0].parts[1].text
            assert "Do not decide authenticity, fraud, AI generation" in prompt
            return SimpleNamespace(text=json.dumps(payload))

    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(extract.genai, "Client", FakeClient)
    document = extract.gemini_vision_analyze(b"synthetic-image-bytes")
    assert document.student_name == "Synthetic Student"
    assert document.ai_generation_score is None
    assert document.internal_consistency_score is None
    assert document.suspicion_signals == []
    assert document.authenticity_signals == []
    assert document.gemini_verdict == "needs_review"
    assert document.gemini_reasoning is None
