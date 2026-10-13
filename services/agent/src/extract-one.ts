import dotenv from 'dotenv';
import path from 'node:path';

import { extractFields } from './extract.js';
import { runOcr } from './ocr.js';

dotenv.config();
if (!process.env.GEMINI_API_KEY) {
  const rootEnvironment = dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
  const rootApiKey = rootEnvironment.parsed?.GEMINI_API_KEY;
  if (rootApiKey) process.env.GEMINI_API_KEY = rootApiKey;
}

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
      const details = typeof error === 'object' && error !== null
        ? error as { name?: unknown; status?: unknown; response?: { status?: unknown } }
        : {};
      const status = typeof details.status === 'number'
        ? details.status
        : typeof details.response?.status === 'number'
          ? details.response.status
          : null;
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      const apiKey = process.env.GEMINI_API_KEY;
      const message = error instanceof Error ? error.message : 'Unknown error';
      const safeMessage = message
        .replaceAll(apiKey || '\u0000', '[redacted]')
        .replace(/([?&]key=)[^&\s]+/gi, '$1[redacted]')
        .replace(/(x-goog-api-key\s*[:=]\s*)\S+/gi, '$1[redacted]');
      console.error(status === null
        ? `OCR or extraction failed (${errorName}): ${safeMessage}`
        : `OCR or extraction failed (${errorName}, HTTP ${status}): ${safeMessage}`);
    }
    process.exitCode = 1;
  }
}