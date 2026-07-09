// lib/providers/heygen.ts — HeyGen v3 API (digital-twin avatar creation + Avatar V talking-head video).
// Docs: https://developers.heygen.com
//   POST /v3/avatars                    (type "digital_twin" — create avatar from training footage URL)
//   GET  /v3/avatars/looks/{look_id}    (poll avatar training: processing|pending_consent|completed|failed)
//   POST /v3/videos                     (type "avatar", audio_url input, aspect_ratio 9:16, engine avatar_v)
//   GET  /v3/videos/{video_id}          (poll video: pending|processing|completed|failed)
// Auth: x-api-key header. Legacy v1/v2 endpoints sunset 2026-10-31. Env: HEYGEN_API_KEY.
import { logProviderCall } from './audit'
import { isMockMode } from './mock'
import { ProviderError, providerTimeout } from './provider-error'

const BASE = 'https://api.heygen.com/v3'

function apiKey(): string {
  const key = process.env.HEYGEN_API_KEY
  if (!key) throw new ProviderError('heygen', 'HEYGEN_API_KEY is not configured')
  return key
}

/** Reads an error response body (truncated) so failures carry HeyGen's diagnostic message. */
async function errorDetail(res: Response): Promise<string> {
  const body = await res.text().catch(() => '')
  return body ? `: ${body.slice(0, 300)}` : ''
}

export interface HeygenAsset {
  assetId: string
  url: string
}

const ASSET_MAX_BYTES = 32 * 1024 * 1024

/** Uploads bytes to HeyGen's own asset store (max 32MB — mp3/wav/mp4/webm/png/jpeg).
 *  The returned URL is HeyGen-hosted, so their render workers can always fetch it. */
export async function uploadAsset(
  buffer: Buffer,
  contentType: string,
  filename: string,
  viewerId: string,
  token: string,
): Promise<HeygenAsset> {
  await logProviderCall(viewerId, 'heygen.uploadAsset', { bytes: buffer.byteLength, contentType }, token)
  if (isMockMode(token)) {
    return { assetId: `mock-asset-${buffer.byteLength}`, url: `mock://asset/${filename}` }
  }
  if (buffer.byteLength > ASSET_MAX_BYTES) {
    throw new ProviderError('heygen', `asset too large for HeyGen upload (${buffer.byteLength} bytes, max 32MB)`)
  }
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(buffer)], { type: contentType }), filename)
  const res = await fetch(`${BASE}/assets`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey() },
    body: form,
    signal: providerTimeout(),
  })
  if (!res.ok) throw new ProviderError('heygen', `uploadAsset failed: ${res.status}${await errorDetail(res)}`, res.status)
  const body = (await res.json()) as { data?: { asset_id?: string; url?: string } }
  const assetId = body.data?.asset_id
  const url = body.data?.url
  if (!assetId || !url) throw new ProviderError('heygen', 'uploadAsset: missing asset id/url in response')
  return { assetId, url }
}

interface HeygenApiError {
  code?: string
  message?: string
}

export interface HeygenAvatarStatus {
  status: 'training' | 'ready' | 'failed'
  /** True while HeyGen waits for the browser-based consent approval (raw status pending_consent). */
  pendingConsent?: boolean
  error?: string
}

export interface HeygenCreatedAvatar {
  avatarId: string
  /** Avatar group id — needed for the consent endpoint. May be absent in mock mode. */
  groupId?: string
  /** True only if HeyGen's create-avatar response reports a non-null consent_status — most
   *  digital twins don't require it, in which case the look is usable immediately. */
  needsConsent: boolean
}

/** The training-footage source handed to HeyGen. Prefer `asset_id` (HeyGen-hosted, uploaded
 *  via POST /v3/assets) — HeyGen's render network cannot reach our platform subdomain, so a
 *  `url` pointing at our own origin fails with "Could not download the file". */
export type HeygenFileInput =
  | { type: 'url'; url: string }
  | { type: 'asset_id'; asset_id: string }

export interface HeygenVideoStatus {
  status: 'processing' | 'ready' | 'failed'
  videoUrl?: string
  error?: string
}

type NormalizedStatus = 'ready' | 'failed' | 'pending'

function normalizeStatus(raw: string | undefined): NormalizedStatus {
  if (raw === 'completed') return 'ready'
  if (raw === 'failed') return 'failed'
  // 'pending' | 'waiting' | 'processing' | 'pending_consent' | unknown → keep polling.
  return 'pending'
}

/** Kicks off digital-twin avatar creation from an uploaded training video. Returns HeyGen's
 *  avatar look id (poll with avatarStatus) plus the avatar group id (for the consent flow). */
export async function createAvatar(file: HeygenFileInput, viewerId: string, token: string): Promise<HeygenCreatedAvatar> {
  await logProviderCall(viewerId, 'heygen.createAvatar', { file }, token)
  if (isMockMode(token)) {
    const seed = file.type === 'url' ? file.url : file.asset_id
    const suffix = Buffer.from(seed).toString('hex').slice(0, 12)
    return { avatarId: `mock-avatar-${suffix}`, groupId: `mock-group-${suffix}`, needsConsent: false }
  }
  const res = await fetch(`${BASE}/avatars`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'digital_twin',
      name: `strata-${viewerId}`,
      file,
    }),
    signal: providerTimeout(),
  })
  if (!res.ok) throw new ProviderError('heygen', `createAvatar failed: ${res.status}${await errorDetail(res)}`, res.status)
  const body = (await res.json()) as {
    data?: {
      avatar_item?: { id?: string; avatar_group_id?: string; group_id?: string }
      avatar_group?: { id?: string; consent_status?: string | null }
    }
  }
  const avatarId = body.data?.avatar_item?.id
  if (!avatarId) throw new ProviderError('heygen', 'createAvatar: missing avatar id in response')
  const groupId =
    body.data?.avatar_item?.avatar_group_id ?? body.data?.avatar_item?.group_id ?? body.data?.avatar_group?.id
  // Per HeyGen's docs, POST /v3/avatars returns the finished look immediately — there is no
  // async "training" step in the response. The only real wait is consent (digital twins may
  // require it); consent_status is null/absent when none is needed, in which case the avatar
  // is usable right away.
  const consentStatus = body.data?.avatar_group?.consent_status ?? null
  return { avatarId, groupId, needsConsent: Boolean(consentStatus) }
}

/** Requests the consent-approval URL for an avatar group stuck in pending_consent. The person
 *  in the training footage opens the URL and approves; training then resumes (detected by
 *  the regular avatarStatus polling). `rerouteUrl` is where HeyGen redirects after approval. */
export async function requestConsent(
  groupId: string,
  viewerId: string,
  token: string,
  rerouteUrl?: string,
): Promise<{ url: string }> {
  await logProviderCall(viewerId, 'heygen.requestConsent', { groupId }, token)
  if (isMockMode(token)) {
    return { url: `https://mock.heygen.example/consent/${groupId}` }
  }
  const res = await fetch(`${BASE}/avatars/${encodeURIComponent(groupId)}/consent`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify(rerouteUrl ? { reroute_url: rerouteUrl } : {}),
    signal: providerTimeout(),
  })
  if (!res.ok) throw new ProviderError('heygen', `requestConsent failed: ${res.status}${await errorDetail(res)}`, res.status)
  const body = (await res.json()) as { data?: { url?: string }; url?: string }
  const url = body.data?.url ?? body.url
  if (!url) throw new ProviderError('heygen', 'requestConsent: missing consent url in response')
  return { url }
}

export async function avatarStatus(avatarId: string, viewerId: string, token: string): Promise<HeygenAvatarStatus> {
  if (isMockMode(token)) return { status: 'ready' }
  const res = await fetch(`${BASE}/avatars/looks/${encodeURIComponent(avatarId)}`, {
    headers: { 'x-api-key': apiKey() },
    signal: providerTimeout(),
  })
  if (!res.ok) throw new ProviderError('heygen', `avatarStatus failed: ${res.status}${await errorDetail(res)}`, res.status)
  const body = (await res.json()) as { data?: { status?: string; error?: HeygenApiError | null } }
  const raw = body.data?.status
  const normalized = normalizeStatus(raw)
  const status: HeygenAvatarStatus['status'] = normalized === 'ready' ? 'ready' : normalized === 'failed' ? 'failed' : 'training'
  await logProviderCall(viewerId, 'heygen.avatarStatus', { avatarId, status, raw }, token)
  return {
    status,
    pendingConsent: raw === 'pending_consent',
    error:
      body.data?.error?.message ??
      (raw === 'pending_consent'
        ? 'HeyGen consent approval pending — the browser-based consent flow has not been completed for this avatar'
        : undefined),
  }
}

/** Starts Avatar V talking-head video generation for a trained avatar + a rendered audio
 *  track. Returns HeyGen's video id (poll with videoStatus). */
export async function createVideo(
  avatarId: string,
  audioUrl: string,
  viewerId: string,
  token: string,
  resolution: '720p' | '1080p' = '720p',
  aspectRatio: '9:16' | '16:9' = '9:16',
): Promise<string> {
  await logProviderCall(viewerId, 'heygen.createVideo', { avatarId, audioUrl, resolution, aspectRatio }, token)
  if (isMockMode(token)) {
    return `mock-video-${Buffer.from(avatarId + audioUrl).toString('hex').slice(0, 12)}`
  }
  const res = await fetch(`${BASE}/videos`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'avatar',
      avatar_id: avatarId,
      audio_url: audioUrl,
      aspect_ratio: aspectRatio,
      resolution,
      engine: { type: 'avatar_v' },
    }),
    signal: providerTimeout(),
  })
  if (!res.ok) throw new ProviderError('heygen', `createVideo failed: ${res.status}${await errorDetail(res)}`, res.status)
  const body = (await res.json()) as { data?: { video_id?: string } }
  const videoId = body.data?.video_id
  if (!videoId) throw new ProviderError('heygen', 'createVideo: missing video id in response')
  return videoId
}

export async function videoStatus(videoId: string, viewerId: string, token: string): Promise<HeygenVideoStatus> {
  if (isMockMode(token)) {
    return { status: 'ready', videoUrl: `mock://video/${videoId}.mp4` }
  }
  const res = await fetch(`${BASE}/videos/${encodeURIComponent(videoId)}`, {
    headers: { 'x-api-key': apiKey() },
    signal: providerTimeout(),
  })
  if (!res.ok) throw new ProviderError('heygen', `videoStatus failed: ${res.status}${await errorDetail(res)}`, res.status)
  const body = (await res.json()) as {
    data?: { status?: string; video_url?: string; error?: HeygenApiError | null }
    error?: HeygenApiError | null
  }
  const normalized = normalizeStatus(body.data?.status)
  const status: HeygenVideoStatus['status'] = normalized === 'ready' ? 'ready' : normalized === 'failed' ? 'failed' : 'processing'
  await logProviderCall(viewerId, 'heygen.videoStatus', { videoId, status }, token)
  return {
    status,
    videoUrl: body.data?.video_url,
    error: body.data?.error?.message ?? body.error?.message,
  }
}
