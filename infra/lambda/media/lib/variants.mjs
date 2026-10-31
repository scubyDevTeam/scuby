// Variant table and rendering — docs/eng/media-pipeline.md §3.
import sharp from 'sharp';

export const VARIANTS = {
  thumb: { width: 240, height: 240, fit: 'inside' },
  card: { width: 800, height: 800, fit: 'inside' },
  full: { width: 1600, height: 1600, fit: 'inside' },
  og: { width: 1200, height: 630, fit: 'cover' },
  match: { width: 512, height: 512, fit: 'cover' },
};

const PATH = /^\/img\/([0-9a-f]{64})\/([a-z]+)$/;

export function parseImagePath(path) {
  const m = PATH.exec(path ?? '');
  if (!m || !Object.hasOwn(VARIANTS, m[2])) return null;
  return { hash: m[1], variant: m[2] };
}

export function pickFormat(accept = '') {
  if (/image\/avif/.test(accept ?? '')) return 'avif';
  if (/image\/webp/.test(accept ?? '')) return 'webp';
  return 'jpeg';
}

const QUALITY = { avif: 50, webp: 75, jpeg: 80 };

export async function renderVariant(master, variant, format) {
  const v = VARIANTS[variant];
  return sharp(master)
    .rotate()
    .resize({ width: v.width, height: v.height, fit: v.fit, withoutEnlargement: v.fit === 'inside' })
    .toColorspace('srgb')
    .toFormat(format, { quality: QUALITY[format] })
    .toBuffer();
}
