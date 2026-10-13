import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
  getGenerativeModel: vi.fn()
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: mocks.getGenerativeModel
  }))
}));

import { extractFields } from './extract.js';

const validResponse = {
  name: 'Aarav Sharma',
  roll_number: 'SYN27-0001',
  dob: '2005-01-01',
  board: 'North State Board',
  year: 2024,
  total: 300,
  result: 'PASS WITH DISTINCTION'
};

const sourceText = 'Aarav Sharma SYN27-0001 2005-01-01 North State Board 2024 300 PASS WITH DISTINCTION';

function response(text: string) {
  return { response: { text: () => text } };
}

describe('extractFields', () => {
  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    mocks.generateContent.mockReset();
    mocks.getGenerativeModel.mockReset().mockReturnValue({ generateContent: mocks.generateContent });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('parses valid JSON and keeps values grounded in OCR text', async () => {
    mocks.generateContent.mockResolvedValue(response(JSON.stringify(validResponse)));

    const result = await extractFields(sourceText);

    expect(result).toEqual({ ...validResponse, warnings: [] });
    expect(mocks.getGenerativeModel).toHaveBeenCalledWith({
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json' }
    });
  });

  it('keeps year and total when their exact numeric tokens appear in OCR text', async () => {
    mocks.generateContent.mockResolvedValue(response(JSON.stringify(validResponse)));

    const result = await extractFields(sourceText);

    expect(result.year).toBe(2024);
    expect(result.total).toBe(300);
    expect(result.warnings).toEqual([]);
  });

  it('nulls numeric fields whose values are absent from OCR text', async () => {
    mocks.generateContent.mockResolvedValue(response(JSON.stringify({
      ...validResponse,
      year: 2025,
      total: 301
    })));

    const result = await extractFields(sourceText);

    expect(result.year).toBeNull();
    expect(result.total).toBeNull();
    expect(result.warnings).toEqual([
      'The extracted year was not found as a standalone number in the OCR text and was discarded.',
      'The extracted total was not found as a standalone number in the OCR text and was discarded.'
    ]);
  });

  it('does not ground a number that appears only inside a longer number', async () => {
    mocks.generateContent.mockResolvedValue(response(JSON.stringify(validResponse)));

    const result = await extractFields(sourceText.replace(' 300 PASS', ' 3000 PASS'));

    expect(result.total).toBeNull();
    expect(result.warnings).toContain(
      'The extracted total was not found as a standalone number in the OCR text and was discarded.'
    );
  });

  it('returns all-null fields and a warning for invalid JSON', async () => {
    mocks.generateContent.mockResolvedValue(response('not json'));

    const result = await extractFields(sourceText);

    expect(result).toEqual({
      name: null,
      roll_number: null,
      dob: null,
      board: null,
      year: null,
      total: null,
      result: null,
      warnings: ['Gemini response was not valid JSON.']
    });
  });

  it('discards a string field that is absent from OCR text', async () => {
    mocks.generateContent.mockResolvedValue(response(JSON.stringify({
      ...validResponse,
      board: 'Imaginary Board'
    })));

    const result = await extractFields(sourceText);

    expect(result.board).toBeNull();
    expect(result.warnings).toEqual([
      'The extracted board was not found in the OCR text and was discarded.'
    ]);
  });

  it('rejects a response that fails the schema without throwing', async () => {
    mocks.generateContent.mockResolvedValue(response(JSON.stringify({ ...validResponse, year: '2024' })));

    const result = await extractFields(sourceText);

    expect(result.year).toBeNull();
    expect(result.name).toBeNull();
    expect(result.warnings).toEqual(['Gemini response did not match the extraction schema.']);
  });

  it('throws a clear error when the API key is missing without calling Gemini', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');

    await expect(extractFields(sourceText)).rejects.toThrow('GEMINI_API_KEY is not set');
    expect(mocks.getGenerativeModel).not.toHaveBeenCalled();
  });
});