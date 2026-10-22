"""
Internal consistency validation.
Does NOT cross-check against user-provided form data (we may not have real data).
Instead checks whether the document's own fields are internally consistent.
"""
from .models import ApplicationForm, Decision, ExtractedDocument, ExtractedFields, FieldValidation, normalize_date
from rapidfuzz.fuzz import ratio


def validate(application: ApplicationForm, extracted: ExtractedFields) -> list[FieldValidation]:
    """Compare supported marksheet fields with applicant-supplied values."""
    output: list[FieldValidation] = []
    name_score = ratio(application.name.casefold(), (extracted.name or "").casefold()) / 100
    name_result = "missing" if not extracted.name else ("pass" if name_score >= 0.90 else "mismatch")
    output.append(FieldValidation(
        field="name", expected=application.name, extracted=extracted.name, result=name_result,
        reason=(f"Name similarity {name_score:.2f} meets the 0.90 threshold." if name_result == "pass" else
                "Name was not extracted from the document." if name_result == "missing" else
                f"Name similarity {name_score:.2f} is below the 0.90 threshold."),
    ))
    expected_roll = "".join(c for c in application.roll_number.casefold() if c.isalnum())
    actual_roll = "".join(c for c in (extracted.roll_number or "").casefold() if c.isalnum())
    output.append(FieldValidation(
        field="roll_number", expected=application.roll_number, extracted=extracted.roll_number,
        result="missing" if not actual_roll else ("pass" if actual_roll == expected_roll else "mismatch"),
        reason=("Roll number matches after normalization." if actual_roll == expected_roll else
                "Roll number was not extracted from the document." if not actual_roll else
                "Roll number differs from the applicant's value."),
    ))
    expected_dob = normalize_date(application.dob)
    actual_dob = normalize_date(extracted.dob) if extracted.dob else None
    output.append(FieldValidation(
        field="dob", expected=expected_dob or application.dob, extracted=actual_dob or extracted.dob,
        result="missing" if not extracted.dob else ("pass" if actual_dob and actual_dob == expected_dob else "mismatch"),
        reason=("Date of birth matches after normalization." if actual_dob and actual_dob == expected_dob else
                "Date of birth was not extracted from the document." if not extracted.dob else
                "Date of birth is invalid or differs from the applicant's value."),
    ))
    if application.board is not None:
        actual_board = extracted.board or ""
        board_match = actual_board.strip().casefold() == application.board.strip().casefold()
        output.append(FieldValidation(
            field="board", expected=application.board, extracted=extracted.board,
            result="missing" if not actual_board else ("pass" if board_match else "mismatch"),
            reason=("Board matches after case normalization." if board_match else
                    "Board was not extracted from the document." if not actual_board else
                    "Board differs from the applicant's value."),
        ))
    actual_year = extracted.year
    output.append(FieldValidation(
        field="year", expected=application.year, extracted=actual_year,
        result="missing" if actual_year is None else ("pass" if actual_year == application.year else "mismatch"),
        reason=("Exam year matches the applicant's value." if actual_year == application.year else
                "Exam year was not extracted from the document." if actual_year is None else
                "Exam year differs from the applicant's value."),
    ))
    if application.total is not None:
        valid_total = extracted.total is not None and 0 <= extracted.total <= 500
        matches = valid_total and extracted.total == application.total
        output.append(FieldValidation(
            field="total", expected=application.total, extracted=extracted.total,
            result="missing" if extracted.total is None else ("pass" if matches else "mismatch"),
            reason=("Total marks match the applicant's value." if matches else
                    "Total marks were not extracted from the document." if extracted.total is None else
                    "Total marks must be between 0 and 500 and match the applicant's value."),
        ))
    return output


def validate_internal(extracted: ExtractedDocument) -> list[FieldValidation]:
    """
    Run rule-based internal consistency checks on the extracted document.
    Returns a list of FieldValidation items for the UI table.
    """
    results: list[FieldValidation] = []

    # 1. Student name present
    results.append(FieldValidation(
        field="student_name",
        expected="present",
        extracted=extracted.student_name,
        result="pass" if extracted.student_name else "missing",
        reason="Student name was found in the document." if extracted.student_name
               else "Student name was not extracted from the document.",
    ))

    # 2. Roll / seat number present
    roll = extracted.roll_number or extracted.seat_number
    results.append(FieldValidation(
        field="roll_number",
        expected="present",
        extracted=roll,
        result="pass" if roll else "missing",
        reason="Roll / seat number was found." if roll
               else "Roll / seat number not found in document.",
    ))

    # 3. Exam year in valid range
    if extracted.exam_year:
        try:
            y = int(extracted.exam_year)
            valid = 1990 <= y <= 2030
        except ValueError:
            valid = False
        results.append(FieldValidation(
            field="exam_year",
            expected="1990–2030",
            extracted=extracted.exam_year,
            result="pass" if valid else "mismatch",
            reason=f"Exam year {extracted.exam_year} {'is' if valid else 'is NOT'} in the valid range 1990–2030.",
        ))
    else:
        results.append(FieldValidation(
            field="exam_year",
            expected="1990–2030",
            extracted=None,
            result="missing",
            reason="Exam year was not extracted from the document.",
        ))

    # 4. Subject marks sum ≈ total
    if extracted.subjects and extracted.total_marks_obtained is not None:
        calculated = sum(
            s.marks_obtained for s in extracted.subjects if s.marks_obtained is not None
        )
        diff = abs(calculated - extracted.total_marks_obtained)
        match = diff <= 2  # allow ±2 rounding tolerance
        results.append(FieldValidation(
            field="total_marks",
            expected=str(calculated),
            extracted=str(extracted.total_marks_obtained),
            result="pass" if match else "mismatch",
            reason=(
                f"Sum of subject marks ({calculated}) matches declared total ({extracted.total_marks_obtained})."
                if match else
                f"Sum of subject marks ({calculated}) does NOT match declared total ({extracted.total_marks_obtained}). Difference: {diff}."
            ),
        ))
    elif extracted.total_marks_obtained is not None:
        results.append(FieldValidation(
            field="total_marks",
            expected="present",
            extracted=str(extracted.total_marks_obtained),
            result="pass",
            reason=f"Total marks declared as {extracted.total_marks_obtained}.",
        ))

    # 5. Percentage matches marks
    if (
        extracted.percentage is not None
        and extracted.total_marks_obtained is not None
        and extracted.total_max_marks is not None
        and extracted.total_max_marks > 0
    ):
        computed_pct = round(extracted.total_marks_obtained / extracted.total_max_marks * 100, 1)
        diff = abs(computed_pct - extracted.percentage)
        match = diff <= 1.0  # ±1% tolerance
        results.append(FieldValidation(
            field="percentage",
            expected=str(computed_pct),
            extracted=str(extracted.percentage),
            result="pass" if match else "mismatch",
            reason=(
                f"Computed percentage ({computed_pct}%) matches declared ({extracted.percentage}%)."
                if match else
                f"Computed percentage ({computed_pct}%) does NOT match declared ({extracted.percentage}%). Difference: {diff:.1f}%."
            ),
        ))

    # 6. Result status present
    results.append(FieldValidation(
        field="result_status",
        expected="PASS or FAIL",
        extracted=extracted.result_status,
        result="pass" if extracted.result_status else "missing",
        reason=f"Result status: {extracted.result_status}." if extracted.result_status
               else "Result status (PASS/FAIL) not found in document.",
    ))

    # 7. Issuing board present
    results.append(FieldValidation(
        field="issuing_board",
        expected="present",
        extracted=extracted.issuing_board,
        result="pass" if extracted.issuing_board else "missing",
        reason=f"Issuing board identified as: {extracted.issuing_board}." if extracted.issuing_board
               else "Issuing board/authority not found in document.",
    ))

    return results


def decide(extracted: ExtractedDocument | list[FieldValidation], validations: list[FieldValidation] | None = None) -> Decision:
    """Return a deterministic processing state from field validations only.

    The optional legacy ``extracted`` argument is retained for caller compatibility;
    model-generated verdicts and visual authenticity signals are ignored.
    """
    checks = validations if validations is not None else (extracted if isinstance(extracted, list) else [])
    if not checks:
        return "missing"
    if any(item.result == "mismatch" for item in checks):
        return "needs_review"
    if any(item.result == "missing" for item in checks):
        return "missing"
    return "verified"
