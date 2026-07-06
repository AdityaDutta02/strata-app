// scripts/stub-gateway.mjs — local Terminal AI gateway stand-in for end-to-end verification.
// Implements just enough of /embed/authorize, /db/*, /storage/*, /tasks, /email for the app
// to run fully against localhost. NOT part of the deployed app.
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const PORT = Number(process.env.STUB_PORT ?? 9021)
const tables = new Map()
const blobs = new Map()

const table = (name) => {
  if (!tables.has(name)) tables.set(name, new Map())
  return tables.get(name)
}
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
const FAKE_TOKEN = `${b64url({ alg: 'none' })}.${b64url({ userId: 'e2e-viewer', sessionId: 'e2e-session', type: 'user' })}.sig`

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}
const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
  })

createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET,PUT,POST,PATCH,DELETE,OPTIONS')
  res.setHeader('access-control-allow-headers', '*')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const p = url.pathname
  const seg = p.split('/').filter(Boolean)

  if (p === '/embed/authorize') {
    const redirect = url.searchParams.get('redirect_uri') ?? 'http://localhost:3111/'
    const state = url.searchParams.get('state') ?? ''
    res.writeHead(302, { location: `${redirect}#token=${FAKE_TOKEN}&state=${state}` })
    return res.end()
  }

  if (seg[0] === 'db') {
    const name = seg[1]
    const id = seg[2]
    if (req.method === 'GET' && !id) {
      const rows = [...table(name).values()].filter((row) =>
        [...url.searchParams.entries()].every(([k, v]) => String(row[k]) === v),
      )
      return json(res, 200, rows)
    }
    if (req.method === 'GET') {
      const row = table(name).get(id)
      return row ? json(res, 200, row) : json(res, 404, { error: 'not found' })
    }
    if (req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}')
      const now = new Date().toISOString()
      const row = { id: randomUUID(), created_at: now, updated_at: now, ...body }
      table(name).set(row.id, row)
      return json(res, 200, row)
    }
    if (req.method === 'PATCH') {
      const existing = table(name).get(id)
      if (!existing) return json(res, 404, { error: 'not found' })
      const patch = JSON.parse((await readBody(req)).toString() || '{}')
      const updated = { ...existing, ...patch, updated_at: new Date().toISOString() }
      table(name).set(id, updated)
      return json(res, 200, updated)
    }
    if (req.method === 'DELETE') {
      table(name).delete(id)
      return json(res, 200, { ok: true })
    }
  }

  if (p === '/storage/presign-upload') {
    const body = JSON.parse((await readBody(req)).toString() || '{}')
    return json(res, 200, { url: `http://localhost:${PORT}/blob/${encodeURIComponent(body.key)}`, key: body.key, expiresIn: 900, maxBytes: body.size_bytes ?? 0 })
  }
  if (p === '/storage/presign-download') {
    const body = JSON.parse((await readBody(req)).toString() || '{}')
    return json(res, 200, { url: `http://localhost:${PORT}/blob/${encodeURIComponent(body.key)}`, expiresIn: 900 })
  }
  if (seg[0] === 'blob') {
    const key = decodeURIComponent(seg.slice(1).join('/'))
    if (req.method === 'PUT') {
      blobs.set(key, await readBody(req))
      return json(res, 200, { ok: true })
    }
    const blob = blobs.get(key)
    if (!blob) return json(res, 404, { error: 'no blob' })
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    return res.end(blob)
  }
  if (seg[0] === 'storage') {
    const key = decodeURIComponent(seg.slice(1).join('/'))
    if (req.method === 'PUT') {
      blobs.set(key, await readBody(req))
      return json(res, 200, { key })
    }
    if (req.method === 'GET' && key) {
      const blob = blobs.get(key)
      if (!blob) return json(res, 404, { error: 'no blob' })
      res.writeHead(200, { 'content-type': 'application/octet-stream' })
      return res.end(blob)
    }
    if (req.method === 'GET') return json(res, 200, [...blobs.keys()].map((k) => ({ key: k, size: blobs.get(k).length, lastModified: new Date().toISOString() })))
  }

  if (p === '/tasks/delayed') return json(res, 200, { id: randomUUID(), nextRunAt: new Date().toISOString(), oneShot: true })
  if (p === '/tasks') return json(res, 200, req.method === 'POST' ? { id: randomUUID(), nextRunAt: new Date().toISOString() } : [])
  if (p === '/email/send') return json(res, 200, { sent: true, messageId: 'stub' })
  if (p === '/v1/generate') return json(res, 200, { id: 'stub', content: '[]', model_used: 'stub', usage: { input_tokens: 0, output_tokens: 0 }, credits_charged: 0 })

  json(res, 404, { error: `stub: unhandled ${req.method} ${p}` })
}).listen(PORT, () => process.stdout.write(`stub gateway on :${PORT}\n`))
