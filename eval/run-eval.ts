import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { parse } from 'csv-parse/sync';
import dotenv from 'dotenv';

import { extractFields } from '../services/agent/src/extract.js';
import { runOcr } from '../services/agent/src/ocr.js';
import { validate, type ApplicationForm, type FieldValidation, type ValidationField } from '../services/agent/src/validate.js';

type AnswerRow = {
  id: string;
  name: string;
  roll_number: string;
  dob: string;
  board: string;
  year: string;
  total: string;
  result: string;
  planted_mismatch: string;
  form_name: string;
  form_roll_number: string;
  form_dob: string;
  form_year: string;
  form_total: string;
};

type TimedEvaluation = {
  id: string;
  plantedMismatch: string;
  isValidDocument: boolean;
  fieldMatches: number;
  fieldCount: number;
  expected: Record<AccuracyField, string | number>;
  observed: ReturnType<typeof observedFields>;
  falseFlagCount: number;
  plantedMismatchFlagged: boolean;
  flaggedFields: string[];
  ocrMs: number;
  extractionMs: number;
  validationMs: number;
  warnings: string[];
};

type RowSelection = {
  rows: AnswerRow[];
  description: string;
};

const evalDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(evalDirectory, '..');
const dataDirectory = path.join(evalDirectory, 'data');
const resultsDirectory = path.join(evalDirectory, 'results');
const answerKeyPath = path.join(dataDirectory, 'answer_key.csv');
const fieldNames = ['name', 'roll_number', 'dob', 'board', 'year', 'total', 'result'] as const;
const minimumGeminiRequestIntervalMs = 12_500;
type AccuracyField = typeof fieldNames[number];

function optionValue(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  if (index === -1) return undefined;
  if (args.indexOf(option, index + 1) !== -1 || !args[index + 1] || args[index + 1].startsWith('--')) {
    throw new Error(`Option ${option} requires exactly one value.`);
  }
  return args[index + 1];
}

function parsePositiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Option ${option} requires a positive integer.`);
  }
  return parsed;
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleRows<T>(rows: T[], random: () => number): T[] {
  const shuffled = [...rows];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function selectRows(rows: AnswerRow[], args: string[]): RowSelection {
  const sampleValue = optionValue(args, '--sample');
  const seedValue = optionValue(args, '--seed');
  const limitValue = optionValue(args, '--limit');

  if (sampleValue !== undefined) {
    if (limitValue !== undefined) throw new Error('Use either --sample or --limit, not both.');
    if (seedValue === undefined) throw new Error('--sample requires --seed for reproducibility.');

    const sampleSize = parsePositiveInteger(sampleValue, '--sample');
    const seed = Number(seedValue);
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new Error('--seed must be an integer between 0 and 4294967295.');
    }
    if (sampleSize > rows.length) {
      throw new Error(`Requested sample size ${sampleSize} exceeds the ${rows.length} answer-key rows.`);
    }

    const validRows = rows.filter((row) => row.planted_mismatch === '');
    const plantedRows = rows.filter((row) => row.planted_mismatch !== '');
    if (sampleSize === 1 && validRows.length > 0 && plantedRows.length > 0) {
      throw new Error('--sample must be at least 2 to include both valid and planted-mismatch documents.');
    }

    const random = createSeededRandom(seed);
    let plantedSampleSize = Math.round(sampleSize * plantedRows.length / rows.length);
    if (validRows.length > 0 && plantedRows.length > 0) {
      plantedSampleSize = Math.max(1, Math.min(sampleSize - 1, plantedSampleSize));
    }
    const validSampleSize = sampleSize - plantedSampleSize;
    const selected = [
      ...shuffleRows(plantedRows, random).slice(0, plantedSampleSize),
      ...shuffleRows(validRows, random).slice(0, validSampleSize)
    ];

    return {
      rows: shuffleRows(selected, random),
      description: `Stratified random sample of ${sampleSize} (seed ${seed})`
    };
  }

  if (seedValue !== undefined) throw new Error('--seed can only be used with --sample.');
  if (limitValue !== undefined) {
    const limit = parsePositiveInteger(limitValue, '--limit');
    return { rows: rows.slice(0, limit), description: `First ${Math.min(limit, rows.length)} answer-key rows` };
  }

  return { rows, description: `All ${rows.length} answer-key rows` };
}

function parseInteger(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`Invalid integer in answer key field ${field}.`);
  return parsed;
}

function normalizeField(field: AccuracyField, value: string | number): string | number {
  if (typeof value === 'number') return value;
  if (field === 'name') return value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (field === 'roll_number') return value.toUpperCase().replace(/\s/g, '');
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function fieldMatchesExpected(
  field: AccuracyField,
  expected: string | number,
  extracted: string | number | null
): boolean {
  if (extracted === null) return false;
  const numericField = field === 'year' || field === 'total';
  const extractedValue = numericField && typeof extracted === 'string' ? Number(extracted) : extracted;
  return normalizeField(field, expected) === normalizeField(field, extractedValue);
}

function escapeCsv(value: string | number | boolean): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(headers: string[], rows: Array<Array<string | number | boolean>>): string {
  return [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n') + '\n';
}

function applicationFrom(row: AnswerRow): ApplicationForm {
  return {
    name: row.form_name,
    roll_number: row.form_roll_number,
    dob: row.form_dob,
    year: parseInteger(row.form_year, 'form_year'),
    total: parseInteger(row.form_total, 'form_total')
  };
}

function extractedForValidation(extracted: Awaited<ReturnType<typeof extractFields>>) {
  return {
    name: extracted.name,
    roll_number: extracted.roll_number,
    dob: extracted.dob,
    year: extracted.year,
    total: extracted.total
  };
}

function expectedFields(row: AnswerRow): Record<AccuracyField, string | number> {
  return {
    name: row.name,
    roll_number: row.roll_number,
    dob: row.dob,
    board: row.board,
    year: parseInteger(row.year, 'year'),
    total: parseInteger(row.total, 'total'),
    result: row.result
  };
}

function observedFields(extracted: Awaited<ReturnType<typeof extractFields>>) {
  return {
    name: extracted.name,
    roll_number: extracted.roll_number,
    dob: extracted.dob,
    board: extracted.board,
    year: extracted.year,
    total: extracted.total,
    result: extracted.result
  };
}

function findFlaggedMismatch(
  plantedMismatch: string,
  validations: FieldValidation[]
): boolean {
  if (!plantedMismatch) return false;
  const result = validations.find((validation) => validation.field === plantedMismatch as ValidationField);
  return result !== undefined && result.result !== 'pass';
}

async function main(): Promise<void> {
  dotenv.config({ path: path.join(projectRoot, 'services', 'agent', '.env'), quiet: true });
  if (!process.env.GEMINI_API_KEY) {
    const rootEnvironment = dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true });
    if (rootEnvironment.parsed?.GEMINI_API_KEY) {
      process.env.GEMINI_API_KEY = rootEnvironment.parsed.GEMINI_API_KEY;
    }
  }
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set in the environment or an ignored local .env file.');
  }

  const csv = await readFile(answerKeyPath, 'utf8');
  const answerRows = parse(csv, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as AnswerRow[];
  const selection = selectRows(answerRows, process.argv.slice(2));
  const rowsToProcess = selection.rows;
  if (rowsToProcess.length === 0) throw new Error('The answer key contains no rows to evaluate.');

  const results: TimedEvaluation[] = [];
  let correctFieldCount = 0;
  let comparedFieldCount = 0;
  let falseFlagCount = 0;
  let plantedMismatchCount = 0;
  let missedMismatchCount = 0;
  let lastGeminiRequestStartedAt: number | undefined;

  for (const row of rowsToProcess) {
    const imagePath = path.join(dataDirectory, 'images', `${row.id}.png`);

    let startedAt = performance.now();
    const ocrText = await runOcr(imagePath);
    const ocrMs = performance.now() - startedAt;

    if (lastGeminiRequestStartedAt !== undefined) {
      const elapsed = performance.now() - lastGeminiRequestStartedAt;
      const remainingWait = minimumGeminiRequestIntervalMs - elapsed;
      if (remainingWait > 0) await delay(remainingWait);
    }
    startedAt = performance.now();
    lastGeminiRequestStartedAt = startedAt;
    const extracted = await extractFields(ocrText);
    const extractionMs = performance.now() - startedAt;

    startedAt = performance.now();
    const validations = validate(applicationFrom(row), extractedForValidation(extracted));
    const validationMs = performance.now() - startedAt;

    const expected = expectedFields(row);
    const observed = observedFields(extracted);
    const fieldMatches = fieldNames.filter((field) =>
      fieldMatchesExpected(field, expected[field], observed[field])
    ).length;
    const isValidDocument = row.planted_mismatch === '';
    const documentFalseFlags = isValidDocument
      ? validations.filter((validation) => validation.result !== 'pass').length
      : 0;
    const plantedMismatchFlagged = findFlaggedMismatch(row.planted_mismatch, validations);
    const hasPlantedMismatch = row.planted_mismatch !== '';

    correctFieldCount += fieldMatches;
    comparedFieldCount += fieldNames.length;
    falseFlagCount += documentFalseFlags;
    if (hasPlantedMismatch) plantedMismatchCount += 1;
    if (hasPlantedMismatch && !plantedMismatchFlagged) missedMismatchCount += 1;

    results.push({
      id: row.id,
      plantedMismatch: row.planted_mismatch,
      isValidDocument,
      fieldMatches,
      fieldCount: fieldNames.length,
      expected,
      observed,
      falseFlagCount: documentFalseFlags,
      plantedMismatchFlagged,
      flaggedFields: validations
        .filter((validation) => validation.result !== 'pass')
        .map((validation) => validation.field),
      ocrMs,
      extractionMs,
      validationMs,
      warnings: extracted.warnings
    });
  }

  const totalTime = (key: 'ocrMs' | 'extractionMs' | 'validationMs') =>
    results.reduce((sum, result) => sum + result[key], 0);
  const averageTime = (key: 'ocrMs' | 'extractionMs' | 'validationMs') =>
    totalTime(key) / results.length;
  const validDocumentCount = results.filter((result) => result.isValidDocument).length;

  const summary = [
    '# Evaluation summary',
    '',
    '## Sample',
    `- Selection: ${selection.description}`,
    `- Documents processed: ${results.length}`,
    `- Document IDs: ${results.map((result) => result.id).join(', ')}`,
    '',
    '## Extraction accuracy',
    `- Field-level exact matches: ${correctFieldCount}/${comparedFieldCount}`,
    '',
    '## Valid documents',
    `- Count: ${validDocumentCount}`,
    `- False flags on valid documents: ${falseFlagCount}`,
    '',
    '## Planted-mismatch documents',
    `- Count: ${plantedMismatchCount}`,
    `- Missed planted mismatches: ${missedMismatchCount}`,
    '',
    '## Stage timings',
    `- OCR time (total / average ms): ${totalTime('ocrMs')} / ${averageTime('ocrMs')}`,
    `- Extraction time (total / average ms): ${totalTime('extractionMs')} / ${averageTime('extractionMs')}`,
    `- Validation time (total / average ms): ${totalTime('validationMs')} / ${averageTime('validationMs')}`,
    ''
  ].join('\n');

  const detailHeaders = [
    'id', 'planted_mismatch', 'valid_document', 'field_matches', 'fields_compared',
    ...fieldNames.flatMap((field) => [`${field}_expected`, `${field}_extracted`, `${field}_match`]),
    'false_flags', 'planted_mismatch_flagged', 'flagged_fields',
    'ocr_ms', 'extraction_ms', 'validation_ms', 'warnings'
  ];
  const details = toCsv(
    detailHeaders,
    results.map((result) => [
      result.id,
      result.plantedMismatch,
      result.isValidDocument,
      result.fieldMatches,
      result.fieldCount,
      ...fieldNames.flatMap((field) => [
        result.expected[field],
        result.observed[field] ?? '',
        fieldMatchesExpected(field, result.expected[field], result.observed[field])
      ]),
      result.falseFlagCount,
      result.plantedMismatchFlagged,
      result.flaggedFields.join(' | '),
      result.ocrMs,
      result.extractionMs,
      result.validationMs,
      result.warnings.join(' | ')
    ])
  );

  await mkdir(resultsDirectory, { recursive: true });
  await writeFile(path.join(resultsDirectory, 'summary.md'), summary, 'utf8');
  await writeFile(path.join(resultsDirectory, 'details.csv'), details, 'utf8');

  console.log(summary.trimEnd());
  console.log(`Details written to ${path.join(resultsDirectory, 'details.csv')}`);
}

await main();