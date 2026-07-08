// lib/storage-r2.ts — Cloudflare R2 client via raw fetch + hand-rolled AWS SigV4 signing.
// No SDK: @aws-sdk/client-s3's TypeScript types slowed next build's type-check phase past
// the platform's build timeout (~15min), even though only 2 calls are made at runtime.
// Only PUT (upload) and GET (download) are implemented — all the training pipeline needs.
import { createHash, createHmac } from 'crypto'

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest()
}

/** AWS's URI-encoding rules (RFC 3986, uppercase hex) — encodeURIComponent doesn't escape
 *  a handful of characters AWS requires escaped. */
function encodeRfc3986(component: string): string {
  return encodeURIComponent(component).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

function canonicalPath(bucket: string, key: string): string {
  const encodedKey = key.split('/').map(encodeRfc3986).join('/')
  return `/${bucket}/${encodedKey}`
}

interface SignedRequest {
  url: string
  headers: Record<string, string>
}

function signRequest(method: 'PUT' | 'GET', bucket: string, key: string, body: Buffer | null): SignedRequest {
  const accountId = env('R2_ACCOUNT_ID')
  const accessKeyId = env('R2_ACCESS_KEY_ID')
  const secretAccessKey = env('R2_SECRET_ACCESS_KEY')
  const host = `${accountId}.r2.cloudflarestorage.com`
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '') // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = sha256Hex(body ?? Buffer.alloc(0))
  const path = canonicalPath(bucket, key)

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')

  const credentialScope = `${dateStamp}/auto/s3/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n')

  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp)
  const kRegion = hmac(kDate, 'auto')
  const kService = hmac(kRegion, 's3')
  const kSigning = hmac(kService, 'aws4_request')
  const signature = hmac(kSigning, stringToSign).toString('hex')

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  return {
    url: `https://${host}${path}`,
    headers: {
      Host: host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: authorization,
    },
  }
}

export async function r2Upload(key: string, buffer: Buffer, contentType: string): Promise<void> {
  const bucket = env('R2_BUCKET')
  const { url, headers } = signRequest('PUT', bucket, key, buffer)
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': contentType },
    body: new Uint8Array(buffer),
  })
  if (!res.ok) throw new Error(`R2 upload failed: ${res.status} ${await res.text().catch(() => '')}`)
}

export async function r2Download(key: string): Promise<Buffer> {
  const bucket = env('R2_BUCKET')
  const { url, headers } = signRequest('GET', bucket, key, null)
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`R2 download failed: ${res.status} ${await res.text().catch(() => '')}`)
  return Buffer.from(await res.arrayBuffer())
}
