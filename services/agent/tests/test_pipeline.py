from services.agent.app.processing.models import ApplicationForm
from services.agent.app.processing import pipeline

OCR_TEXT = """\
Name: Aarav Sharma
Roll number: SYN27-0001
Date of birth: 01/01/2005
Board: North State Board
Year: 2024
Total marks: 300 / 500
Result: PASS
"""


def test_pipeline_runs_ocr_extraction_validation_and_decision(monkeypatch):
    monkeypatch.setattr(pipeline, "run_ocr", lambda _image: OCR_TEXT)
    application = ApplicationForm(
        name="Aarav Sharma",
        roll_number="SYN27-0001",
        dob="2005-01-01",
        board="North State Board",
        year=2024,
        total=300,
    )

    result = pipeline.analyze_document(b"synthetic image", application, provider="regex")

    assert result.ocr_text == OCR_TEXT
    assert result.extracted.name == "Aarav Sharma"
    assert all(item.result == "pass" for item in result.validations)
    assert result.decision == "verified"
    assert set(result.timings_ms) == {"ocr", "extraction", "validation", "total"}
    assert all(value >= 0 for value in result.timings_ms.values())
