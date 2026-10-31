import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { S3Client } from '@aws-sdk/client-s3';

const HASH = 'c'.repeat(64);
const store = new Map();
const calls = [];
let failPut = false;

mock.method(S3Client.prototype, 'send', async (cmd) => {
  const { Key } = cmd.input;
  calls.push(cmd.constructor.name);
  switch (cmd.constructor.name) {
    case 'GetObjectCommand': {
      if (!store.has(Key)) { const e = new Error('missing'); e.name = 'NoSuchKey'; throw e; }
      const bytes = store.get(Key);
      return { Body: { transformToByteArray: async () => new Uint8Array(bytes) } };
    }
    case 'PutObjectCommand':
      if (failPut) throw new Error('put failed');
      store.set(Key, Buffer.from(cmd.input.Body)); return {};
    case 'DeleteObjectCommand': store.delete(Key); return {};
    default: throw new Error(`unexpected ${cmd.constructor.name}`);
  }
});

process.env.BUCKET = 'test-bucket';
const { handler: ingest } = await import('../ingest.mjs');
const { normalizeMaster, isAcceptedFormat } = await import('../lib/master.mjs');
const { handler: transform } = await import('../transform.mjs');

const s3Event = (key, size = 1000) => ({ Records: [{ s3: { bucket: { name: 'test-bucket' }, object: { key, size } } }] });

test('ingest writes the master and removes the upload', async () => {
  store.clear();
  store.set(`incoming/${HASH}`, await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#123' } }).png().toBuffer());
  await ingest(s3Event(`incoming/${HASH}`));
  assert.ok(store.has(`media/${HASH}.jpg`));
  assert.ok(!store.has(`incoming/${HASH}`));
  assert.equal((await sharp(store.get(`media/${HASH}.jpg`)).metadata()).width, 1600);
});

test('ingest drops an invalid upload without writing a master', async () => {
  store.clear();
  store.set(`incoming/${HASH}`, Buffer.from('garbage'));
  await ingest(s3Event(`incoming/${HASH}`));
  assert.ok(!store.has(`media/${HASH}.jpg`));
  assert.ok(!store.has(`incoming/${HASH}`));
});

test('ingest deletes an oversized upload without downloading it', async () => {
  store.clear();
  calls.length = 0;
  // A valid small image: only the size guard can cause the rejection.
  store.set(`incoming/${HASH}`, await sharp({ create: { width: 10, height: 10, channels: 3, background: '#123' } }).png().toBuffer());
  await ingest(s3Event(`incoming/${HASH}`, 11 * 1024 * 1024));
  assert.ok(!calls.includes('GetObjectCommand'));
  assert.ok(!store.has(`media/${HASH}.jpg`));
  assert.ok(!store.has(`incoming/${HASH}`));
});

test('ingest propagates a failed master write and keeps the upload', async () => {
  store.clear();
  store.set(`incoming/${HASH}`, await sharp({ create: { width: 10, height: 10, channels: 3, background: '#123' } }).png().toBuffer());
  failPut = true;
  try {
    await assert.rejects(ingest(s3Event(`incoming/${HASH}`)), /put failed/);
  } finally {
    failPut = false;
  }
  assert.ok(store.has(`incoming/${HASH}`));
});

test('ingest treats a missing upload as already processed', async () => {
  store.clear();
  await ingest(s3Event(`incoming/${HASH}`));
  assert.ok(!store.has(`media/${HASH}.jpg`));
});

test('normalizeMaster accepts AVIF and rejects HEIC metadata', async () => {
  const avif = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#789' } }).avif().toBuffer();
  const out = await normalizeMaster(avif);
  assert.equal((await sharp(out).metadata()).format, 'jpeg');
  assert.equal(isAcceptedFormat({ format: 'heif', compression: 'av1' }), true);
  assert.equal(isAcceptedFormat({ format: 'heif', compression: 'hevc' }), false);
});

test('transform serves a variant in the negotiated format with immutable caching', async () => {
  store.clear();
  store.set(`media/${HASH}.jpg`, await sharp({ create: { width: 1600, height: 800, channels: 3, background: '#456' } }).jpeg().toBuffer());
  const res = await transform({ rawPath: `/img/${HASH}/thumb`, headers: { accept: 'image/webp,*/*' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'image/webp');
  assert.match(res.headers['cache-control'], /immutable/);
  assert.equal(res.isBase64Encoded, true);
  assert.equal((await sharp(Buffer.from(res.body, 'base64')).metadata()).width, 240);
});

test('transform answers 404 for an unknown photo or path', async () => {
  store.clear();
  assert.equal((await transform({ rawPath: `/img/${HASH}/card`, headers: {} })).statusCode, 404);
  assert.equal((await transform({ rawPath: '/nope', headers: {} })).statusCode, 404);
});
