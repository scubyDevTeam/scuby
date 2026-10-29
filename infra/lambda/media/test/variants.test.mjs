import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { parseImagePath, pickFormat, renderVariant, VARIANTS } from '../lib/variants.mjs';

const HASH = 'a'.repeat(64);

test('parses a variant path', () => {
  assert.deepEqual(parseImagePath(`/img/${HASH}/card`), { hash: HASH, variant: 'card' });
});

test('rejects unknown variants, bad hashes and other paths', () => {
  assert.equal(parseImagePath(`/img/${HASH}/huge`), null);
  assert.equal(parseImagePath(`/img/${'a'.repeat(63)}/card`), null);
  assert.equal(parseImagePath(`/img/${'A'.repeat(64)}/card`), null);
  assert.equal(parseImagePath(`/other/${HASH}/card`), null);
  assert.equal(parseImagePath(`/img/${HASH}/card/extra`), null);
});

test('picks AVIF, then WebP, then JPEG from Accept', () => {
  assert.equal(pickFormat('image/avif,image/webp,*/*'), 'avif');
  assert.equal(pickFormat('image/webp,*/*'), 'webp');
  assert.equal(pickFormat('*/*'), 'jpeg');
  assert.equal(pickFormat(undefined), 'jpeg');
});

test('renders card as WebP inside 800 px and never enlarges', async () => {
  const master = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#a0522d' } }).jpeg().toBuffer();
  const out = await renderVariant(master, 'card', 'webp');
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 800);
  assert.equal(meta.height, 600);

  const small = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#000' } }).jpeg().toBuffer();
  const thumb = await sharp(await renderVariant(small, 'thumb', 'jpeg')).metadata();
  assert.equal(thumb.width, 200);
});

test('og is exactly 1200x630', async () => {
  const master = await sharp({ create: { width: 1600, height: 1600, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  const meta = await sharp(await renderVariant(master, 'og', 'jpeg')).metadata();
  assert.deepEqual([meta.width, meta.height], [VARIANTS.og.width, VARIANTS.og.height]);
});
