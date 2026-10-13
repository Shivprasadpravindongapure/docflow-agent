import { compareTwoStrings } from 'string-similarity';

export type ValidationField = 'name' | 'roll_number' | 'dob' | 'year' | 'total';
export type ValidationValue = string | number | null;
export type ValidationResultType = 'pass' | 'mismatch' | 'missing';

export interface ApplicationForm {
  name: string;
  roll_number: string;
  dob: string;
  year: number;
  total?: number | null;
}

export interface ExtractedFields {
  name: string | null;
  roll_number: string | null;
  dob: string | null;
  year: number | null;
  total?: number | null;
}

export interface FieldValidation {
  field: ValidationField;
  expected: ValidationValue;
  extracted: ValidationValue;
  result: ValidationResultType;
  reason: string;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeExact(value: string): string {
  return value.toUpperCase().replace(/\s+/g, '');
}

function normalizeDob(value: string): string | null {
  const compact = value.trim().replace(/\s+/g, '');
  const match = compact.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})$/);
  if (!match) return null;

  const first = Number(match[1]);
  const second = Number(match[2]);
  const third = Number(match[3]);
  const [year, month, day] = match[1].length === 4
    ? [first, second, third]
    : match[3].length === 4
      ? [third, second, first]
      : [Number.NaN, Number.NaN, Number.NaN];

  if (![year, month, day].every(Number.isInteger)) return null;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function missingResult(field: ValidationField, expected: ValidationValue): FieldValidation {
  return {
    field,
    expected,
    extracted: null,
    result: 'missing',
    reason: `${field} was not found in the extracted document.`
  };
}

export function validate(
  application: ApplicationForm,
  extracted: ExtractedFields
): FieldValidation[] {
  const results: FieldValidation[] = [];

  if (extracted.name === null) {
    results.push(missingResult('name', application.name));
  } else {
    const score = compareTwoStrings(normalizeName(application.name), normalizeName(extracted.name));
    const passed = score >= 0.9;
    results.push({
      field: 'name',
      expected: application.name,
      extracted: extracted.name,
      result: passed ? 'pass' : 'mismatch',
      reason: `Name similarity score ${score.toFixed(2)} ${passed ? 'meets' : 'is below'} the 0.90 threshold.`
    });
  }

  if (extracted.roll_number === null) {
    results.push(missingResult('roll_number', application.roll_number));
  } else {
    const passed = normalizeExact(application.roll_number) === normalizeExact(extracted.roll_number);
    results.push({
      field: 'roll_number',
      expected: application.roll_number,
      extracted: extracted.roll_number,
      result: passed ? 'pass' : 'mismatch',
      reason: passed ? 'Roll number matches after normalization.' : 'Roll number does not match after normalization.'
    });
  }

  if (extracted.dob === null) {
    results.push(missingResult('dob', application.dob));
  } else {
    const expectedDob = normalizeDob(application.dob);
    const extractedDob = normalizeDob(extracted.dob);
    const passed = expectedDob !== null && expectedDob === extractedDob;
    results.push({
      field: 'dob',
      expected: application.dob,
      extracted: extracted.dob,
      result: passed ? 'pass' : 'mismatch',
      reason: passed
        ? 'Date of birth matches after normalization to YYYY-MM-DD.'
        : 'Date of birth does not match after normalization to YYYY-MM-DD.'
    });
  }

  if (extracted.year === null) {
    results.push(missingResult('year', application.year));
  } else {
    const passed = Number.isInteger(extracted.year) && extracted.year === application.year;
    results.push({
      field: 'year',
      expected: application.year,
      extracted: extracted.year,
      result: passed ? 'pass' : 'mismatch',
      reason: passed ? 'Year is an exact integer match.' : 'Year must be an integer matching the application form.'
    });
  }

  if (application.total !== null && application.total !== undefined) {
    if (extracted.total === null || extracted.total === undefined) {
      results.push(missingResult('total', application.total));
    } else {
      const isValidTotal = Number.isInteger(extracted.total) && extracted.total >= 0 && extracted.total <= 500;
      const passed = isValidTotal && extracted.total === application.total;
      results.push({
        field: 'total',
        expected: application.total,
        extracted: extracted.total,
        result: passed ? 'pass' : 'mismatch',
        reason: !isValidTotal
          ? 'Total must be an integer between 0 and 500.'
          : passed
            ? 'Total is an exact integer match within the valid range.'
            : 'Total does not match the application form.'
      });
    }
  }

  return results;
}