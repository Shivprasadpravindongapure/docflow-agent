import { describe, expect, it } from 'vitest';

import { validate, type ApplicationForm, type ExtractedFields } from './validate.js';

const application: ApplicationForm = {
  name: 'Ramesh Kumar Patil',
  roll_number: 'BE 2024-0457',
  dob: '2005-03-14',
  year: 2024
};

const extracted: ExtractedFields = {
  name: 'Ramesh Kumar Patil',
  roll_number: 'BE2024-0457',
  dob: '14/03/2005',
  year: 2024
};

describe('validate', () => {
  it('normalizes names and passes a similarity score at or above the threshold', () => {
    const results = validate(application, { ...extracted, name: '  RAMESH   KUMAR PATIL  ' });

    expect(results.find((result) => result.field === 'name')).toMatchObject({
      result: 'pass',
      reason: 'Name similarity score 1.00 meets the 0.90 threshold.'
    });
  });

  it('marks a name below the similarity threshold as a mismatch and includes its score', () => {
    const result = validate(application, { ...extracted, name: 'Ramesh Kumar Patel' })
      .find((item) => item.field === 'name');

    expect(result?.result).toBe('mismatch');
    expect(result?.reason).toMatch(/similarity score 0\.\d+ is below the 0\.90 threshold/);
  });

  it('matches roll numbers after uppercasing and removing spaces', () => {
    const result = validate(application, { ...extracted, roll_number: 'be 2024 - 0457' })
      .find((item) => item.field === 'roll_number');

    expect(result?.result).toBe('pass');
  });

  it('reports a roll-number mismatch when normalized values differ', () => {
    const result = validate(application, { ...extracted, roll_number: 'BE2024-9999' })
      .find((item) => item.field === 'roll_number');

    expect(result?.result).toBe('mismatch');
  });

  it('normalizes a day-first date to YYYY-MM-DD', () => {
    const result = validate(application, extracted).find((item) => item.field === 'dob');

    expect(result?.result).toBe('pass');
    expect(result?.reason).toContain('YYYY-MM-DD');
  });

  it('requires year to be an exact integer match', () => {
    const matching = validate(application, extracted).find((item) => item.field === 'year');
    const fractional = validate(application, { ...extracted, year: 2024.5 }).find((item) => item.field === 'year');

    expect(matching?.result).toBe('pass');
    expect(fractional?.result).toBe('mismatch');
  });

  it('skips total when the application form does not provide it', () => {
    const results = validate(application, { ...extracted, total: 412 });

    expect(results.some((result) => result.field === 'total')).toBe(false);
  });

  it('passes an exact total match in the inclusive 0 to 500 range', () => {
    const result = validate({ ...application, total: 500 }, { ...extracted, total: 500 })
      .find((item) => item.field === 'total');

    expect(result?.result).toBe('pass');
  });

  it('rejects totals outside the allowed integer range', () => {
    const result = validate({ ...application, total: 412 }, { ...extracted, total: 501 })
      .find((item) => item.field === 'total');

    expect(result?.result).toBe('mismatch');
    expect(result?.reason).toBe('Total must be an integer between 0 and 500.');
  });

  it('reports extracted null fields as missing with the field name in the reason', () => {
    const result = validate(application, { ...extracted, dob: null }).find((item) => item.field === 'dob');

    expect(result).toMatchObject({
      expected: application.dob,
      extracted: null,
      result: 'missing',
      reason: 'dob was not found in the extracted document.'
    });
  });
});