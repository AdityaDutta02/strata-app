# Strata

AI avatar video platform on [Terminal AI](https://terminalai.studioionique.com).
Upload a script → voiceover (Fish Audio TTS or Kits.ai voice swap) → HeyGen avatar video →
transcript + timestamped, source-linked editor notes (PDF). Credit-based billing in INR.

Master plan: `../docs/STRATA-PLAN.md` · Design (canonical): `../strata-design/strata/` · Behavioral spec: `../docs/STRATA-UIUX-PRD.md`

## Terminal AI SDKs (pre-wired by scaffold)

| Capability | File | How to use |
|---|---|---|
| **Viewer auth** | `hooks/use-embed-token.ts` | `const token = useEmbedToken()` in root client component. Standalone mode auto-redirects via `/embed/authorize` |
| **Database** | `lib/db.ts` | `dbList / dbGet / dbInsert / dbUpdate / dbDelete` — isolated per-app Postgres, schema in `db-migrations.sql` |
| **Storage** | `lib/storage.ts` | ≤50MB via `storageUpload/storageGet`; video/big files via `getPresignedUploadUrl / getPresignedDownloadUrl` (≤2GB, direct) |
| **AI gateway** | `lib/terminal-ai.ts` | `callGateway()` — not used for models in v1 (own provider keys); kept for future gateway categories |
| **Email** | `lib/email-sdk.ts` | `sendEmail(subject, html, embedToken)` — job-completion notifications |
| **Tasks** | `lib/task-sdk.ts` | `createDelayedTask` (1–1440 min one-shot) — render-job watchdog |

## Model providers (own keys, via provider abstraction — never called from client)

Set via `set_env_var`, never committed: `HEYGEN_API_KEY`, `FISH_AUDIO_API_KEY`, `KITS_API_KEY`,
`GROQ_API_KEY`, `OPENROUTER_API_KEY`.

## Rules

- All SDK calls + provider calls are server-side only (API routes).
- Never store the embed token in localStorage/cookies; it expires in 15 min and auto-refreshes.
- DB is per-app: every user-scoped table carries `viewer_id TEXT`, filtered in application code.
- Credits: own ledger (`credit_ledger`, append-only) at PRD §5 rates; top-ups via Terminal payments primitive.
- Mobile: inputs ≥16px font, tap targets ≥44×44px, `100dvh` not `100vh`, animate transform/opacity only.

## Env vars

| Variable | Description |
|---|---|
| `TERMINAL_AI_GATEWAY_URL` | Set automatically at deploy time |
| `TERMINAL_AI_APP_ID` | App UUID |
| `NEXT_PUBLIC_TERMINAL_AI_APP_ID` | Same UUID, client-readable (standalone auth redirect) |
| `NEXT_PUBLIC_TERMINAL_AI_PLATFORM_URL` | Optional; defaults to production platform |
| `TERMINAL_AI_APP_SECRET` / `TERMINAL_AI_PAYMENT_WEBHOOK_SECRET` | From `enable_app_payments` (one-time) |
| `RENDER_WORKER_URL` / `RENDER_WORKER_SECRET` | Strata Render app endpoint + shared HMAC secret |
