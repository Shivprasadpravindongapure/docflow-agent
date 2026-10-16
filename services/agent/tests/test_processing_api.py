import json
from io import BytesIO

import fitz
from fastapi.testclient import TestClient
from PIL import Image

from services.agent.app.main import app
from services.agent.app.processing import pipeline
from services.agent.app.processing.ocr import OcrTimeoutError, OcrUnavailableError

client = TestClient(app)

APPLICATION = {
    "name": "Aarav Sharma",
    "roll_number": "SYN27-0001",
    "dob": "2005-01-01",
    "board": "North State Board",
    "year": 2024,
    "total": 300,
}
OCR_TEXT = """\
SYNTHETIC ACADEMIC RECORD
Name: Aarav Sharma
Roll number: SYN27-0001
Date of birth: 01/01/2005
Board: North State Board
Year: 2024
Total marks: 300 / 500
Result: PASS
"""


def make_pdf(*, scanned: bool = False, page_count: int = 1) -> bytes:
    document = fitz.open()
    for _ in range(page_count):
        page = document.new_page(width=595, height=842)
        if scanned:
            image = Image.new("RGB", (600, 800), "white")
            output = BytesIO()
            image.save(output, format="PNG")
            page.insert_image(page.rect, stream=output.getvalue())
        else:
            page.insert_textbox(
                page.rect + (40, 40, -40, -40),
                OCR_TEXT,
                fontsize=12,
            )
    return document.tobytes()


def make_png() -> bytes:
    image = Image.new("RGB", (300, 400), "white")
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def make_jpeg() -> bytes:
    image = Image.new("RGB", (300, 400), "white")
    output = BytesIO()
    image.save(output, format="JPEG")
    return output.getvalue()


def post_process(
    document: bytes,
    filename: str,
    content_type: str,
    application: str | None = None,
):
    data = {"application": application or json.dumps(APPLICATION)}
    return client.post(
        "/process",
        data=data,
        files={"file": (filename, document, content_type)},
    )


def assert_processing_response(response, *, decision: str, input_type: str) -> dict:
    assert response.status_code == 200
    result = response.json()
    assert result["input_type"] == input_type
    assert result["decision"] == decision
    assert {"document", "ocr", "extraction", "validation", "total"} == set(result["timings_ms"])
    assert all(value >= 0 for value in result["timings_ms"].values())
    assert result["ocr_text"]
    assert isinstance(result["extracted"]["warnings"], list)
    assert all(
        {"field", "expected", "extracted", "reason"} <= set(item)
        for item in result["validations"]
    )
    return result


def test_process_verified_text_pdf_returns_evidence_and_stage_timings():
    response = post_process(make_pdf(), "synthetic.pdf", "application/pdf")

    result = assert_processing_response(response, decision="verified", input_type="pdf")
    assert result["extracted"]["name"] == "Aarav Sharma"
    assert result["extracted"]["warnings"] == []
    assert {item["result"] for item in result["validations"]} == {"pass"}


def test_process_scanned_pdf_uses_ocr_and_routes_mismatch_to_review(monkeypatch):
    mismatch_text = OCR_TEXT.replace("SYN27-0001", "SYN27-9999")
    monkeypatch.setattr(pipeline, "run_ocr", lambda _image: mismatch_text)

    response = post_process(
        make_pdf(scanned=True),
        "synthetic-scan.pdf",
        "application/pdf",
    )

    result = assert_processing_response(response, decision="needs_review", input_type="pdf")
    roll_number = next(item for item in result["validations"] if item["field"] == "roll_number")
    assert roll_number["expected"] == "SYN27-0001"
    assert roll_number["extracted"] == "SYN27-9999"
    assert roll_number["result"] == "mismatch"


def test_process_image_returns_missing_state_without_auto_rejection(monkeypatch):
    monkeypatch.setattr(pipeline, "run_ocr", lambda _image: "Name: Aarav Sharma")

    response = post_process(make_png(), "synthetic.png", "image/png")

    result = assert_processing_response(response, decision="missing", input_type="image")
    assert any(item["result"] == "missing" for item in result["validations"])


def test_process_accepts_jpeg_uploads(monkeypatch):
    monkeypatch.setattr(pipeline, "run_ocr", lambda _image: OCR_TEXT)

    response = post_process(make_jpeg(), "synthetic.jpg", "image/jpeg")

    result = assert_processing_response(response, decision="verified", input_type="image")
    assert result["extracted"]["name"] == "Aarav Sharma"


def test_process_mixed_pdf_combines_selectable_text_and_scanned_ocr(monkeypatch):
    monkeypatch.setattr(pipeline, "run_ocr", lambda _image: OCR_TEXT)
    document = fitz.open()
    text_page = document.new_page(width=595, height=842)
    text_page.insert_textbox(text_page.rect + (40, 40, -40, -40), OCR_TEXT, fontsize=12)
    scan_page = document.new_page(width=595, height=842)
    image_output = BytesIO()
    Image.new("RGB", (600, 800), "white").save(image_output, format="PNG")
    scan_page.insert_image(scan_page.rect, stream=image_output.getvalue())

    response = post_process(document.tobytes(), "synthetic-mixed.pdf", "application/pdf")

    result = assert_processing_response(response, decision="verified", input_type="pdf")
    assert result["ocr_text"].count("Aarav Sharma") == 2


def test_process_rejects_unsupported_content_type():
    response = post_process(b"synthetic", "document.txt", "text/plain")

    assert response.status_code == 415


def test_process_rejects_invalid_image_bytes():
    response = post_process(b"not a PNG", "invalid.png", "image/png")

    assert response.status_code == 422


def test_process_rejects_oversized_upload():
    response = post_process(
        b"%PDF-" + b"x" * (2 * 1024 * 1024),
        "too-large.pdf",
        "application/pdf",
    )

    assert response.status_code == 413


def test_process_rejects_invalid_pdf_and_invalid_application_json():
    invalid_pdf = post_process(b"%PDF-invalid", "invalid.pdf", "application/pdf")
    invalid_application = post_process(
        make_pdf(),
        "synthetic.pdf",
        "application/pdf",
        application="{not json",
    )

    assert invalid_pdf.status_code == 422
    assert invalid_application.status_code == 422
    assert "input" not in json.dumps(invalid_application.json())


def test_process_rejects_pdf_with_too_many_pages():
    response = post_process(
        make_pdf(page_count=6),
        "too-many-pages.pdf",
        "application/pdf",
    )

    assert response.status_code == 413


def test_process_maps_ocr_dependency_failures_to_explicit_http_errors(monkeypatch):
    def missing_tesseract(_image):
        raise OcrUnavailableError("Tesseract is unavailable.")

    monkeypatch.setattr(pipeline, "run_ocr", missing_tesseract)
    unavailable = post_process(make_png(), "synthetic.png", "image/png")

    def timed_out(_image):
        raise OcrTimeoutError("Tesseract timed out.")

    monkeypatch.setattr(pipeline, "run_ocr", timed_out)
    timed_out_response = post_process(make_png(), "synthetic.png", "image/png")

    assert unavailable.status_code == 503
    assert timed_out_response.status_code == 504


def test_process_does_not_write_uploaded_documents(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(pipeline, "run_ocr", lambda _image: OCR_TEXT)

    response = post_process(make_png(), "synthetic.png", "image/png")

    assert response.status_code == 200
    assert list(tmp_path.iterdir()) == []
