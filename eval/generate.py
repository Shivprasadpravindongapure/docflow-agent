import argparse
import csv
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

_NAMES = [
    "Aarav Sharma", "Anaya Patel", "Ishaan Verma", "Diya Rao", "Kabir Mehta",
    "Myra Nair", "Vivaan Joshi", "Sara Khan", "Arjun Das", "Tara Iyer",
    "Reyansh Gupta", "Kiara Shah", "Aditya Bose", "Riya Menon", "Dev Malhotra",
    "Ira Kulkarni", "Neil Reddy", "Mira Thomas", "Ayaan Kapoor", "Zoya Sinha",
    "Rohan Desai", "Meera Pillai", "Yash Bhat", "Nina George", "Om Prakash",
    "Aisha Roy", "Kian Fernandes", "Pia Chawla", "Samar Gill", "Leela Krishnan",
    "Dhruv Jain", "Tia Dutta", "Manav Sethi", "Avni Shetty", "Ritvik Anand",
    "Nisha Paul", "Aarohi Sen", "Veer Oberoi", "Sana Mirza", "Kunal Yadav",
    "Ishita Ghosh", "Parth Sood", "Navya Menon", "Eshan Roy", "Amara Dsouza",
    "Rudra Sane", "Mahi Bansal", "Avi Chatterjee", "Sia Narang", "Neil Fernandes",
]
_MISMATCH_FIELDS = [
    "name", "roll_number", "dob", "board", "year", "total", "result", "name",
    "roll_number", "total",
]
_CSV_FIELDS = [
    "id", "name", "roll_number", "dob", "board", "year", "total", "result",
    "planted_mismatch", "form_name", "form_roll_number", "form_dob", "form_year",
    "form_total",
]


def _record(index: int) -> dict[str, str | int]:
    record: dict[str, str | int] = {
        "id": f"DF-2027-{index + 1:04d}",
        "name": _NAMES[index],
        "roll_number": f"SYN27-{index + 1:04d}",
        "dob": f"{2005 + index % 3}-{index % 12 + 1:02d}-{index % 27 + 1:02d}",
        "board": ("North State Board", "Central State Board", "Coastal State Board")[index % 3],
        "year": 2024 + index % 3,
        "total": 300 + index * 17 % 201,
        "result": "PASS WITH DISTINCTION" if index % 11 == 0 else "PASS",
        "planted_mismatch": "",
        "form_name": _NAMES[index],
        "form_roll_number": f"SYN27-{index + 1:04d}",
        "form_dob": f"{2005 + index % 3}-{index % 12 + 1:02d}-{index % 27 + 1:02d}",
        "form_year": 2024 + index % 3,
        "form_total": 300 + index * 17 % 201,
    }
    if index < len(_MISMATCH_FIELDS):
        field = _MISMATCH_FIELDS[index]
        record["planted_mismatch"] = field
        if field == "name":
            record["name"] = f"Synthetic {_NAMES[index]}"
        elif field == "roll_number":
            record["roll_number"] = f"ERR-{record['roll_number']}"
        elif field == "dob":
            record["dob"] = "2000-01-01"
        elif field == "board":
            record["board"] = "Sample Mismatch Board"
        elif field == "year":
            record["year"] = int(record["year"]) + 1
        elif field == "total":
            record["total"] = 499 if record["total"] == 500 else int(record["total"]) + 1
        elif field == "result":
            record["result"] = "SYNTHETIC REVIEW"
    return record


def _render(record: dict[str, str | int]) -> Image.Image:
    image = Image.new("RGB", (1200, 760), "white")
    draw = ImageDraw.Draw(image)
    font_title = ImageFont.load_default(size=34)
    font_body = ImageFont.load_default(size=27)
    font_label = ImageFont.load_default(size=25)

    draw.rectangle((28, 28, 1172, 732), outline="#254b45", width=4)
    draw.rectangle((30, 30, 1170, 158), fill="#254b45")
    draw.text((90, 68), "SYNTHETIC ACADEMIC RECORD", fill="white", font=font_title)
    draw.text(
        (90, 116),
        f"Sample board examination marksheet - {record['id']}",
        fill="#e4eee9",
        font=font_label,
    )

    rows = [
        ("Name", record["name"]),
        ("Roll number", record["roll_number"]),
        ("Date of birth", record["dob"]),
        ("Board", record["board"]),
        ("Year", record["year"]),
        ("Total marks", f"{record['total']} / 500"),
        ("Result", record["result"]),
    ]
    for index, (label, value) in enumerate(rows):
        y = 198 + index * 65
        draw.text((90, y), f"{label}:", fill="#254b45", font=font_label)
        draw.text((360, y), str(value), fill="#17211e", font=font_body)

    draw.line((90, 650, 1110, 650), fill="#cbd5cf", width=2)
    draw.text(
        (90, 675),
        "FOR SOFTWARE TESTING ONLY - NO REAL STUDENT DATA",
        fill="#63736d",
        font=font_label,
    )
    return image


def generate_dataset(output_directory: Path | str | None = None) -> tuple[Path, Path]:
    destination = Path(output_directory) if output_directory else Path(__file__).parent / "data"
    image_directory = destination / "images"
    image_directory.mkdir(parents=True, exist_ok=True)
    records = [_record(index) for index in range(len(_NAMES))]

    for record in records:
        _render(record).save(image_directory / f"{record['id']}.png", format="PNG")

    answer_key_path = destination / "answer_key.csv"
    with answer_key_path.open("w", encoding="utf-8", newline="") as answer_file:
        writer = csv.DictWriter(answer_file, fieldnames=_CSV_FIELDS)
        writer.writeheader()
        writer.writerows(records)
    return answer_key_path, image_directory


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic marksheets and an answer key.")
    parser.add_argument("--output-directory", type=Path, help="Write generated files to this directory.")
    arguments = parser.parse_args()
    answer_key_path, image_directory = generate_dataset(arguments.output_directory)
    print(f"Generated {len(_NAMES)} synthetic marksheets in {image_directory}")
    print(f"Wrote answer key to {answer_key_path}")


if __name__ == "__main__":
    main()
