// lib/api-helpers.ts — shared error-to-HTTP-response mapping for app/api/** routes.
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { CreditError } from './credits'
import { JobValidationError } from './jobs'
import { logger } from './logger'

export function errorResponse(err: unknown, context: string): NextResponse {
  if (err instanceof ZodError) {
    logger.warn({ msg: 'validation error', context, issues: err.issues })
    return NextResponse.json({ error: 'Invalid request', code: 'VALIDATION_ERROR', issues: err.issues }, { status: 400 })
  }
  if (err instanceof CreditError) {
    logger.warn({ msg: 'insufficient credits', context, err: err.message })
    return NextResponse.json({ error: err.message, code: 'INSUFFICIENT_CREDITS' }, { status: 402 })
  }
  if (err instanceof JobValidationError) {
    logger.warn({ msg: 'job validation error', context, err: err.message })
    return NextResponse.json({ error: err.message, code: 'VALIDATION_ERROR' }, { status: 400 })
  }
  const message = err instanceof Error ? err.message : 'Unknown error'
  logger.error({ msg: 'unhandled route error', context, err })
  return NextResponse.json({ error: message, code: 'INTERNAL_ERROR' }, { status: 500 })
}

export function notFound(message = 'Not found'): NextResponse {
  return NextResponse.json({ error: message, code: 'NOT_FOUND' }, { status: 404 })
}
