// Shared frontend types. Row shapes are re-exported (read-only) from lib/types.ts so the
// client never drifts from the actual Postgres columns in db-migrations.sql — the backend
// returns raw DB rows (snake_case) wrapped in per-endpoint envelope objects, while write
// payloads (POST/PATCH bodies) are validated by zod schemas that accept camelCase — see the
// *Input types below, which mirror those zod schemas exactly.
import type {
  AssetKind,
  AssetRow,
  AvatarRow,
  CreditLedgerRow,
  JobRow,
  JobType,
  JobStatus,
  NotesLine,
  ProjectFormat,
  ProjectRow,
  ProjectStage,
  ProjectStatus,
  TrainingStatus,
  TranscriptWord,
  VoiceMode,
  VoiceRow,
  WorkspaceRow,
} from "@/lib/types";

export type Stage = ProjectStage;
export type ProjectDbStatus = ProjectStatus;
export type Format = ProjectFormat;
export type Project = ProjectRow;
export type Voice = VoiceRow;
export type Avatar = AvatarRow;
export type Job = JobRow;
export type Asset = AssetRow;
export type Workspace = WorkspaceRow;
export type LedgerRow = CreditLedgerRow;
export type { JobType, JobStatus, AssetKind, TrainingStatus, VoiceMode, NotesLine, TranscriptWord };

// ── Write payloads (camelCase — match the zod schemas in app/api/**) ─────────────────────
export interface ProjectCreateInput {
  title: string;
  script?: string;
  format?: Format;
  language?: string;
  voiceMode?: VoiceMode;
}

export interface ProjectPatchInput {
  title?: string;
  script?: string;
  stage?: Stage;
  format?: Format;
  language?: string;
  voiceId?: string | null;
  avatarId?: string | null;
  voiceMode?: VoiceMode;
}

export type UploadKind = "script" | "avatar_training" | "voice_training" | "recording";

// ── Read response envelopes ───────────────────────────────────────────────────────────────
export interface MeResponse {
  workspace: Workspace | null;
  isAnon: boolean;
}

export interface WalletResponse {
  balance: number;
  trialLeft: number;
  ledger: LedgerRow[];
}

export interface EstimateResponse {
  minutes: number;
  credits: number;
}

export interface Transcript {
  text: string;
  words: TranscriptWord[];
}

export interface PresignResponse {
  url: string;
  key: string;
  expiresIn: number;
  maxBytes: number;
}

export interface AssetUrlResponse {
  url: string;
  expiresIn: number;
  kind: AssetKind;
}

export interface GenerateResponse {
  generationJobs: Job[];
}

export interface OnboardResponse {
  avatar: Avatar;
  voice: Voice;
  jobs: Job[];
}
