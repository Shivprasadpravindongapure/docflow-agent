from __future__ import annotations

import argparse
import csv
import random
from pathlib import Path
from typing import Sequence

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

_NAMES = (
    "Aarav Sharma",
    "Anaya Patel",
    "Ishaan Verma",
    "Diya Rao",
    "Kabir Mehta",
    "Myra Nair",
    "Vivaan Joshi",
    "Sara Khan",
    "Arjun Das",
    "Tara Iyer",
    "Reyansh Gupta",
    "Kiara Shah",
    "Aditya Bose",
    "Riya Menon",
    "Dev Malhotra",
    "Ira Kulkarni",
    "Neil Reddy",
    "Mira Thomas",
    "Ayaan Kapoor",
    "Zoya Sinha",
    "Rohan Desai",
    "Meera Pillai",
    "Yash Bhat",
    "Nina George",
    "Om Prakash",
    "Aisha Roy",
    "Kian Fernandes",
    "Pia Chawla",
    "Samar Gill",
    "Leela Krishnan",
    "Dhruv Jain",
    "Tia Dutta",
    "Manav Sethi",
    "Avni Shetty",
    "Ritvik Anand",
    "Nisha Paul",
    "Aarohi Sen",
    "Veer Oberoi",
    "Sana Mirza",
    "Kunal Yadav",
    "Ishita Ghosh",
    "Parth Sood",
    "Navya Menon",
    "Eshan Roy",
    "Amara Dsouza",
    "Rudra Sane",
    "Mahi Bansal",
    "Avi Chatterjee",
    "Sia Narang",
    "Neil Fernandes",
)
_MISMATCH_FIELDS = (
    "name",
    "roll_number",
    "dob",
    "board",
    "year",
    "total",
    "result",
    "name",
    "roll_number",
    "total",
)
CSV_COLUMNS = (
    "id",
    "name",
    "roll_number",
    "dob",
    "board",
    "year",
    "total",
    "result",
    "planted_mismatch",
    "form_name",
    "form_roll_number",
    "form_dob",
    "form_year",
    "form_total",
)
_TEXT_PDF_COUNT = 30
_SCANNED_PDF_COUNT = len(_NAMES) - _TEXT_PDF_COUNT
_PAGE_SIZE = A4
_PAGE_WIDTH, _PAGE_HEIGHT = _PAGE_SIZE
_INK = colors.HexColor("#254b45")


def _make_record(index: int) -> dict[str, str | int]:
    form_year = 2024 + index % 3
    form_total = 300 + (index * 17) % 201
    form_dob = (
        f"{2005 + index % 3}-{index % 12 + 1:02d}-{index % 27 + 1:02d}"
    )
    record: dict[str, str | int] = {
        "id": f"DF-2027-{index + 1:04d}",
        "name": _NAMES[index],
        "roll_number": f"SYN27-{index + 1:04d}",
        "dob": form_dob,
        "board": ("North State Board", "Central State Board", "Coastal State Board")[index % 3],
        "year": form_year,
        "total": form_total,
        "result": "PASS WITH DISTINCTION" if index % 11 == 0 else "PASS",
        "planted_mismatch": "",
        "form_name": _NAMES[index],
        "form_roll_number": f"SYN27-{index + 1:04d}",
        "form_dob": form_dob,
        "form_year": form_year,
        "form_total": form_total,
    }

    if index < len(_MISMATCH_FIELDS):
        mismatch = _MISMATCH_FIELDS[index]
        record["planted_mismatch"] = mismatch
        if mismatch == "name":
            record["name"] = f"Synthetic {_NAMES[index]}"
        elif mismatch == "roll_number":
            record["roll_number"] = f"ERR-{record['roll_number']}"
        elif mismatch == "dob":
            record["dob"] = "2000-01-01"
        elif mismatch == "board":
            record["board"] = "Sample Mismatch Board"
        elif mismatch == "year":
            record["year"] = int(record["year"]) + 1
        elif mismatch == "total":
            record["total"] = 499 if record["total"] == 500 else int(record["total"]) + 1
        elif mismatch == "result":
            record["result"] = "SYNTHETIC REVIEW"

    return record


def _field_rows(record: dict[str, str | int]) -> Sequence[tuple[str, str]]:
    return (
        ("Name", str(record["name"])),
        ("Roll number", str(record["roll_number"])),
        ("Date of birth", str(record["dob"])),
        ("Board", str(record["board"])),
        ("Year", str(record["year"])),
        ("Total marks", f"{record['total']} / 500"),
        ("Result", str(record["result"])),
    )


def _draw_page_header(
    pdf: canvas.Canvas, record: dict[str, str | int], *, raster: bool
) -> None:
    pdf.setFillColor(_INK)
    pdf.roundRect(35, _PAGE_HEIGHT - 150, _PAGE_WIDTH - 70, 105, 8, fill=1, stroke=0)
    pdf.setFillColor(colors.white)
    pdf.setFont("Helvetica-Bold", 17)
    pdf.drawString(58, _PAGE_HEIGHT - 83, "SYNTHETIC ACADEMIC RECORD")
    pdf.setFont("Helvetica", 10)
    pdf.drawString(
        58,
        _PAGE_HEIGHT - 112,
        f"Sample board examination marksheet - {record['id']}",
    )
    if raster:
        pdf.setFillColor(colors.HexColor("#64736d"))
        pdf.setFont("Helvetica-Bold", 8)
        pdf.drawCentredString(
            _PAGE_WIDTH / 2,
            28,
            "FOR SOFTWARE TESTING ONLY - NO REAL STUDENT DATA",
        )


def _render_text_pdf(pdf: canvas.Canvas, record: dict[str, str | int]) -> None:
    _draw_page_header(pdf, record, raster=False)
    label_x = 58
    value_x = 190
    row_y = _PAGE_HEIGHT - 205
    row_gap = 43

    for index, (label, value) in enumerate(_field_rows(record)):
        y = row_y - index * row_gap
        pdf.setFillColor(_INK)
        pdf.setFont("Helvetica-Bold", 11)
        pdf.drawString(label_x, y, f"{label}:")
        pdf.setFillColor(colors.HexColor("#17211e"))
        pdf.setFont("Helvetica", 12)
        pdf.drawString(value_x, y, value)
        pdf.setStrokeColor(colors.HexColor("#d8dfdb"))
        pdf.setLineWidth(0.5)
        pdf.line(label_x, y - 12, _PAGE_WIDTH - 58, y - 12)

    pdf.setFillColor(colors.HexColor("#64736d"))
    pdf.setFont("Helvetica-Bold", 8)
    pdf.drawCentredString(
        _PAGE_WIDTH / 2,
        28,
        "FOR SOFTWARE TESTING ONLY - NO REAL STUDENT DATA",
    )
    pdf.showPage()


def _render_scanned_page(record: dict[str, str | int]) -> Image.Image:
    image = Image.new("RGB", (1240, 1754), (250, 250, 247))
    draw = ImageDraw.Draw(image)
    label_font = ImageFont.load_default(size=30)
    value_font = ImageFont.load_default(size=32)
    title_font = ImageFont.load_default(size=40)
    subtitle_font = ImageFont.load_default(size=22)

    draw.rounded_rectangle((72, 72, 1168, 1682), radius=12, fill="white", outline="#254b45", width=5)
    draw.rectangle((78, 78, 1162, 328), fill="#254b45")
    draw.text((132, 148), "SYNTHETIC ACADEMIC RECORD", fill="white", font=title_font)
    draw.text(
        (132, 220),
        f"Sample board examination marksheet - {record['id']}",
        fill="#e4eee9",
        font=subtitle_font,
    )

    start_y = 405
    row_gap = 150
    for index, (label, value) in enumerate(_field_rows(record)):
        y = start_y + index * row_gap
        draw.text((132, y), f"{label}:", fill="#254b45", font=label_font)
        draw.text((440, y), value, fill="#17211e", font=value_font)
        draw.line((132, y + 70, 1100, y + 70), fill="#d8dfdb", width=2)

    draw.line((132, 1510, 1100, 1510), fill="#cbd5cf", width=3)
    draw.text(
        (132, 1555),
        "FOR SOFTWARE TESTING ONLY - NO REAL STUDENT DATA",
        fill="#63736d",
        font=label_font,
    )
    return image


def _render_scanned_pdf(pdf: canvas.Canvas, record: dict[str, str | int]) -> None:
    page_image = _render_scanned_page(record)
    pdf.drawImage(
        ImageReader(page_image),
        0,
        0,
        width=_PAGE_WIDTH,
        height=_PAGE_HEIGHT,
        preserveAspectRatio=True,
        anchor="c",
    )
    pdf.showPage()


def _write_pdf(
    destination: Path, record: dict[str, str | int], *, scanned: bool
) -> None:
    pdf = canvas.Canvas(
        str(destination),
        pagesize=_PAGE_SIZE,
        pageCompression=0,
        invariant=1,
    )
    pdf.setTitle(f"Synthetic Marksheet {record['id']}")
    pdf.setAuthor("DocFlow Synthetic Dataset Generator")
    pdf.setSubject("Synthetic marksheet for software testing only")
    pdf.setCreator("DocFlow Agent")
    if scanned:
        _render_scanned_pdf(pdf, record)
    else:
        _render_text_pdf(pdf, record)
    pdf.save()


def generate_pdfs(output_directory: Path, seed: int = 2027) -> tuple[Path, Path]:
    if seed < 0:
        raise ValueError("seed must be a non-negative integer")

    output_directory = Path(output_directory)
    pdf_directory = output_directory / "pdfs"
    pdf_directory.mkdir(parents=True, exist_ok=True)

    rng = random.Random(seed)
    scanned_indexes = set(rng.sample(range(len(_NAMES)), _SCANNED_PDF_COUNT))
    records = [_make_record(index) for index in range(len(_NAMES))]

    for index, record in enumerate(records):
        pdf_path = pdf_directory / f"{record['id']}.pdf"
        _write_pdf(pdf_path, record, scanned=index in scanned_indexes)

    answer_key_path = output_directory / "pdf_answer_key.csv"
    with answer_key_path.open("w", encoding="utf-8", newline="") as answer_key:
        writer = csv.DictWriter(
            answer_key,
            fieldnames=CSV_COLUMNS,
            lineterminator="\n",
            extrasaction="raise",
        )
        writer.writeheader()
        writer.writerows(records)

    return answer_key_path, pdf_directory


def _default_data_directory() -> Path:
    return Path(__file__).resolve().parents[1] / "data"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate a reproducible set of synthetic marksheet PDFs."
    )
    parser.add_argument("--seed", type=int, default=2027)
    parser.add_argument(
        "--output-directory",
        type=Path,
        default=_default_data_directory(),
        help="Output directory (default: eval/data)",
    )
    args = parser.parse_args()

    answer_key_path, pdf_directory = generate_pdfs(args.output_directory, args.seed)
    print(
        f"Generated {_TEXT_PDF_COUNT} text-based and {_SCANNED_PDF_COUNT} "
        f"image-only synthetic PDFs in {pdf_directory}"
    )
    print(f"Wrote {len(_NAMES)} answer-key rows to {answer_key_path}")
    print(f"Seed: {args.seed}")


if __name__ == "__main__":
    main()
