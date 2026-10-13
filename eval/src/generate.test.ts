import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { generateDataset } from './generate.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('synthetic marksheet generator', () => {
  it('writes 50 answer-key rows and a PNG for every row', async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'docflow-eval-'));
    temporaryDirectories.push(outputDirectory);

    await generateDataset(outputDirectory);

    const csv = await readFile(path.join(outputDirectory, 'answer_key.csv'), 'utf8');
    const [header, ...rows] = csv.trim().split('\n');
    const rowObjects = rows.map((row) => {
      const [id, name, roll_number, dob, board, year, total, result, planted_mismatch,
        form_name, form_roll_number, form_dob, form_year, form_total] = row.split(',');
      return {
        id, name, roll_number, dob, board, year, total, result, planted_mismatch,
        form_name, form_roll_number, form_dob, form_year, form_total
      };
    });
    const imagesDirectory = path.join(outputDirectory, 'images');
    const images = await readdir(imagesDirectory);

    expect(header).toBe('id,name,roll_number,dob,board,year,total,result,planted_mismatch,form_name,form_roll_number,form_dob,form_year,form_total');
    expect(rows).toHaveLength(50);
    expect(images).toHaveLength(50);
    expect(rowObjects.filter((record) => record.planted_mismatch).length).toBe(10);
    expect(rowObjects[0].name).toBe('Synthetic Aarav Sharma');
    expect(rowObjects[0].form_name).toBe('Aarav Sharma');

    for (const record of rowObjects) {
      const imagePath = path.join(imagesDirectory, `${record.id}.png`);
      expect((await stat(imagePath)).isFile()).toBe(true);
    }
  });
});