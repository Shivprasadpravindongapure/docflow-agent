import re
from typing import Sequence

from rapidfuzz.fuzz import ratio

from .models import ApplicationForm, Decision, ExtractedFields, FieldValidation, normalize_date

_NAME_THRESHOLD = 90.0


def _normalize_exact(value: str) -> str:
    return re.sub(r"\s+", "", value).casefold()


def _missing(field: str, expected: str | int | None) -> FieldValidation:
    return FieldValidation(
        field=field,
        expected=expected,
        extracted=None,
        result="missing",
        reason=f"{field} was not found in the extracted document.",
    )


def _compare_exact(
    field: str,
    expected: str,
    extracted: str | None,
    description: str,
) -> FieldValidation:
    if extracted is None:
        return _missing(field, expected)
    passed = _normalize_exact(expected) == _normalize_exact(extracted)
    return FieldValidation(
        field=field,
        expected=expected,
        extracted=extracted,
        result="pass" if passed else "mismatch",
        reason=f"{description} {'matches' if passed else 'does not match'} after normalization.",
    )


def validate(application: ApplicationForm, extracted: ExtractedFields) -> list[FieldValidation]:
    results: list[FieldValidation] = []

    if extracted.name is None:
        results.append(_missing("name", application.name))
    else:
        score = ratio(" ".join(application.name.casefold().split()), " ".join(extracted.name.casefold().split()))
        passed = score >= _NAME_THRESHOLD
        results.append(
            FieldValidation(
                field="name",
                expected=application.name,
                extracted=extracted.name,
                result="pass" if passed else "mismatch",
                reason=(
                    f"Name similarity score {score / 100:.2f} "
                    f"{'meets' if passed else 'is below'} the 0.90 threshold."
                ),
            )
        )

    results.append(_compare_exact("roll_number", application.roll_number, extracted.roll_number, "Roll number"))

    expected_dob = normalize_date(application.dob)
    extracted_dob = normalize_date(extracted.dob) if extracted.dob is not None else None
    if extracted.dob is None:
        results.append(_missing("dob", application.dob))
    else:
        passed = expected_dob is not None and expected_dob == extracted_dob
        results.append(
            FieldValidation(
                field="dob",
                expected=application.dob,
                extracted=extracted.dob,
                result="pass" if passed else "mismatch",
                reason=(
                    "Date of birth matches after normalization to YYYY-MM-DD."
                    if passed
                    else "Date of birth does not match after normalization to YYYY-MM-DD."
                ),
            )
        )

    if application.board is not None:
        results.append(_compare_exact("board", application.board, extracted.board, "Board"))

    if extracted.year is None:
        results.append(_missing("year", application.year))
    else:
        passed = extracted.year == application.year
        results.append(
            FieldValidation(
                field="year",
                expected=application.year,
                extracted=extracted.year,
                result="pass" if passed else "mismatch",
                reason=f"Year {'is' if passed else 'is not'} an exact integer match.",
            )
        )

    if application.total is not None:
        if extracted.total is None:
            results.append(_missing("total", application.total))
        else:
            in_range = 0 <= extracted.total <= 500
            passed = in_range and extracted.total == application.total
            reason = (
                "Total must be an integer between 0 and 500."
                if not in_range
                else "Total is an exact integer match within the valid range."
                if passed
                else "Total does not match the application form."
            )
            results.append(
                FieldValidation(
                    field="total",
                    expected=application.total,
                    extracted=extracted.total,
                    result="pass" if passed else "mismatch",
                    reason=reason,
                )
            )
    return results


def decide(validations: Sequence[FieldValidation]) -> Decision:
    if any(item.result == "missing" for item in validations):
        return "missing"
    if any(item.result == "mismatch" for item in validations):
        return "needs_review"
    return "verified"
