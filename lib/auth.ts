// lib/auth.ts — reads the viewer identity out of the `x-embed-token` header.
//
// SECURITY NOTE: decodeClaims() below decodes the JWT payload WITHOUT verifying its
// signature. That is safe ONLY because this app never uses the decoded claims to make a
// security decision by itself — every downstream call (lib/db.ts, lib/storage.ts,
// lib/terminal-ai.ts, lib/email-sdk.ts, lib/task-sdk.ts) forwards the raw token string to
// the Terminal AI gateway, which re-verifies the signature (and re-derives the real viewer)
// on every single request. The claims we read here are only used for: (a) display-only
// viewer id echoing / DB row scoping (the gateway would reject a forged token outright, so a
// forged viewerId can't be used to read someone else's data), and (b) opting into sandbox-safe
// mock behavior (lib/terminal-ai.ts `isSandbox` uses the identical pattern).
import { NextResponse } from 'next/server'
import { logger } from './logger'

export interface Viewer {
  /** Raw embed token — forward this to every db.ts / storage.ts / terminal-ai.ts call. */
  token: string
  /** Best-effort viewer id read from token claims (userId / sub). Empty string if absent. */
  viewerId: string
  isAnon: boolean
  isSandbox: boolean
}

interface TokenClaims {
  userId?: string
  sub?: string
  type?: string
  anon?: boolean
  isAnon?: boolean
}

function isTokenClaims(value: unknown): value is TokenClaims {
  return typeof value === 'object' && value !== null
}

function decodeClaims(token: string): TokenClaims {
  try {
    const part = token.split('.')[1]
    if (!part) return {}
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const parsed: unknown = JSON.parse(json)
    return isTokenClaims(parsed) ? parsed : {}
  } catch (err) {
    logger.warn({ msg: 'failed to decode embed token claims', err })
    return {}
  }
}

/** Reads and (unverified-)decodes the embed token from the request headers. Returns null if
 *  the header is missing or the token has no resolvable viewer id — callers should respond
 *  with `unauthorized()` in that case. */
export function getViewer(request: Request): Viewer | null {
  const token = request.headers.get('x-embed-token')
  if (!token) return null
  const claims = decodeClaims(token)
  const viewerId = claims.userId ?? claims.sub ?? ''
  if (!viewerId) return null
  const isAnon = claims.isAnon === true || claims.anon === true || claims.type === 'anon'
  const isSandboxToken = claims.type === 'sandbox'
  return { token, viewerId, isAnon, isSandbox: isSandboxToken }
}

/** True for task-execution callbacks (delayed task / cron) — these carry a token whose
 *  claims identify the task runner rather than an end viewer. jobs/tick accepts either this
 *  or a normal viewer token, since the payload carries the jobId to operate on directly. */
export function isTaskToken(request: Request): boolean {
  const token = request.headers.get('x-embed-token')
  if (!token) return false
  const claims = decodeClaims(token)
  return claims.type === 'task'
}

export function unauthorized(message = 'Missing or invalid embed token'): NextResponse {
  logger.warn({ msg: 'unauthorized request', reason: message })
  return NextResponse.json({ error: message, code: 'UNAUTHORIZED' }, { status: 401 })
}
