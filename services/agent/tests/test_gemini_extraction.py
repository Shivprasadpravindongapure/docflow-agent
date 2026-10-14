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
        def __init__(self, *, api_key):
            assert api_key == "test-key"
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
        def __init__(self, *, api_key):
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
