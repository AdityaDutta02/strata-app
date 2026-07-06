// lib/logger.ts — structured JSON logger. Never use console.log elsewhere in this codebase;
// always go through one of the level methods below so every log line is a single JSON object
// (easy to grep/parse in the deploy platform's log viewer).

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LogFields {
  msg: string
  [key: string]: unknown
}

function serializeError(err: unknown): Record<string, unknown> | undefined {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack }
  }
  if (err === undefined) return undefined
  return { value: String(err) }
}

function emit(level: LogLevel, fields: LogFields): void {
  const { err, ...rest } = fields as LogFields & { err?: unknown }
  const line = {
    level,
    time: new Date().toISOString(),
    ...rest,
    ...(err !== undefined ? { err: serializeError(err) } : {}),
  }
  const json = JSON.stringify(line)
  // eslint-disable-next-line no-console -- this is the one sanctioned sink for structured logs
  if (level === 'error' || level === 'warn') {
    process.stderr.write(json + '\n')
  } else {
    process.stdout.write(json + '\n')
  }
}

export const logger = {
  debug(fields: LogFields): void {
    emit('debug', fields)
  },
  info(fields: LogFields): void {
    emit('info', fields)
  },
  warn(fields: LogFields): void {
    emit('warn', fields)
  },
  error(fields: LogFields): void {
    emit('error', fields)
  },
}
