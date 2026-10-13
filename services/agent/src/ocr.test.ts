import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { runOcr } from './ocr.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const dataDirectory = path.join(repositoryRoot, 'eval', 'data');

describe('runOcr on synthetic marksheets', () => {
  it('reads roll numbers from the first three generated images', async () => {
    const csv = await readFile(path.join(dataDirectory, 'answer_key.csv'), 'utf8');
    const rows = csv.trim().split(/\r?\n/).slice(1, 4);
    const records = rows.map((row) => {
      const [id, , roll_number] = row.split(',');
      return { id, roll_number };
    });

    const results = [];
    for (const record of records) {
      const imagePath = path.join(dataDirectory, 'images', `${record.id}.png`);
      const text = await runOcr(imagePath);
      results.push({ rollNumber: record.roll_number, matched: text.includes(record.roll_number) });
    }

    const matches = results.filter((result) => result.matched).length;
    console.log(`OCR roll-number matches: ${matches} of ${results.length} matched`);
    for (const result of results) {
      console.log(`${result.matched ? 'MATCH' : 'NO MATCH'}: ${result.rollNumber}`);
    }

    expect(results).toHaveLength(3);
    expect(matches).toBeGreaterThanOrEqual(2);
  }, 120_000);
});