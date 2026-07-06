// lib/providers/heygen.ts — HeyGen Avatar V (digital-twin avatar training + talking-head video).
// Docs: https://api.heygen.com/v2 (avatar training, video/generate with an audio input,
// video_status.get for polling). Env: HEYGEN_API_KEY.
import { logProviderCall } from './audit'
import { isMockMode } from './mock'
import { ProviderError, providerTimeout } from './provider-error'

const BASE = 'https://api.heygen.com/v2'

function apiKey(): string {
  const key = process.env.HEYGEN_API_KEY
  if (!key) throw new ProviderError('heygen', 'HEYGEN_API_KEY is not configured')
  return key
}

export interface HeygenAvatarStatus {
  status: 'training' | 'ready' | 'failed'
  error?: string
}

export interface HeygenVideoStatus {
  status: 'processing' | 'ready' | 'failed'
  videoUrl?: string
  error?: string
}

type NormalizedStatus = 'ready' | 'failed' | 'pending'

function normalizeStatus(raw: string | undefined): NormalizedStatus {
  if (raw === 'completed' || raw === 'ready') return 'ready'
  if (raw === 'failed' || raw === 'error') return 'failed'
  return 'pending'
}

/** Kicks off digital-twin avatar training from an uploaded training video. Returns HeyGen's
 *  avatar id (poll with avatarStatus). */
export async function createAvatar(videoUrl: string, viewerId: string, token: string): Promise<string> {
  await logProviderCall(viewerId, 'heygen.createAvatar', { videoUrl }, token)
  if (isMockMode(token)) {
    return `mock-avatar-${Buffer.from(videoUrl).toString('hex').slice(0, 12)}`
  }
  const res = await fetch(`${BASE}/photo_avatar/train`, {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_url: videoUrl }),
    signal: providerTimeout(),
  })
  if (!res.ok) throw new ProviderError('heygen', `createAvatar failed: ${res.status}`, res.status)
  const body = (await res.json()) as { data?: { avatar_id?: string; id?: string } }
  const avatarId = body.data?.avatar_id ?? body.data?.id
  if (!avatarId) throw new ProviderError('heygen', 'createAvatar: missing avatar id in response')
  return avatarId
}

export async function avatarStatus(avatarId: string, viewerId: string, token: string): Promise<HeygenAvatarStatus> {
  if (isMockMode(token)) return { status: 'ready' }
  const res = await fetch(`${BASE}/avatar_group/${encodeURIComponent(avatarId)}`, {
    headers: { 'X-Api-Key': apiKey() },
    signal: providerTimeout(),
  })
  if (!res.ok) throw new ProviderError('heygen', `avatarStatus failed: ${res.status}`, res.status)
  const body = (await res.json()) as { data?: { status?: string; error?: { message?: string } } }
  const normalized = normalizeStatus(body.data?.status)
  const status: HeygenAvatarStatus['status'] = normalized === 'ready' ? 'ready' : normalized === 'failed' ? 'failed' : 'training'
  await logProviderCall(viewerId, 'heygen.avatarStatus', { avatarId, status }, token)
  return { status, error: body.data?.error?.message }
}

/** Starts talking-head video generation for a trained avatar + a rendered audio track.
 *  Returns HeyGen's video id (poll with videoStatus). */
export async function createVideo(avatarId: string, audioUrl: string, viewerId: string, token: string): Promise<string> {
  await logProviderCall(viewerId, 'heygen.createVideo', { avatarId, audioUrl }, token)
  if (isMockMode(token)) {
    return `mock-video-${Buffer.from(avatarId + audioUrl).toString('hex').slice(0, 12)}`
  }
  const res = await fetch(`${BASE}/video/generate`, {
    method: 'POST',
    headers: { 'X-Api-Key': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      video_inputs: [
        {
          character: { type: 'avatar', avatar_id: avatarId },
          voice: { type: 'audio', audio_url: audioUrl },
        },
      ],
    }),
    signal: providerTimeout(),
  })
  if (!res.ok) throw new ProviderError('heygen', `createVideo failed: ${res.status}`, res.status)
  const body = (await res.json()) as { data?: { video_id?: string } }
  const videoId = body.data?.video_id
  if (!videoId) throw new ProviderError('heygen', 'createVideo: missing video id in response')
  return videoId
}

export async function videoStatus(videoId: string, viewerId: string, token: string): Promise<HeygenVideoStatus> {
  if (isMockMode(token)) {
    return { status: 'ready', videoUrl: `mock://video/${videoId}.mp4` }
  }
  const res = await fetch(`${BASE}/video_status.get?video_id=${encodeURIComponent(videoId)}`, {
    headers: { 'X-Api-Key': apiKey() },
    signal: providerTimeout(),
  })
  if (!res.ok) throw new ProviderError('heygen', `videoStatus failed: ${res.status}`, res.status)
  const body = (await res.json()) as { data?: { status?: string; video_url?: string; error?: { message?: string } } }
  const normalized = normalizeStatus(body.data?.status)
  const status: HeygenVideoStatus['status'] = normalized === 'ready' ? 'ready' : normalized === 'failed' ? 'failed' : 'processing'
  await logProviderCall(viewerId, 'heygen.videoStatus', { videoId, status }, token)
  return {
    status,
    videoUrl: body.data?.video_url,
    error: body.data?.error?.message,
  }
}
