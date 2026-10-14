import base64
from dataclasses import dataclass
from io import BytesIO

import fitz
import pdfplumber
from pdfminer.pdfdocument import PDFException
from pdfminer.pdfparser import PDFSyntaxError

MAX_PDF_BYTES = 2 * 1024 * 1024
MAX_PDF_PAGES = 5
RENDER_DPI = 150
MAX_RENDER_PIXELS = 4_000_000


class PdfProcessingError(ValueError):
    """An uploaded PDF is invalid or outside the supported limits."""


class PdfPageLimitError(PdfProcessingError):
    """The PDF contains more pages than the service is allowed to process."""


@dataclass(frozen=True)
class ExtractedPage:
    page_number: int
    text: str
    image_png_base64: str | None


@dataclass(frozen=True)
class ExtractedPdf:
    page_count: int
    pages: list[ExtractedPage]


def _render_page_as_png(page: fitz.Page) -> str:
    page_rect = page.rect
    if page_rect.width <= 0 or page_rect.height <= 0:
        raise PdfProcessingError("PDF contains a page with invalid dimensions.")

    scale = RENDER_DPI / 72
    pixel_count = page_rect.width * page_rect.height * scale * scale
    if pixel_count > MAX_RENDER_PIXELS:
        scale *= (MAX_RENDER_PIXELS / pixel_count) ** 0.5

    pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    png_bytes = pixmap.tobytes("png")
    return base64.b64encode(png_bytes).decode("ascii")


def extract_pdf(content: bytes) -> ExtractedPdf:
    if not content:
        raise PdfProcessingError("The uploaded PDF is empty.")
    if len(content) > MAX_PDF_BYTES:
        raise PdfProcessingError("The PDF must be no larger than 2 MB.")
    if not content.startswith(b"%PDF-"):
        raise PdfProcessingError("The uploaded file is not a valid PDF.")

    try:
        rendered_document = fitz.open(stream=content, filetype="pdf")
    except (fitz.FileDataError, RuntimeError) as error:
        raise PdfProcessingError("The uploaded file is not a readable PDF.") from error

    try:
        if rendered_document.needs_pass:
            raise PdfProcessingError("Password-protected PDFs are not supported.")

        page_count = rendered_document.page_count
        if page_count == 0:
            raise PdfProcessingError("The PDF must contain at least one page.")
        if page_count > MAX_PDF_PAGES:
            raise PdfPageLimitError("The PDF must contain no more than 5 pages.")

        pages: list[ExtractedPage] = []
        try:
            with pdfplumber.open(BytesIO(content)) as text_document:
                for page_index, (text_page, render_page) in enumerate(
                    zip(text_document.pages, rendered_document, strict=True),
                    start=1,
                ):
                    text = (text_page.extract_text() or "").strip()
                    image_png_base64 = (
                        None if text else _render_page_as_png(render_page)
                    )
                    pages.append(
                        ExtractedPage(
                            page_number=page_index,
                            text=text,
                            image_png_base64=image_png_base64,
                        )
                    )
        except PdfProcessingError:
            raise
        except (PDFException, PDFSyntaxError, OSError, ValueError, RuntimeError) as error:
            raise PdfProcessingError("The uploaded file is not a readable PDF.") from error

        return ExtractedPdf(page_count=page_count, pages=pages)
    finally:
        rendered_document.close()
