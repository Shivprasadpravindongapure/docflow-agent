import base64
from io import BytesIO

import fitz
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

from services.agent.app.main import app

client = TestClient(app)


def make_pdf(*, text: str | None = None, page_count: int = 1) -> bytes:
    document = fitz.open()
    for page_number in range(page_count):
        page = document.new_page(width=595, height=842)
        if text is not None:
            page.insert_text((72, 72), text, fontsize=14)
        else:
            image = Image.new("1", (600, 800), 1)
            draw = ImageDraw.Draw(image)
            draw.text((70, 100), "SYNTHETIC ACADEMIC RECORD", fill="black")
            draw.text((70, 170), "Name: Aarav Sharma", fill="black")
            draw.text((70, 230), "Roll number: SYN27-0001", fill="black")
            image_buffer = BytesIO()
            image.save(image_buffer, format="PNG", optimize=True)
            page.insert_image(page.rect, stream=image_buffer.getvalue())
    return document.tobytes()


def test_health_returns_agent_service_payload() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "agent"}


def test_extract_returns_selectable_text_for_text_pdf() -> None:
    pdf_bytes = make_pdf(text="Synthetic student: Aarav Sharma")

    response = client.post(
        "/extract",
        files={"file": ("synthetic.pdf", pdf_bytes, "application/pdf")},
    )

    assert response.status_code == 200
    result = response.json()
    assert result["page_count"] == 1
    assert result["pages"] == [
        {
            "page_number": 1,
            "text": "Synthetic student: Aarav Sharma",
            "image_png_base64": None,
        }
    ]


def test_extract_renders_image_only_page_as_png() -> None:
    response = client.post(
        "/extract",
        files={"file": ("synthetic-scan.pdf", make_pdf(), "application/pdf")},
    )

    assert response.status_code == 200
    result = response.json()
    assert result["page_count"] == 1
    page = result["pages"][0]
    assert page["page_number"] == 1
    assert page["text"] == ""
    png_bytes = base64.b64decode(page["image_png_base64"], validate=True)
    assert png_bytes.startswith(b"\x89PNG\r\n\x1a\n")


def test_extract_handles_text_and_scanned_pages_in_same_pdf() -> None:
    pdf = fitz.open()
    text_page = pdf.new_page(width=595, height=842)
    text_page.insert_text((72, 72), "Synthetic text page")
    scanned_page = pdf.new_page(width=595, height=842)
    image = Image.new("1", (600, 800), 1)
    ImageDraw.Draw(image).text((70, 100), "SYNTHETIC SCAN", fill="black")
    image_buffer = BytesIO()
    image.save(image_buffer, format="PNG", optimize=True)
    scanned_page.insert_image(scanned_page.rect, stream=image_buffer.getvalue())

    response = client.post(
        "/extract",
        files={"file": ("synthetic-mixed.pdf", pdf.tobytes(), "application/pdf")},
    )

    assert response.status_code == 200
    pages = response.json()["pages"]
    assert len(pages) == 2
    assert pages[0]["text"] == "Synthetic text page"
    assert pages[0]["image_png_base64"] is None
    assert pages[1]["text"] == ""
    assert pages[1]["image_png_base64"] is not None


def test_extract_rejects_unsupported_content_type() -> None:
    response = client.post(
        "/extract",
        files={"file": ("document.txt", b"synthetic", "text/plain")},
    )

    assert response.status_code == 415


def test_extract_rejects_invalid_pdf() -> None:
    response = client.post(
        "/extract",
        files={"file": ("invalid.pdf", b"%PDF-not-a-valid-document", "application/pdf")},
    )

    assert response.status_code == 422


def test_extract_rejects_empty_pdf() -> None:
    response = client.post(
        "/extract",
        files={"file": ("empty.pdf", b"", "application/pdf")},
    )

    assert response.status_code == 422


def test_extract_rejects_upload_over_two_megabytes() -> None:
    response = client.post(
        "/extract",
        files={
            "file": (
                "too-large.pdf",
                b"%PDF-" + b"x" * (2 * 1024 * 1024),
                "application/pdf",
            )
        },
    )

    assert response.status_code == 413


def test_extract_rejects_more_than_five_pages() -> None:
    response = client.post(
        "/extract",
        files={
            "file": (
                "too-many-pages.pdf",
                make_pdf(text="Synthetic page", page_count=6),
                "application/pdf",
            )
        },
    )

    assert response.status_code == 413


def test_extract_does_not_write_uploaded_files(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)

    response = client.post(
        "/extract",
        files={"file": ("synthetic.pdf", make_pdf(text="Synthetic record"), "application/pdf")},
    )

    assert response.status_code == 200
    assert list(tmp_path.iterdir()) == []
