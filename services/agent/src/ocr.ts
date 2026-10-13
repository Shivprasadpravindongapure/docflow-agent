import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

export async function runOcr(imagePath: string): Promise<string> {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'docflow-ocr-'));
  const cacheDirectory = path.join(os.tmpdir(), 'docflow-tesseract-cache');
  const preprocessedPath = path.join(temporaryDirectory, 'preprocessed.png');

  try {
    await mkdir(cacheDirectory, { recursive: true });
    await sharp(imagePath)
      .greyscale()
      .normalize()
      .threshold(128)
      .png()
      .toFile(preprocessedPath);

    const worker = await createWorker('eng', undefined, {
      cachePath: cacheDirectory,
      cacheMethod: 'write'
    });
    try {
      const { data } = await worker.recognize(preprocessedPath);
      return data.text.trim();
    } finally {
      await worker.terminate();
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}