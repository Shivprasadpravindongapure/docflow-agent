import csv

from services.agent.app.processing.models import ApplicationForm, ExtractedFields, FieldValidation
from services.agent.app.processing.pipeline import ProcessingResult
from services.agent.app.processing.validate import decide, validate
from eval.generate import generate_dataset
from eval.run_eval import run_evaluation


def test_evaluator_calculates_and_writes_measured_metrics(tmp_path):
    answer_key, images = generate_dataset(tmp_path)
    with answer_key.open(encoding="utf-8", newline="") as answer_file:
        records = {row["id"]: row for row in csv.DictReader(answer_file)}
    records_by_image = {
        image_path.read_bytes(): records[image_path.stem]
        for image_path in images.glob("*.png")
    }

    def fake_processor(image_bytes: bytes, application: ApplicationForm) -> ProcessingResult:
        record = records_by_image[image_bytes]
        extracted = ExtractedFields(
            name=record["name"],
            roll_number=record["roll_number"],
            dob=record["dob"],
            board=record["board"],
            year=int(record["year"]),
            total=int(record["total"]),
            result=record["result"],
        )
        validations = validate(application, extracted)
        return ProcessingResult(
            input_type="image",
            ocr_text="synthetic test OCR",
            extracted=extracted,
            validations=validations,
            decision=decide(validations),
            timings_ms={
                "document": 0.0,
                "ocr": 1.0,
                "extraction": 2.0,
                "validation": 3.0,
                "total": 6.0,
            },
        )

    metrics = run_evaluation(
        data_directory=tmp_path,
        results_directory=tmp_path / "results",
        processor=fake_processor,
    )

    assert metrics["documents"] == 50
    assert metrics["fields_correct"] == 350
    assert metrics["fields_total"] == 350
    assert metrics["field_accuracy_percent"] == 100.0
    assert metrics["false_flags"] == 0
    assert metrics["comparable_planted_mismatches"] == 8
    assert metrics["detected_planted_mismatches"] == 8
    assert metrics["missed_planted_mismatches"] == 0
    assert metrics["unscored_planted_mismatches"] == 2
    summary = (tmp_path / "results" / "summary.md").read_text(encoding="utf-8")
    assert "Correct extracted field values: 350 / 350" in summary
