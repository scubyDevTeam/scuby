// The server-side safety steps of docs/eng/media-pipeline.md §1: validate, strip metadata, re-encode.
import sharp from 'sharp';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION = 8000;
// sharp reports AVIF as format 'heif' with compression 'av1'. HEIC (heif + 'hevc') is rejected on
// purpose: prebuilt sharp decodes only AV1 through libheif, so the client converts iPhone photos
// before upload (docs/eng/media-pipeline.md §1).
const ACCEPTED = new Set(['jpeg', 'png', 'webp']);

export function isAcceptedFormat(meta) {
  return ACCEPTED.has(meta.format) || (meta.format === 'heif' && meta.compression === 'av1');
}
const INCOMING = /^incoming\/([0-9a-f]{64})$/;

export async function normalizeMaster(input) {
  if (input.length > MAX_BYTES) throw new Error('too large');
  let meta;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new Error('not an image');
  }
  if (!isAcceptedFormat(meta)) throw new Error('not an image');
  if (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION) throw new Error('dimensions above 8000 px');
  // sharp drops all metadata unless asked to keep it: EXIF (GPS included) never reaches the master.
  return sharp(input)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .toColorspace('srgb')
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 82 })
    .toBuffer();
}

export function masterKeyFor(incomingKey) {
  const m = INCOMING.exec(incomingKey);
  return m ? `media/${m[1]}.jpg` : null;
}
