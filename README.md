---
title: FinTwin
emoji: 💬
colorFrom: green
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

# FinTwin

An independent, bilingual household companion for preparing an adviser meeting.
Conversation → editable financial picture → a grounded what-if → a printable brief.
The current build follows `docs/FinTwin_Codex_Master_Build_Spec.md`; it does not use the older Python service as its active backend.

## Try it without keys or changing your saved household

Requirements: Node 24+ (native SQLite), Corepack / pnpm 11.19.0.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm demo
```

Open **http://127.0.0.1:8787**. Enter **local-synthetic-demo-only**.
This command builds the static app, starts the protected Node host on loopback, forces every provider off and uses an **in-memory database**. Stopping it discards this demonstration only. An existing `.env` or provider key cannot silently enable paid work in this command.

Start a conversation or explore the frozen sample household. Switch EN/DE in the top bar. Edit a fact in Picture; use Plan to adjust a rate or extra repayment; click Ask FinTwin to discuss that exact saved snapshot; choose Prepare meeting to review and print the sourced brief.

## What changed

- A three-reply introduction: age/goal, income/spending, then cash/investments/debt. Names are optional; spoken English amounts, grouped answers and corrections share the durable intake path.
- A clearly labelled synthetic bank connection: 119 reproducible transactions covering March–August 2026, with exact cents, balances, category/merchant filters and contextual follow-up questions.
- Spending charts directly in chat, mortgage balance projections, a dedicated Bank explorer and a redesigned navy/cobalt workspace that also works on mobile and at 200% zoom.
- One intake path across text and voice: canonical amounts, annual/net/gross/scope provenance, corrections, unknowns and removal.
- One revisioned household. Guarded writes and immutable scenario IDs prevent old results replacing newer facts.
- A reconciled synthetic household with frozen portfolio quotes. Surplus before saving is distinct from money remaining after committed saving.
- Clean stream fallback, per-message origin and explicit voice lifecycle controls.
- English/German adviser briefs and presenter preflight. Printing sends nothing to an adviser.
- Server-issued HttpOnly demo sessions, origin checks, bounded requests and persistent provider reservations.

## Voice and models: implemented, not yet live-audio verified

Realtime uses browser WebRTC with a **Node-only authenticated server sideband**. No permanent provider key goes to the browser. The candidate defaults are `gpt-realtime-2.1` and `marin`; access, natural pauses, actual timbre and latency require authorized device testing. The feature defaults off. A successful configuration check is not an audio test.

To configure a persistent protected host, copy `.env.example` to private `.env` and set `FINTWIN_DEMO_PASSPHRASE` to at least 12 characters. Keep paid use disabled until authorized.

```bash
NEXT_PUBLIC_API_URL= corepack pnpm build
corepack pnpm start:production
corepack pnpm preflight
```

Text routing: a complete `LLM_BASE_URL` / `LLM_API_KEY` / explicit `LLM_MODEL` configuration wins; invalid custom configuration fails closed. Otherwise `OPENAI_API_KEY` selects OpenAI (`OPENAI_CHAT_MODEL`, default `gpt-5.4`), with Groq (`GROQ_API_KEY` / `GROQ_CHAT_MODEL`) retained as an automatic text backup on provider failure. Backup replies are labelled and completed tools are not replayed. Budget or cancellation failures do not bypass controls through a backup. Key presence alone never activates a provider: `FINTWIN_ALLOW_PAID=1` is also required, and API billing must be funded separately.

OpenAI also takes priority for transcription (`gpt-4o-mini-transcribe`) and chained speech (`gpt-4o-mini-tts`, Marin in English/German). Realtime uses `gpt-realtime-2.1` / Marin. Voices are never silently switched during a failed utterance. A missing-credit error links to API billing; the app never purchases credits. Groq speech settings remain available when OpenAI is not configured, with the existing English-only/terms restrictions.

Voice modes: `FINTWIN_VOICE_MODE=text` (default), `chained` (configured STT/TTS or clearly separate system voice), or `realtime` (requires `OPENAI_API_KEY` plus the Node runtime). Realtime includes microphone selection, mute, interruption, hold-to-talk and End voice. If macOS selects your phone, choose the laptop input; FinTwin does not modify your OS settings. See the [runbook](docs/DEMO_RUNBOOK.md) before any live test.

## Verification

```bash
corepack pnpm --filter @fintwin/web exec playwright install chromium
NEXT_PUBLIC_API_URL= corepack pnpm verify
# Individual checks
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test:worker
corepack pnpm test:web
corepack pnpm test:e2e
```

`verify` runs actual unit/regression/browser tests and both builds. Browser tests use built static assets with the real Node/SQLite adapter; all provider traffic is disabled. Mocked Realtime tests are labelled as mocks.

`pnpm smoke:live` **refuses to run** without `--allow-paid`. Only with owner approval and a privately configured host, `pnpm smoke:live --allow-paid` runs one synthetic **text-only** turn, checking actual live origin. It records sanitized status at `data/last-text-smoke.json`, never a transcript/key. It is not part of verify, startup or build; it does not verify voice.

## Architecture and storage

| Layer | Responsibility |
| --- | --- |
| `apps/web` | Existing Next static UI; chat, Picture, Plan, Brief, voice controls |
| `packages/engine` / `packages/contracts` | Pure deterministic calculations and shared canonical types |
| `sites-worker/src/intake.ts`, `application.ts`, `tools.ts` | Shared semantic validation, guarded mutation, immutable snapshots, brief assembly |
| `sites-worker/src/chat.ts` / `realtime-bridge.ts` | Text and voice adapters to the same application layer and policy |
| `scripts/dev-api.mjs`, `sqlite.mjs`, `realtime.mjs` | Single-origin Node host, startup migrations, transactional SQLite, Realtime sideband |
| `services/api` | Earlier reference implementation; preserved, not used by this UI |

Node startup journals generated migrations and backs up an existing database beside the file before upgrading it. No runtime request handler creates schema. Migration `0003_hot_pride.sql` is additive. The startup adapter also imports the historical metadata-column gap in migration 0002. The existing private Sites database's legacy profile/message columns were verified through its read-only schema view on 13 September 2026. Verified Sites gateway identity retains the original user key, preserving saved household ownership. The worker build has no Node/WebSocket dependency and reports Realtime unavailable.

`Reset sample` replaces only this session's synthetic household. A user-reported household cannot be replaced by the sample button. Reset clears active personal facts/messages/preferences, while immutable historical snapshots and usage reservations remain as auditable history. It is **not** an account-erasure/compliance endpoint. Sessions expire after 12 hours; this passphrase gate is not a complete account/SSO system.

## Hosting boundary

The Dockerfile is prepared for the same host on port 7860. Configure a persistent `/data` volume, a private passphrase, TLS and `FINTWIN_PUBLIC_ORIGIN` (exact public origin). Keep one Node process per SQLite file; the sideband is process-owned. Standalone strips forged platform/device identity headers. Do not expose the Node port behind an unverified gateway or use real client records.

Docker build/run and any public rollout remain unverified in this environment: the Docker daemon was not running. The static + Node route is covered by the browser suite. See [implementation evidence](docs/IMPLEMENTATION_REPORT.md) and [build progress](docs/BUILD_PROGRESS.md) for precise status and limitations.

## Scope

Synthetic demonstration and independent adviser preparation, with no DVAG affiliation. No live bank/broker connections, product ranking, suitability verdict, execution, regulated advice record or legal/tax conclusion. Frozen portfolio prices are never presented as live. Model projections are illustrative, not forecasts or guarantees. Provider reservations are conservative allowances, **not an invoice-level billing guarantee**. Retain a provider-side spending cap as well.
