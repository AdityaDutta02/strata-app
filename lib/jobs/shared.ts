// lib/jobs/shared.ts — helpers shared by the generation chain and the onboarding chain:
// asset storage, credit refund-on-failure (with project-wide cascade), and delayed-task
// watchdog scheduling (capped at 5 re-schedules per job per BUILD-SPEC-MVP).
import { dbGet, dbInsert, dbList, dbUpdate } from '../db'
import { getPresignedUploadUrl, storageUpload } from '../storage'
import { createDelayedTask } from '../task-sdk'
import { logger } from '../logger'
import { getWorkspace, refundCredits } from '../credits'
import { providerTimeout } from '../providers/provider-error'
import type { AssetKind, AssetRow, JobRow, ProjectRow } from '../types'

export class JobValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JobValidationError'
  }
}

export const WATCHDOG_CAP = 5

export async function markJobReady(job: JobRow, outputPatch: Record<string, unknown>, token: string): Promise<void> {
  await dbUpdate<JobRow>(
    'jobs',
    job.id,
    {
      status: 'ready',
      output_json: { ...job.output_json, ...outputPatch },
      credits_charged: job.credits_reserved,
    },
    token,
  )
}

export async function storeAsset(params: {
  viewerId: string
  projectId: string | null
  jobId: string | null
  kind: AssetKind
  buffer: Buffer
  contentType: string
  filename: string
  token: string
}): Promise<AssetRow> {
  const key = `strata/${params.viewerId}/${params.projectId ?? 'onboarding'}/${params.kind}/${params.jobId ?? 'na'}-${params.filename}`
  const FIFTY_MB = 50 * 1024 * 1024
  if (params.buffer.byteLength <= FIFTY_MB) {
    await storageUpload(key, params.buffer, params.contentType, params.token)
  } else {
    const presigned = await getPresignedUploadUrl(key, params.contentType, params.buffer.byteLength, params.token)
    const putRes = await fetch(presigned.url, { method: 'PUT', headers: { 'Content-Type': params.contentType }, body: new Uint8Array(params.buffer) })
    if (!putRes.ok) throw new Error(`presigned asset upload failed: ${putRes.status}`)
  }
  return dbInsert<AssetRow>(
    'assets',
    {
      viewer_id: params.viewerId,
      project_id: params.projectId,
      job_id: params.jobId,
      kind: params.kind,
      storage_key: key,
      size_bytes: params.buffer.byteLength,
      meta_json: {},
    },
    params.token,
  )
}

export async function downloadBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: providerTimeout() })
  if (!res.ok) throw new Error(`failed to download ${url}: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/** Refunds whatever a job had reserved (idempotent: no-op if already charged/refunded) and
 *  marks it failed. Optionally cascades to sibling jobs for the same project (cancel + refund
 *  their reservations too) and marks the project failed. */
export async function failJob(
  job: JobRow,
  token: string,
  message: string,
  opts: { cascadeProject?: boolean } = {},
): Promise<void> {
  logger.error({ msg: 'job failed', jobId: job.id, type: job.type, err: message })
  if (job.credits_reserved > 0 && job.credits_charged === 0) {
    const workspace = await getWorkspace(job.viewer_id, token)
    if (workspace) {
      await refundCredits(workspace, job.credits_reserved, token, { jobId: job.id, note: `refund: ${message}` })
      await decrementProjectSpent(job, token, job.credits_reserved)
    }
  }
  await dbUpdate<JobRow>('jobs', job.id, { status: 'failed', error: message }, token)

  if (opts.cascadeProject && job.project_id) {
    const siblings = await dbList<JobRow>('jobs', { project_id: job.project_id }, token)
    for (const sibling of siblings) {
      if (sibling.id === job.id) continue
      if (sibling.status !== 'queued' && sibling.status !== 'processing') continue
      if (sibling.credits_reserved > 0 && sibling.credits_charged === 0) {
        const workspace = await getWorkspace(sibling.viewer_id, token)
        if (workspace) {
          await refundCredits(workspace, sibling.credits_reserved, token, { jobId: sibling.id, note: 'cascaded cancellation' })
          await decrementProjectSpent(sibling, token, sibling.credits_reserved)
        }
      }
      await dbUpdate<JobRow>('jobs', sibling.id, { status: 'cancelled' }, token)
    }
    await dbUpdate<ProjectRow>('projects', job.project_id, { status: 'failed' }, token)
  }
  logger.info({ msg: 'job failure handled', jobId: job.id })
}

/** Keeps projects.credits_spent in sync when a reservation is refunded. */
async function decrementProjectSpent(job: JobRow, token: string, amount: number): Promise<void> {
  if (!job.project_id || amount <= 0) return
  try {
    const project = await dbGet<ProjectRow>('projects', job.project_id, token)
    await dbUpdate<ProjectRow>('projects', project.id, { credits_spent: Math.max(0, (project.credits_spent ?? 0) - amount) }, token)
  } catch (err: unknown) {
    logger.warn({ msg: 'credits_spent decrement failed', projectId: job.project_id, err: String(err) })
  }
}

export async function scheduleWatchdog(job: JobRow, token: string): Promise<void> {
  try {
    const count = typeof job.input_json.watchdogCount === 'number' ? job.input_json.watchdogCount : 0
    if (count >= WATCHDOG_CAP) {
      logger.warn({ msg: 'watchdog cap reached; not scheduling another delayed task', jobId: job.id, count })
      return
    }
    await createDelayedTask(
      { name: `strata-job-tick-${job.id}`, callbackPath: '/api/jobs/tick', delayMinutes: 5, payload: { jobId: job.id } },
      token,
    )
    await dbUpdate<JobRow>('jobs', job.id, { input_json: { ...job.input_json, watchdogCount: count + 1 } }, token)
  } catch (err) {
    // Best-effort: the client-polling path (GET /api/jobs) still advances the pipeline even if
    // the watchdog never fires, so a failure here must not fail the caller's request.
    logger.warn({ msg: 'failed to schedule watchdog delayed task', jobId: job.id, err })
  }
}
