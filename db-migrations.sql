-- db-migrations.sql — Strata schema (applied once at deploy time; per-app isolated Postgres 16)
-- No schema-qualified names. CRUD-only SDK: no transactions at runtime, so every
-- user-scoped table carries viewer_id and all writes are single-row.
-- Credit invariants (TECH-SPEC §8) are enforced in application code + unit tests:
-- ledger is append-only, balance_after = prev balance + delta, workspace.credits_balance
-- is a cache of the latest ledger row (single-user workspace + single dispatcher keeps
-- races out of the MVP write path).

CREATE TABLE IF NOT EXISTS workspaces (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id           TEXT NOT NULL UNIQUE,          -- solo v1: one workspace per Terminal viewer
  name                TEXT NOT NULL DEFAULT 'My workspace',
  credits_balance     INTEGER NOT NULL DEFAULT 0,    -- cache of latest credit_ledger.balance_after
  trial_credits_left  INTEGER NOT NULL DEFAULT 0,    -- portion of balance that is trial (display only)
  trial_granted       BOOLEAN NOT NULL DEFAULT FALSE,
  first_avatar_comped BOOLEAN NOT NULL DEFAULT FALSE, -- set once the comped onboarding is consumed
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id   TEXT NOT NULL,
  title       TEXT NOT NULL,
  stage       TEXT NOT NULL DEFAULT 'script',        -- script|voice|video|render|publish
  status      TEXT NOT NULL DEFAULT 'draft',         -- draft|processing|ready|failed
  script      TEXT NOT NULL DEFAULT '',
  format      TEXT NOT NULL DEFAULT 'short',         -- short (<60s) | long (~10min)
  language    TEXT NOT NULL DEFAULT 'en',
  voice_id    UUID,                                  -- chosen voices.id
  avatar_id   UUID,                                  -- chosen avatars.id
  voice_mode  TEXT NOT NULL DEFAULT 'tts',           -- tts | swap
  credits_spent INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_viewer ON projects (viewer_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS voices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id         TEXT NOT NULL,
  name              TEXT NOT NULL,
  language          TEXT NOT NULL DEFAULT 'en',
  status            TEXT NOT NULL DEFAULT 'training',  -- training|ready|failed
  fish_voice_id     TEXT,                              -- Fish Audio TTS clone id
  kits_voice_id     TEXT,                              -- Kits.ai swap-target voice id
  sample_key        TEXT,                              -- storage key of training/preview audio
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voices_viewer ON voices (viewer_id);

CREATE TABLE IF NOT EXISTS avatars (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id          TEXT NOT NULL,
  name               TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'training', -- training|ready|failed
  heygen_avatar_id   TEXT,                             -- HeyGen digital-twin id
  training_video_key TEXT,                             -- storage key of uploaded training video
  thumb_key          TEXT,
  error              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_avatars_viewer ON avatars (viewer_id);

-- Additive migrations (file re-runs idempotently at each deploy)
ALTER TABLE avatars ADD COLUMN IF NOT EXISTS heygen_group_id TEXT;
ALTER TABLE avatars ADD COLUMN IF NOT EXISTS consent_url TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS resolution TEXT NOT NULL DEFAULT '720p'; -- 720p standard, 1080p optional

CREATE TABLE IF NOT EXISTS jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id        TEXT NOT NULL,
  project_id       UUID,
  type             TEXT NOT NULL,   -- voice_gen|voice_swap|video_gen|transcribe|notes|avatar_create|voice_clone
  status           TEXT NOT NULL DEFAULT 'queued',   -- queued|processing|ready|failed|cancelled
  provider_job_id  TEXT,                              -- upstream id (e.g. HeyGen video id)
  input_json       JSONB NOT NULL DEFAULT '{}',
  output_json      JSONB NOT NULL DEFAULT '{}',
  credits_reserved INTEGER NOT NULL DEFAULT 0,
  credits_charged  INTEGER NOT NULL DEFAULT 0,
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_viewer ON jobs (viewer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs (project_id);

CREATE TABLE IF NOT EXISTS assets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id    TEXT NOT NULL,
  project_id   UUID,
  job_id       UUID,
  kind         TEXT NOT NULL,     -- audio|video|transcript|notes|notes_pdf|upload
  storage_key  TEXT NOT NULL,
  duration_sec REAL,
  size_bytes   BIGINT,
  meta_json    JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_assets_viewer ON assets (viewer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_project ON assets (project_id);

-- Append-only. Never UPDATE or DELETE rows here.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL,
  delta         INTEGER NOT NULL,               -- negative = debit
  type          TEXT NOT NULL,                  -- debit|topup|trial_grant|refund
  job_id        UUID,
  note          TEXT NOT NULL DEFAULT '',
  balance_after INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ledger_workspace ON credit_ledger (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  viewer_id    TEXT NOT NULL,
  event        TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
