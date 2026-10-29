// Presigned upload → ingest → variant, against the applied sandbox. Exit 1 on the first failure.
// Usage: node smoke/upload-smoke.mjs <bucket> <image-url>
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const [bucket, imageUrl] = process.argv.slice(2);
if (!bucket || !imageUrl) { console.error('usage: upload-smoke.mjs <bucket> <image-url>'); process.exit(2); }

// Only the checksum we choose is signed; no automatic CRC32 on presigned URLs.
const s3 = new S3Client({ region: 'us-east-1', requestChecksumCalculation: 'WHEN_REQUIRED' });
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exit(1);
};

const photo = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#8b5a2b' } })
  .withExif({ IFD0: { Copyright: 'smoke' } }).jpeg().toBuffer();
const digest = createHash('sha256').update(photo).digest();
const hex = digest.toString('hex');
const b64 = digest.toString('base64');

const url = await getSignedUrl(
  s3,
  new PutObjectCommand({ Bucket: bucket, Key: `incoming/${hex}`, ContentType: 'image/jpeg', ChecksumSHA256: b64 }),
  { expiresIn: 300, unhoistableHeaders: new Set(['x-amz-checksum-sha256']) },
);

const wrong = await fetch(url, { method: 'PUT', body: Buffer.concat([photo, Buffer.from('x')]),
  headers: { 'content-type': 'image/jpeg', 'x-amz-checksum-sha256': b64 } });
const wrongBody = await wrong.text();
// Must be the checksum refusal (BadDigest), not a signature error that would also be a 4xx.
check('S3 rejects bytes that do not match the signed SHA-256', wrong.status === 400 && /BadDigest|XAmzContentChecksumMismatch/.test(wrongBody),
  `status ${wrong.status} ${wrongBody.slice(0, 120)}`);

const put = await fetch(url, { method: 'PUT', body: photo,
  headers: { 'content-type': 'image/jpeg', 'x-amz-checksum-sha256': b64 } });
check('presigned PUT with the matching SHA-256', put.status === 200, `status ${put.status}`);

let master = false;
for (let i = 0; i < 30 && !master; i++) {
  try { await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: `media/${hex}.jpg` })); master = true; }
  catch { await new Promise((r) => setTimeout(r, 2000)); }
}
check('ingest Lambda wrote the master', master, `media/${hex}.jpg`);

const card = await fetch(`${imageUrl}/img/${hex}/card`, { headers: { accept: 'image/webp,*/*' } });
const cardBytes = Buffer.from(await card.arrayBuffer());
const meta = card.ok ? await sharp(cardBytes).metadata() : {};
check('card variant through CloudFront is WebP ≤ 800 px', card.status === 200 && meta.format === 'webp' && meta.width <= 800,
  `status ${card.status}, ${meta.format} ${meta.width}x${meta.height}`);
check('variant has no EXIF', meta.exif === undefined);
check('variant is cacheable as immutable', /immutable/.test(card.headers.get('cache-control') ?? ''));

const avif = await fetch(`${imageUrl}/img/${hex}/thumb`, { headers: { accept: 'image/avif,*/*' } });
check('thumb negotiates AVIF', avif.headers.get('content-type') === 'image/avif', avif.headers.get('content-type'));

const missing = await fetch(`${imageUrl}/img/${'0'.repeat(64)}/card`);
check('unknown photo answers 404', missing.status === 404, `status ${missing.status}`);
