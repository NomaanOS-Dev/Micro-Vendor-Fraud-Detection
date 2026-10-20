import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as exifr from 'exifr';
import sharp from 'sharp';

const uploadRoot = path.resolve(process.cwd(), 'uploads');

export function detectImage(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: '.jpg', mimeType: 'image/jpeg' };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { extension: '.png', mimeType: 'image/png' };
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { extension: '.webp', mimeType: 'image/webp' };
  }
  const error = new Error('Upload a valid JPEG, PNG, or WebP image.');
  error.status = 400;
  error.code = 'INVALID_EVIDENCE_IMAGE';
  throw error;
}

export async function saveEvidence(vendorId, file) {
  const detected = detectImage(file.buffer);
  try {
    const metadata = await sharp(file.buffer, { limitInputPixels: 20_000_000, failOn: 'warning' }).metadata();
    if (metadata.format !== detected.mimeType.split('/')[1].replace('jpeg', 'jpg') && !(detected.mimeType === 'image/jpeg' && metadata.format === 'jpeg')) {
      const error = new Error('The uploaded image file is invalid.');
      error.status = 400;
      error.code = 'INVALID_EVIDENCE_IMAGE';
      throw error;
    }
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > 20_000_000) {
      const error = new Error('Image dimensions are invalid or too large.');
      error.status = 400;
      error.code = 'INVALID_EVIDENCE_IMAGE';
      throw error;
    }
  } catch (error) {
    if (error.status) throw error;
    const invalid = new Error('The uploaded image could not be decoded.');
    invalid.status = 400;
    invalid.code = 'INVALID_EVIDENCE_IMAGE';
    throw invalid;
  }
  const vendorDirectory = path.join(uploadRoot, vendorId);
  await mkdir(vendorDirectory, { recursive: true });
  const filename = `${randomUUID()}${detected.extension}`;
  const absolutePath = path.join(vendorDirectory, filename);
  await writeFile(absolutePath, file.buffer, { flag: 'wx', mode: 0o600 });

  let metadata = null;
  try {
    const exif = await exifr.parse(file.buffer, { pick: ['DateTimeOriginal', 'CreateDate', 'Make', 'Model', 'Software'] });
    if (exif) {
      const software = exif.Software ? String(exif.Software).slice(0, 160) : '';
      metadata = {
        ...(exif.DateTimeOriginal || exif.CreateDate ? { captured_at: new Date(exif.DateTimeOriginal || exif.CreateDate).toISOString() } : {}),
        ...(exif.Make || exif.Model ? { device: [exif.Make, exif.Model].filter(Boolean).join(' ').trim() } : {}),
        ...(software ? { software, ...( /photoshop|gimp|picsart|canva|snapseed|lightroom/i.test(software) ? { edited: true } : {}) } : {}),
        extracted_by_server: true,
      };
    }
  } catch {
    metadata = { extraction_failed: true, extracted_by_server: true };
  }

  return {
    path: absolutePath,
    relativePath: path.join(vendorId, filename),
    mimeType: detected.mimeType,
    size: file.buffer.length,
    metadata,
  };
}

export function evidenceAbsolutePath(relativePath) {
  const resolved = path.resolve(uploadRoot, relativePath);
  if (!resolved.startsWith(`${uploadRoot}${path.sep}`)) return null;
  return resolved;
}
