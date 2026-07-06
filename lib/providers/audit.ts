// lib/providers/audit.ts — every provider call (mock or real) appends an audit_log row.
import { dbInsert } from '../db'
import { logger } from '../logger'

export async function logProviderCall(
  viewerId: string,
  event: string,
  payload: Record<string, unknown>,
  token: string,
): Promise<void> {
  try {
    await dbInsert('audit_log', { viewer_id: viewerId, event, payload_json: payload }, token)
  } catch (err) {
    // Audit logging must never break the actual provider call it's describing.
    logger.warn({ msg: 'failed to write audit_log row', event, err })
  }
}
