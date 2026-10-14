from services.agent.app.processing.extract import extract_fields

OCR_TEXT = """\
SYNTHETIC ACADEMIC RECORD
Name: Aarav Sharma
Roll number: SYN27-0001
Date of birth: 01/01/2005
Board: North State Board
Year: 2024
Total marks: 300 / 500
Result: PASS WITH DISTINCTION
"""


def test_regex_extraction_reads_all_labelled_fields():
    result = extract_fields(OCR_TEXT, provider="regex")

    assert result.model_dump() == {
        "name": "Aarav Sharma",
        "roll_number": "SYN27-0001",
        "dob": "2005-01-01",
        "board": "North State Board",
        "year": 2024,
        "total": 300,
        "result": "PASS WITH DISTINCTION",
        "warnings": [],
    }


def test_regex_extraction_reports_missing_and_invalid_values():
    result = extract_fields("Name: Example Student\nDate of birth: 31/02/2005", provider="regex")

    assert result.name == "Example Student"
    assert result.dob is None
    assert result.year is None
    assert "The date of birth was not a valid supported date." in result.warnings
    assert "The year field was not found in OCR text." in result.warnings


def test_unknown_provider_is_an_explicit_error():
    try:
        extract_fields(OCR_TEXT, provider="unknown")
    except ValueError as error:
        assert "Unsupported EXTRACTION_PROVIDER" in str(error)
    else:
        raise AssertionError("An unsupported provider must fail explicitly.")


def test_gemini_requires_an_api_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    try:
        extract_fields(OCR_TEXT, provider="gemini")
    except ValueError as error:
        assert "GEMINI_API_KEY must be set" in str(error)
    else:
        raise AssertionError("Gemini extraction must not run without a key.")
