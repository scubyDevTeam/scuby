// Lambda Function URL behind CloudFront: /img/<sha256>/<variant> → the variant, format by Accept.
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { parseImagePath, pickFormat, renderVariant } from './lib/variants.mjs';

const s3 = new S3Client({});
const notFound = { statusCode: 404, headers: { 'content-type': 'text/plain' }, body: 'not found' };

export async function handler(event) {
  const parsed = parseImagePath(event.rawPath);
  if (!parsed) return notFound;
  let master;
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.BUCKET, Key: `media/${parsed.hash}.jpg` }));
    master = Buffer.from(await obj.Body.transformToByteArray());
  } catch (e) {
    if (e.name === 'NoSuchKey') return notFound;
    throw e;
  }
  const format = pickFormat(event.headers?.accept);
  const body = await renderVariant(master, parsed.variant, format);
  return {
    statusCode: 200,
    isBase64Encoded: true,
    headers: {
      'content-type': `image/${format}`,
      'cache-control': 'public, max-age=31536000, immutable',
      vary: 'Accept',
    },
    body: body.toString('base64'),
  };
}
