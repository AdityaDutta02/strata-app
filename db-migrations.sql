-- db-migrations.sql
-- This file runs once at deploy time against your app's isolated Postgres schema.
-- Do not use schema-qualified names — the schema is set automatically.
-- PostgreSQL 16: gen_random_uuid() and JSONB are available out of the box.
-- NOTE: placeholder scaffold table — replaced by the Strata schema in task #5
-- (projects, voices, avatars, jobs, assets, credit_ledger, audit_log).

CREATE TABLE IF NOT EXISTS items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
