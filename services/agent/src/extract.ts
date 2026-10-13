import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const extractionSchema = z.object({
  name: z.string().nullable(),
  roll_number: z.string().nullable(),
  dob: z.string().nullable(),
  board: z.string().nullable(),
  year: z.number().int().nullable(),
  total: z.number().int().nullable(),
  result: z.string().nullable()
}).strict();

type ExtractedFields = z.infer<typeof extractionSchema>;

export type Extracted = ExtractedFields & { warnings: string[] };

function emptyExtraction(warnings: string[]): Extracted {
  return {
    name: null,
    roll_number: null,
    dob: null,
    board: null,
    year: null,
    total: null,
    result: null,
    warnings
  };
}

function normalizeForGrounding(value: string): string {
  return value.toLowerCase().replace(/\s/g, '');
}

export async function extractFields(ocrText: string): Promise<Extracted> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  const prompt = await readFile(new URL('../prompts/extract_v1.txt', import.meta.url), 'utf8');
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json'
    }
  });
  const response = await model.generateContent(`${prompt}\n\nOCR text:\n${ocrText}`);

  let responseJson: unknown;
  try {
    responseJson = JSON.parse(response.response.text());
  } catch {
    return emptyExtraction(['Gemini response was not valid JSON.']);
  }

  const parsed = extractionSchema.safeParse(responseJson);
  if (!parsed.success) {
    return emptyExtraction(['Gemini response did not match the extraction schema.']);
  }

  const extracted: Extracted = { ...parsed.data, warnings: [] };
  const normalizedOcrText = normalizeForGrounding(ocrText);

  for (const field of ['name', 'roll_number', 'dob', 'board', 'result'] as const) {
    const value = extracted[field];
    if (value !== null && !normalizedOcrText.includes(normalizeForGrounding(value))) {
      extracted[field] = null;
      extracted.warnings.push(`The extracted ${field} was not found in the OCR text and was discarded.`);
    }
  }

  return extracted;
}