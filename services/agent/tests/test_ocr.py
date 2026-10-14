from io import BytesIO

from PIL import Image
import pytest

from services.agent.app.processing.ocr import InvalidImageError, OcrUnavailableError, preprocess_image, run_ocr


def png_bytes() -> bytes:
    image = Image.new("RGB", (100, 40), "white")
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def test_preprocessing_decodes_and_converts_image_to_binary_grayscale():
    result = preprocess_image(png_bytes())

    assert result.mode == "L"
    assert result.size == (100, 40)
    assert set(result.tobytes()) <= {0, 255}


def test_preprocessing_rejects_non_image_bytes():
    with pytest.raises(InvalidImageError, match="not a valid PNG or JPEG"):
        preprocess_image(b"not an image")


def test_ocr_reports_tesseract_missing(monkeypatch):
    import services.agent.app.processing.ocr as ocr

    def no_tesseract(*_args, **_kwargs):
        raise ocr.pytesseract.TesseractNotFoundError()

    monkeypatch.setattr(ocr.pytesseract, "image_to_string", no_tesseract)
    with pytest.raises(OcrUnavailableError, match="Install Tesseract"):
        run_ocr(png_bytes())
