import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { normalizeMaster, masterKeyFor } from '../lib/master.mjs';

const HASH = 'b'.repeat(64);

test('downscales to 1600 px long edge, JPEG, without metadata', async () => {
  const input = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#336699' } })
    .withExif({ IFD0: { Copyright: 'owner home' } })
    .jpeg()
    .toBuffer();
  assert.ok((await sharp(input).metadata()).exif, 'fixture must carry EXIF');

  const out = await normalizeMaster(input);
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 1600);
  assert.equal(meta.height, 1067);
  assert.equal(meta.exif, undefined);
});

test('accepts PNG and keeps small images at their size', async () => {
  const input = await sharp({ create: { width: 400, height: 300, channels: 4, background: '#00000000' } }).png().toBuffer();
  const meta = await sharp(await normalizeMaster(input)).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['jpeg', 400, 300]);
});

test('rejects bytes that are not an image', async () => {
  await assert.rejects(normalizeMaster(Buffer.from('not an image at all')), /not an image/);
});

test('rejects more than 10 MB', async () => {
  await assert.rejects(normalizeMaster(Buffer.alloc(10 * 1024 * 1024 + 1)), /too large/);
});

test('rejects dimensions above 8000 px', async () => {
  const input = await sharp({ create: { width: 8001, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(normalizeMaster(input), /dimensions/);
});

test('maps incoming/<sha256> to media/<sha256>.jpg and nothing else', () => {
  assert.equal(masterKeyFor(`incoming/${HASH}`), `media/${HASH}.jpg`);
  assert.equal(masterKeyFor(`incoming/${HASH}.jpg`), null);
  assert.equal(masterKeyFor(`media/${HASH}.jpg`), null);
  assert.equal(masterKeyFor('incoming/short'), null);
});
