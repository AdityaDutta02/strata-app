// lib/jobs/visibility.ts — "hidden" (removed) state for avatars/voices lives in the latest
// relevant job's output_json, not a DB column (the platform doesn't apply ALTER migrations —
// same reason heygenGroupId/consentUrl live here too). Never deletes anything; only flags.
import { dbList, dbUpdate } from '../db'
import type { JobRow, JobType, VoiceRow } from '../types'

export async function latestJob(
  type: JobType,
  idKey: string,
  id: string,
  viewerId: string,
  token: string,
): Promise<JobRow | null> {
  const jobs = await dbList<JobRow>('jobs', { viewer_id: viewerId, type }, token)
  const related = jobs
    .filter((j) => j.input_json[idKey] === id)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  return related[0] ?? null
}

export function isHidden(job: JobRow | null): boolean {
  return job?.output_json.hidden === true
}

/** Hides the avatar's latest avatar_create job and the viewer's one currently-visible
 *  voice's latest voice_clone job. MVP caps at one visible avatar+voice pair per viewer, so
 *  there is at most one unhidden voice to hide alongside the avatar. Idempotent. */
export async function hideAvatarAndVoice(avatarId: string, viewerId: string, token: string): Promise<void> {
  const avatarJob = await latestJob('avatar_create', 'avatarId', avatarId, viewerId, token)
  if (avatarJob && !isHidden(avatarJob)) {
    await dbUpdate<JobRow>('jobs', avatarJob.id, { output_json: { ...avatarJob.output_json, hidden: true } }, token)
  }
  const voices = await dbList<VoiceRow>('voices', { viewer_id: viewerId }, token)
  for (const voice of voices) {
    const voiceJob = await latestJob('voice_clone', 'voiceId', voice.id, viewerId, token)
    if (voiceJob && !isHidden(voiceJob)) {
      await dbUpdate<JobRow>('jobs', voiceJob.id, { output_json: { ...voiceJob.output_json, hidden: true } }, token)
      break
    }
  }
}
