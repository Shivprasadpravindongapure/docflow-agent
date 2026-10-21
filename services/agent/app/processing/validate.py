"""
Internal consistency validation.
Does NOT cross-check against user-provided form data (we may not have real data).
Instead checks whether the document's own fields are internally consistent.
"""
from .models import Decision, ExtractedDocument, FieldValidation


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


def decide(extracted: ExtractedDocument, validations: list[FieldValidation]) -> Decision:
    """
    Three-verdict decision combining Gemini's verdict with internal consistency checks.
    Gemini's verdict is primary; internal checks can escalate but not override downward.
    """
    gemini = extracted.gemini_verdict  # verified / needs_review / suspicious

    # Count internal check results
    passed = sum(1 for v in validations if v.result == "pass")
    total = len(validations)
    pass_rate = passed / total if total else 0.0

    # Escalate to suspicious if Gemini flags it OR if AI score very high OR consistency very low
    if (
        gemini == "suspicious"
        or extracted.ai_generation_score >= 0.6
        or extracted.internal_consistency_score <= 0.3
        or (pass_rate < 0.4 and total >= 4)
    ):
        return "suspicious"

    # Verified: Gemini says so AND internal checks mostly pass AND low AI score
    if (
        gemini == "verified"
        and pass_rate >= 0.7
        and extracted.ai_generation_score < 0.3
        and extracted.internal_consistency_score >= 0.7
    ):
        return "verified"

    return "needs_review"
