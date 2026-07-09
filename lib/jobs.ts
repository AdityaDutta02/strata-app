// lib/jobs.ts — job engine entry point. Single-dispatcher, CRUD-only (no SELECT FOR UPDATE):
// jobs advance via (a) cheap client polls against GET /api/jobs, (b) the /api/jobs/tick pump
// invoked by a 5-minute delayed-task watchdog created whenever a provider job starts, and by
// HeyGen's webhook. See lib/jobs/* for the implementation, split by concern to stay under the
// 500-line-per-file limit:
//   lib/jobs/shared.ts      — asset storage, refund-on-failure (+ project cascade), watchdog
//   lib/jobs/generation.ts  — per-project chain: voice -> video -> transcribe -> notes
//   lib/jobs/onboarding.ts  — standalone chain: avatar_create + voice_clone
//   lib/jobs/tick.ts        — the pump that advances `processing` jobs
export { JobValidationError } from './jobs/shared'
export { createVoiceGeneration, createVideoGeneration, retryVideoGeneration } from './jobs/generation'
export type { GenerateVoiceBody, GenerateVideoBody } from './jobs/generation'
export { createOnboardingJobs } from './jobs/onboarding'
export type { OnboardBody } from './jobs/onboarding'
export { tick } from './jobs/tick'
export type { TickResult } from './jobs/tick'
