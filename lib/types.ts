// lib/types.ts — shared row shapes mirroring db-migrations.sql exactly.
// Backend-only; not re-exported to client bundles.

export interface WorkspaceRow {
  id: string
  viewer_id: string
  name: string
  credits_balance: number
  trial_credits_left: number
  trial_granted: boolean
  first_avatar_comped: boolean
  created_at: string
}

export type ProjectStage = 'script' | 'voice' | 'video' | 'render' | 'publish'
export type ProjectStatus = 'draft' | 'processing' | 'ready' | 'failed'
export type ProjectFormat = 'short' | 'long'
export type VoiceMode = 'tts' | 'swap'

export interface ProjectRow {
  id: string
  viewer_id: string
  title: string
  stage: ProjectStage
  status: ProjectStatus
  script: string
  format: ProjectFormat
  language: string
  voice_id: string | null
  avatar_id: string | null
  voice_mode: VoiceMode
  credits_spent: number
  created_at: string
  updated_at: string
}

export type TrainingStatus = 'training' | 'ready' | 'failed'

export interface VoiceRow {
  id: string
  viewer_id: string
  name: string
  language: string
  status: TrainingStatus
  fish_voice_id: string | null
  kits_voice_id: string | null
  sample_key: string | null
  error: string | null
  created_at: string
}

export interface AvatarRow {
  id: string
  viewer_id: string
  name: string
  status: TrainingStatus
  heygen_avatar_id: string | null
  training_video_key: string | null
  thumb_key: string | null
  error: string | null
  created_at: string
}

export type JobType =
  | 'voice_gen'
  | 'voice_swap'
  | 'video_gen'
  | 'transcribe'
  | 'notes'
  | 'avatar_create'
  | 'voice_clone'
export type JobStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'cancelled'

export interface JobRow {
  id: string
  viewer_id: string
  project_id: string | null
  type: JobType
  status: JobStatus
  provider_job_id: string | null
  input_json: Record<string, unknown>
  output_json: Record<string, unknown>
  credits_reserved: number
  credits_charged: number
  error: string | null
  created_at: string
  updated_at: string
}

export type AssetKind = 'audio' | 'video' | 'transcript' | 'notes' | 'notes_pdf' | 'upload'

export interface AssetRow {
  id: string
  viewer_id: string
  project_id: string | null
  job_id: string | null
  kind: AssetKind
  storage_key: string
  duration_sec: number | null
  size_bytes: number | null
  meta_json: Record<string, unknown>
  created_at: string
}

export type LedgerType = 'debit' | 'topup' | 'trial_grant' | 'refund'

export interface CreditLedgerRow {
  id: string
  workspace_id: string
  delta: number
  type: LedgerType
  job_id: string | null
  note: string
  balance_after: number
  created_at: string
}

export interface WordTiming {
  word: string
  start: number
  end: number
}

export interface TranscriptWord extends WordTiming {}

export interface TimedLine {
  t0: number
  t1: number
  text: string
}

export interface NotesLine {
  t0: number
  t1: number
  line: string
  cueType?: string
  direction?: string
  source?: { url: string; title: string }
}
