// lib/storage-r2.ts — Cloudflare R2 client (S3-compatible). Used as a reliability buffer
// between our training pipeline and Terminal AI's storage backend: training footage is
// copied here once, so retries and every downstream read never touch the platform's storage
// host again. Server-side only — reads/writes go straight through the S3 SDK, no presigned
// URLs needed since only this server ever touches the bucket.
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import type { Readable } from 'stream'

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

function client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env('R2_ACCESS_KEY_ID'),
      secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    },
  })
}

export async function r2Upload(key: string, buffer: Buffer, contentType: string): Promise<void> {
  const bucket = env('R2_BUCKET')
  await client().send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: new Uint8Array(buffer), ContentType: contentType }),
  )
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array))
  }
  return Buffer.concat(chunks)
}

export async function r2Download(key: string): Promise<Buffer> {
  const bucket = env('R2_BUCKET')
  const res = await client().send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  return streamToBuffer(res.Body as Readable)
}
