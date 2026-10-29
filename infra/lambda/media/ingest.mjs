// S3 ObjectCreated on incoming/<sha256> → media/<sha256>.jpg; the upload is always removed.
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { normalizeMaster, masterKeyFor } from './lib/master.mjs';

const s3 = new S3Client({});
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function handler(event) {
  for (const record of event.Records ?? []) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    const target = masterKeyFor(key);
    if (!target) {
      console.warn(JSON.stringify({ msg: 'ignored key', key }));
      continue;
    }
    // Never download an oversized object: the presigned URL does not bound the size.
    if ((record.s3.object.size ?? 0) > MAX_UPLOAD_BYTES) {
      console.warn(JSON.stringify({ msg: 'upload rejected', key, reason: 'too large' }));
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      continue;
    }
    let obj;
    try {
      obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    } catch (e) {
      if (e.name === 'NoSuchKey') {
        // Duplicate S3 event: the upload was already processed and removed.
        console.warn(JSON.stringify({ msg: 'already processed', key }));
        continue;
      }
      throw e;
    }
    const input = Buffer.from(await obj.Body.transformToByteArray());
    let master;
    try {
      master = await normalizeMaster(input);
    } catch (e) {
      console.warn(JSON.stringify({ msg: 'upload rejected', key, reason: e.message }));
    }
    // Outside the rejection catch: a failed write must throw so Lambda retries and the upload survives.
    if (master) {
      await s3.send(new PutObjectCommand({
        Bucket: bucket, Key: target, Body: master,
        ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable',
      }));
    }
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
}
