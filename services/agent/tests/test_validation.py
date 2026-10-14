from services.agent.app.processing.models import ApplicationForm, ExtractedFields, FieldValidation
from services.agent.app.processing.validate import decide, validate


def application(**overrides):
    values = {
        "name": "Aarav Sharma",
        "roll_number": "SYN27-0001",
        "dob": "2005-01-01",
        "year": 2024,
        "board": "North State Board",
        "total": 300,
    }
    values.update(overrides)
    return ApplicationForm(**values)


def extraction(**overrides):
    values = {
        "name": "Aarav Sharma",
        "roll_number": "syn27 - 0001",
        "dob": "01/01/2005",
        "board": "north state board",
        "year": 2024,
        "total": 300,
        "result": "PASS",
    }
    values.update(overrides)
    return ExtractedFields(**values)


def test_matching_fields_pass_with_normalization():
    results = validate(application(), extraction())

    assert [item.result for item in results] == ["pass"] * 6
    assert all(item.field and item.reason for item in results)


def test_name_uses_the_documented_ninety_percent_threshold():
    passing = validate(application(), extraction(name="Aarav Sharm"))[0]
    failing = validate(application(), extraction(name="Different Person"))[0]

    assert passing.result == "pass"
    assert "0.90 threshold" in passing.reason
    assert failing.result == "mismatch"


def test_missing_values_return_complete_validation_evidence():
    results = validate(
        application(),
        extraction(name=None, roll_number=None, dob=None, board=None, year=None, total=None),
    )

    assert all(item.result == "missing" for item in results)
    assert all(item.expected is not None and item.extracted is None and item.reason for item in results)


def test_invalid_date_and_out_of_range_total_mismatch():
    results = validate(application(), extraction(dob="31/02/2005", total=501))

    assert next(item for item in results if item.field == "dob").result == "mismatch"
    total = next(item for item in results if item.field == "total")
    assert total.result == "mismatch"
    assert "between 0 and 500" in total.reason


def test_total_is_not_required_when_application_does_not_supply_it():
    results = validate(application(total=None), extraction(total=None))

    assert "total" not in [item.field for item in results]


def test_decision_prioritizes_missing_then_mismatch():
    mismatch = FieldValidation(
        field="year",
        expected=2024,
        extracted=2025,
        result="mismatch",
        reason="Year differs.",
    )
    missing = FieldValidation(
        field="dob",
        expected="2005-01-01",
        extracted=None,
        result="missing",
        reason="DOB missing.",
    )

    assert decide([]) == "verified"
    assert decide([mismatch]) == "needs_review"
    assert decide([mismatch, missing]) == "missing"
