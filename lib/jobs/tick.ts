// lib/jobs/tick.ts — the pump: advances every `processing` job for a viewer, or a single job
// by id (used by the delayed-task watchdog callback and the HeyGen webhook).
import { dbGet, dbList } from '../db'
import { logger } from '../logger'
import { pollVideoJob } from './generation'
import { pollAvatarJob } from './onboarding'
import type { JobRow } from '../types'

export interface TickResult {
  advanced: number
  checked: number
}

/** Safe to call redundantly — each branch re-checks job.status before doing anything, so a job
 *  already moved to ready/failed by a concurrent caller is simply skipped (re-entrant tick). */
export async function tick(opts: { viewerId?: string; jobId?: string; token: string }): Promise<TickResult> {
  const { token } = opts
  let candidates: JobRow[] = []
  if (opts.jobId) {
    const job = await dbGet<JobRow>('jobs', opts.jobId, token).catch(() => null)
    candidates = job ? [job] : []
  } else if (opts.viewerId) {
    candidates = await dbList<JobRow>('jobs', { viewer_id: opts.viewerId, status: 'processing' }, token)
  }

  let advanced = 0
  for (const job of candidates) {
    if (job.status !== 'processing') continue
    try {
      let didAdvance = false
      if (job.type === 'video_gen') {
        didAdvance = await pollVideoJob(job, token)
      } else if (job.type === 'avatar_create') {
        didAdvance = await pollAvatarJob(job, token)
      } else {
        // voice_gen/voice_swap/transcribe/notes/voice_clone run to completion synchronously
        // when they're started — if one is stuck in `processing` here, the run that started
        // it crashed mid-flight. Nothing safe to resume without re-running the whole step, so
        // we just log for visibility; the client can retry generation from the project.
        logger.warn({ msg: 'tick: found stuck synchronous job in processing state', jobId: job.id, type: job.type })
      }
      if (didAdvance) advanced += 1
    } catch (err) {
      logger.error({ msg: 'tick: error advancing job', jobId: job.id, type: job.type, err })
    }
  }
  return { advanced, checked: candidates.length }
}
