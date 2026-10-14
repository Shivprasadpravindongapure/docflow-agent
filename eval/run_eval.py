import argparse
import csv
import sys
from pathlib import Path
from time import perf_counter
from typing import Callable

from services.agent.app.processing.models import ApplicationForm, ExtractedFields
from services.agent.app.processing.ocr import OcrUnavailableError
from services.agent.app.processing.pipeline import ProcessingResult, analyze_document

_FIELD_NAMES = ("name", "roll_number", "dob", "board", "year", "total", "result")
_COMPARABLE_FIELDS = {"name", "roll_number", "dob", "year", "total"}
_TIMING_STAGES = ("ocr", "extraction", "validation", "total")


def _normalized(field: str, value: object) -> str | int | None:
    if value is None:
        return None
    if field in {"year", "total"}:
        return int(value)
    text = str(value).strip().casefold()
    if field == "roll_number":
        return "".join(character for character in text if character.isalnum())
    return " ".join(text.split())


def _application(row: dict[str, str]) -> ApplicationForm:
    return ApplicationForm(
        name=row["form_name"],
        roll_number=row["form_roll_number"],
        dob=row["form_dob"],
        year=int(row["form_year"]),
        total=int(row["form_total"]),
    )


def run_evaluation(
    data_directory: Path | str | None = None,
    results_directory: Path | str | None = None,
    processor: Callable[[bytes, ApplicationForm], ProcessingResult] = analyze_document,
) -> dict[str, int | float]:
    data_path = Path(data_directory) if data_directory else Path(__file__).parent / "data"
    results_path = Path(results_directory) if results_directory else Path(__file__).parent / "results"
    answer_key_path = data_path / "answer_key.csv"
    if not answer_key_path.is_file():
        raise FileNotFoundError(f"Synthetic answer key not found: {answer_key_path}. Run python -m eval.generate first.")

    with answer_key_path.open(encoding="utf-8", newline="") as answer_file:
        rows = list(csv.DictReader(answer_file))
    if not rows:
        raise ValueError(f"Synthetic answer key contains no rows: {answer_key_path}.")

    correct_fields = 0
    field_count = len(rows) * len(_FIELD_NAMES)
    false_flags = 0
    comparable_planted = 0
    detected_planted = 0
    unscored_planted = 0
    timing_totals = dict.fromkeys(_TIMING_STAGES, 0.0)
    wall_started = perf_counter()

    for row in rows:
        image_path = data_path / "images" / f"{row['id']}.png"
        if not image_path.is_file():
            raise FileNotFoundError(f"Synthetic marksheet image not found: {image_path}.")

        result = processor(image_path.read_bytes(), _application(row))
        for field in _FIELD_NAMES:
            expected: object = row[field]
            if field in {"year", "total"}:
                expected = int(str(expected))
            observed = getattr(result.extracted, field)
            if _normalized(field, expected) == _normalized(field, observed):
                correct_fields += 1

        if not row["planted_mismatch"] and result.decision != "verified":
            false_flags += 1

        planted_field = row["planted_mismatch"]
        if planted_field:
            if planted_field in _COMPARABLE_FIELDS:
                comparable_planted += 1
                if any(
                    item.field == planted_field and item.result == "mismatch"
                    for item in result.validations
                ):
                    detected_planted += 1
            else:
                unscored_planted += 1

        for stage in _TIMING_STAGES:
            timing_totals[stage] += result.timings_ms[stage]

    elapsed_seconds = perf_counter() - wall_started
    document_count = len(rows)
    missed_planted = comparable_planted - detected_planted
    metrics: dict[str, int | float] = {
        "documents": document_count,
        "fields_correct": correct_fields,
        "fields_total": field_count,
        "field_accuracy_percent": round(correct_fields / field_count * 100, 2),
        "false_flags": false_flags,
        "comparable_planted_mismatches": comparable_planted,
        "detected_planted_mismatches": detected_planted,
        "missed_planted_mismatches": missed_planted,
        "unscored_planted_mismatches": unscored_planted,
        "wall_time_seconds": round(elapsed_seconds, 3),
    }
    for stage, total_ms in timing_totals.items():
        metrics[f"mean_{stage}_ms"] = round(total_ms / document_count, 3)

    results_path.mkdir(parents=True, exist_ok=True)
    summary_path = results_path / "summary.md"
    summary = [
        "# Synthetic marksheet evaluation",
        "",
        f"- Documents processed: {document_count}",
        f"- Correct extracted field values: {correct_fields} / {field_count}",
        f"- Field-level accuracy: {metrics['field_accuracy_percent']}%",
        f"- False flags on documents without planted mismatches: {false_flags}",
        f"- Comparable planted mismatches detected: {detected_planted} / {comparable_planted}",
        f"- Missed comparable planted mismatches: {missed_planted}",
        f"- Planted mismatches not comparable to form data (board/result): {unscored_planted}",
        f"- Mean OCR time per document: {metrics['mean_ocr_ms']} ms",
        f"- Mean extraction time per document: {metrics['mean_extraction_ms']} ms",
        f"- Mean validation time per document: {metrics['mean_validation_ms']} ms",
        f"- Mean pipeline time per document: {metrics['mean_total_ms']} ms",
        f"- Wall-clock evaluation time: {elapsed_seconds:.3f} seconds",
        "",
        "Results are from this local synthetic run only. They are not a real-world accuracy guarantee.",
    ]
    summary_path.write_text("\n".join(summary) + "\n", encoding="utf-8")
    print(f"Processed {document_count} documents.")
    print(f"Field-level accuracy: {metrics['field_accuracy_percent']}% ({correct_fields}/{field_count}).")
    print(f"Mean pipeline time per document: {metrics['mean_total_ms']} ms.")
    print(f"Wrote measured results to {summary_path}.")
    return metrics


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate the Python pipeline on synthetic marksheets.")
    parser.add_argument("--data-directory", type=Path, help="Directory containing answer_key.csv and images/.")
    parser.add_argument("--results-directory", type=Path, help="Directory for summary.md.")
    arguments = parser.parse_args()
    try:
        run_evaluation(arguments.data_directory, arguments.results_directory)
    except OcrUnavailableError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2) from error


if __name__ == "__main__":
    main()
