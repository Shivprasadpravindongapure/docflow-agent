from io import BytesIO
import subprocess

from PIL import Image, ImageOps, UnidentifiedImageError
import pytesseract

MAX_IMAGE_PIXELS = 4_000_000


class InvalidImageError(ValueError):
    pass


class OcrUnavailableError(RuntimeError):
    pass


class OcrTimeoutError(RuntimeError):
    pass


def preprocess_image(image_bytes: bytes) -> Image.Image:
    try:
        with Image.open(BytesIO(image_bytes)) as source:
            if source.format not in {"PNG", "JPEG"}:
                raise InvalidImageError("Only PNG and JPEG images are supported.")
            if source.width * source.height > MAX_IMAGE_PIXELS:
                raise InvalidImageError("Images must contain no more than 4 million pixels.")
            source.load()
            grayscale = ImageOps.grayscale(ImageOps.exif_transpose(source))
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError) as error:
        raise InvalidImageError("The uploaded file is not a valid PNG or JPEG image.") from error

    enhanced = ImageOps.autocontrast(grayscale)
    return enhanced.point(lambda value: 255 if value > 160 else 0)


def run_ocr(image_bytes: bytes) -> str:
    image = preprocess_image(image_bytes)
    try:
        return pytesseract.image_to_string(image, config="--psm 6", timeout=30).strip()
    except pytesseract.TesseractNotFoundError as error:
        raise OcrUnavailableError(
            "Tesseract OCR was not found. Install Tesseract and make sure its executable is on PATH."
        ) from error
    except subprocess.TimeoutExpired as error:
        raise OcrTimeoutError("Tesseract OCR exceeded the 30-second processing limit.") from error
