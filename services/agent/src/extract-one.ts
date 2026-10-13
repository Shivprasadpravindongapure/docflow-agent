import 'dotenv/config';
import path from 'node:path';

import { extractFields } from './extract.js';
import { runOcr } from './ocr.js';

const imagePath = process.argv[2];

if (!imagePath) {
  console.error('Usage: npm run extract-one -- <imagePath>');
  process.exitCode = 1;
} else {
  try {
    const ocrText = await runOcr(path.resolve(imagePath));
    const extracted = await extractFields(ocrText);
    console.log(JSON.stringify(extracted, null, 2));
  } catch (error) {
    if (error instanceof Error && error.message === 'GEMINI_API_KEY is not set') {
      console.error(error.message);
    } else {
      console.error('OCR or extraction failed.');
    }
    process.exitCode = 1;
  }
}