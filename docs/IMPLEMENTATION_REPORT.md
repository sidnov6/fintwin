# FinTwin implementation report

## Outcome and scope

Implemented against the owner's **current** Next/worker/Node codebase and `FinTwin_Codex_Master_Build_Spec.md`, not the old Python service. Initial revision `a0d722a`, clean working tree; no AGENTS.md in the repository/ancestors. The historical `FinTwin_Audit.md` was not present. The supplied master specification is copied into `docs/` as the acceptance contract.

Local code/builds only. No public deployment, push, real-data deletion, private-database migration, key rotation or paid provider call was performed. Existing process on port 8787 was left running; a disposable provider-free preview was started on 8798. Changes remain uncommitted for owner review.

## What is implemented

| Area | Behavior / principal files |
| --- | --- |
| Entry and presentation | Protected passphrase entry; blank conversation versus explicit sample; existing visual palette retained; responsive EN/DE navigation and settings; real cookie sign-out. `page.tsx`, `Settings.tsx`, `globals.css`, `access.ts`. |
| Conversation | Shared versioned policy and one intake adapter before live/fallback routing. Multi-fact introductions, provenance, corrections, skip/unknown, hypothetical/third-party/partner safeguards. `policy.ts`, `intake.ts`, `companion.ts`, `chat.ts`. |
| Numerical semantics | Numeric JSON required; explicit EN/DE adapter; finite/domain checks; unknown pension distinguished from zero; retirement assumptions retained. `packages/engine`. |
| Household ownership | Opaque server session, hashed token in SQLite, HttpOnly/SameSite cookie. Standalone strips device/platform identities, rejects wrong origins and unknown hosts, bounds bodies and request rates. `access.ts`, `index.ts`, `dev-api.mjs`. |
| State consistency | Revision/epoch/active-turn guards, atomic receipt/write batches, committed-call idempotency, consistent state reads, stale-message rejection. Mixed fact set/remove is a single transaction. `db.ts`, `sqlite.mjs`. |
| Scenarios | Server-recomputed, immutable inputs/defaults/results/baseline/version/as-of/source snapshot. Exact ID travels Plan → chat → brief. Saved zero pension persists. Scenario drafts survive language/scenario-tab switches, with explicit rebase confirmation and stale markers. `application.ts`, `Plan.tsx`, `Scenario.tsx`. |
| Recovery | Replacement of failed partial text, incomplete-SSE terminal cleanup, cancellation/generation ownership and typed input accepted while busy. `chat.ts`, `api.ts`, `Chat.tsx`. |
| Realtime candidate | Browser WebRTC, Node-only owned-call sideband, shared application bridge/tools, server-only key/config, semantic VAD/manual response authorization, PTT, mute, interruption, End voice, timeout and provider hangup. `realtime.mjs`, `realtime-bridge.ts`, `realtime.ts`, `RealtimeVoice.tsx`. |
| Fallback voice | Separate capture owner; no parallel browser-recognition + recording. Abort/generation checks release late permission and suppress late transcription/TTS. Completed responses only are spoken. `voice.ts` in web and worker. |
| Brief | Deterministic, source-linked review/export, actual assumptions, missing data, stale refresh/historical consent, synthetic badge, EN/DE A4. `Brief.tsx`, `application.ts`. |
| Operations | Presenter preflight, persistent usage reservations, explicit paid opt-in, local safe demo, verify aggregator and text-only opt-in smoke command. `budget.ts`, `Preflight.tsx`, `scripts/`, `.env.example`. |

## Fixture and engine decisions

- Version `household-2026-09-04-v3`, frozen as-of `2026-09-04T12:00:00.000Z`.
- Mortgage EUR 240000, 2.15%, 240 months: rounded regular payment **EUR 1231.24**.
- Spending reconciled as `6672 - 1420 + 1231.24 = 6483.24`. Income EUR 7240 → surplus before saving **EUR 756.76**. Committed saving **EUR 568** → unallocated **EUR 188.76**. Housing is not deducted twice.
- Frozen portfolio value **EUR 148849.91**, sample net worth **EUR 487349.91**. Quotes/FX are synthetic snapshots, never silently refreshed into personal facts. Existing sample holdings and concentration views are preserved.
- Age 52, target retirement 63, mortgage 240 months: the competing dates are explicitly highlighted. EUR 300 extra repayment leaves a modeled **EUR 111.24 monthly shortfall** with current spending/saving unchanged; it is not presented as effortless progress.
- Mortgage engine `1.1.0` absorbs cent-rounding residue in the contractual final installment. It no longer invents an extra month for a few cents. Existing immutable snapshots retain their recorded engine version. Return, fees, inflation and withdrawal assumptions are explicit, not probabilities/guarantees.
- Retirement engine `1.1.0` returns an undefined ratio, with an explicit explanation, when pension assumptions already cover the spending target. The old arbitrary 999% readiness score is removed.
- Goal projection starts from cash plus investments, not assumed investable total property-backed net worth. Unknown inputs are not filled with invented assets/pensions.

## Persistence and migration safety

Generated additive migration `0003_hot_pride.sql` adds household heads, fact provenance, mutation receipts, immutable snapshots, opaque sessions and usage events. It changes no existing personal rows. Drizzle journal/snapshot and lockfile updated intentionally; only new dependency is pinned `ws@8.18.3` for the Node sideband.

`scripts/sqlite.mjs` applies startup migrations and journals them. For an existing persistent file it creates a pre-upgrade `VACUUM INTO` backup beside that exact file. Batch executes synchronously inside BEGIN IMMEDIATE/COMMIT and rolls back on any error. Tests use the actual adapter with in-memory databases; no owner's existing database was opened for this run.

Historical migration 0002 intentionally omitted metadata columns because the old runtime bootstrap added them. The Node startup importer fills that historical gap after inspecting columns. New request handlers do **not** run DDL. The worker-only deployment requires that legacy schema state verified before rollout; no fresh remote D1 migration/worker deployment was exercised. Database reset retains immutable snapshots and usage, and the UI says so. Full account erasure, long-term archival policy and client-record compliance are outside this demo.

## Acceptance-ID mapping and evidence level

| IDs | Automated evidence | Qualification |
| --- | --- | --- |
| C01–C07, C11–C13 | `acceptance.test.ts`, retained `worker.test.ts`; browser introduction/correction/German flow | Deterministic capture observed. Human naturalness unscored. |
| C08–C10 | Acceptance + compound hypothetical/friend regressions in `recovery.test.ts` | Finite parser safeguards; model proposals revalidated. |
| N01–N04 | Acceptance + engine tests + strict scenario tamper tests + localized Picture editing | Unknown differs from zero; invalid domains rejected. |
| N05, D01–D02 | Engine/scenario/recovery tests and repeated sample reset | Frozen baseline and after-saving arithmetic reconciled. |
| P01–P04 | Provider resolver tests; mocked actual compatible invocation; policy/fallback origin assertions | No provider account/model availability or live quality verified. |
| S01–S07 | `scenarios.test.ts`, late-message/reset tests, Plan → chat → sourced brief browser flow | Snapshot IDs/inputs/results preserved; stale snapshots remain immutable. |
| E01–E04 | Mocked partial provider failure, web SSE EOF/replacement, exact-once fact/step tests, stale turn/message guards | Mocked failure paths and actual SQLite; not a production incident simulation. |
| V01–V03, V05–V07, V10 | Worker/browser **mocked** Realtime lifecycle tests | Server ownership/reservations/control order, track release, stale generation and typed input tested. Audible behavior still requires hardware. |
| V04, V08 | Shared text semantics tested; VAD/locale configured | Natural pauses and accented audio **not tested live**. |
| V09 | Server `sync` invalidates active response and sends fresh revision; shared application guards | Implementation present; full live UI-to-audio sequence **not observed**. |
| B01, B02, B04 | Source/stale/refresh worker tests + brief UI | Every structured numerical field has fact/revision or snapshot path; unknown/stale state explicit. |
| B03 | Actual EN/DE Chromium PDF export + Poppler page/render inspection | Both observed sample briefs are one A4 page; no clipped content on visual review. Excess content uses pagination; not every arbitrary long brief tested. |
| A01–A03 | Identity/origin/cross-owner tests, cookie sign-out E2E, body limits, reservation exhaustion/reset tests | Single-process demo controls, not a security/compliance certification. |
| A04 | Browser bundle/evidence text pattern scan: zero suspected permanent-key files; sanitized error paths reviewed | Pattern scan is not a complete secret audit of unrelated private files/history. |
| U01–U02 | Chromium 1440×900, 1280×800, 390px, 200% zoom; keyboard slider/settings/Escape/sign-out; EN/DE; Axe checks | Zero serious/critical Axe findings on tested chat/brief surfaces; not an exhaustive accessibility audit of every state/browser. |

## Commands actually run

Environment: macOS, Node **26.3.1**, pnpm **11.19.0**; locked Next **15.5.24**, Playwright **1.62.1**, Vitest **3.2.7**.

| Command | Observed outcome |
| --- | --- |
| Baseline `pnpm typecheck`, `pnpm lint`, `pnpm test:worker` | Passed; worker had 37 tests; one pre-existing font lint warning. |
| Baseline `pnpm test:web` | Failed: zero test files. New meaningful tests now exist. |
| `corepack pnpm install --frozen-lockfile` | Passed, lockfile unchanged by install. |
| `NEXT_PUBLIC_API_URL= corepack pnpm verify` | Final pass: typecheck, lint, **85 worker tests**, **8 web unit tests**, **8 Chromium E2E tests**, static frontend and bundled worker builds. |
| Final targeted `typecheck:worker && test:worker` after transaction tightening | Passed, 84 tests. |
| `PORT=8798 corepack pnpm demo` | Built and started provider-free static/Node host using in-memory SQLite. Existing 8787 process preserved. |
| `FINTWIN_CHECK_URL=http://127.0.0.1:8798 pnpm preflight` | Reachable/storage true, live text false, voice text/unavailable. No provider call. |
| `pnpm smoke:live` without approval flag | Refused with exit 2 **before reading configuration or calling a provider**. Expected safety result. |
| `docker info --format '{{.ServerVersion}}'` | Failed: Docker daemon socket not available. Docker build/run not claimed. |
| `pdfinfo`, `pdftoppm` on EN/DE exports | One A4 page each, visually inspected. Poppler emitted Type-3 glyph bounding-box warnings; rendered text/icons were inspected and readable. |
| Browser bundle/evidence text secret-pattern scan | Zero suspected permanent-key files. No secret values logged. |

One pre-existing Next font warning remains (`no-page-custom-font` on the app layout stylesheet link). It does not fail lint/build; fonts use the existing network stylesheet with CSS fallback. No unrelated font-system redesign was introduced.

## What remains unverified / limited

1. **No paid/live audio trials:** actual model access, natural feminine voice perception, semantic pause tuning, accents, real interruption latency and laptop-versus-phone selection require the owner/device. Realtime defaults off.
2. **No real timing or 60-minute rehearsal:** zero audio samples; median/p95 are not available. Five-minute voice sessions deliberately end; reconnect is explicit. See `CONVERSATION_EVALS.md` for the worksheet.
3. **No Docker/public-host run:** local built static + Node path is tested, Docker daemon was unavailable, and deployment was not authorized. Worker-only fresh-schema gap is documented above.
4. **Finite deterministic language coverage:** it is a useful transparent fallback, not an unrestricted model. Unclear phrases may need clarification or Picture editing; unscripted live conversation quality must be measured, not assumed.
5. **Demo access/operations:** passphrase + expiring opaque session, not account recovery/SSO; one process owns Realtime sessions; rate limits are process-local. HTTPS, persistent storage, provider-side spend caps and backup retention remain deployment responsibilities.
6. **Reservations are conservative estimates:** unreported or unpriced usage keeps its reservation; request resets/reconnects cannot clear the ledger. This is not an invoice-level hard cap or a pricing claim. Unexpected provider events end the call, but cannot retroactively eliminate an already incurred charge.
7. **Scope limits retained:** no real bank/broker connections, advice compliance claim, product ranking or trade execution. Synthetic transaction/portfolio context is not live market evidence.
8. **Drafts and historical outputs:** drafts survive language, scenario-tab and main-screen changes, and warn on rebase/window unload; they are not persisted across a full browser reload. Saved snapshots persist. Reset intentionally starts a new epoch and clears the active scenario selection.

## Documentation and visual evidence

`BUILD_PROGRESS.md`, `DEMO_RUNBOOK.md`, `CONVERSATION_EVALS.md`, `.env.example` and README give the exact start/configuration/fallback commands. `TEST_EVIDENCE/` contains only synthetic browser screenshots and PDFs. The Sites guidance kept work within the existing architecture with no unauthorized deployment; the PDF skill drove actual rendered A4 inspection rather than relying on the screen preview.

Technical protocol references checked during implementation: [OpenAI WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc), [server controls](https://developers.openai.com/api/docs/guides/realtime-server-controls), [VAD](https://developers.openai.com/api/docs/guides/realtime-vad), [conversation interruption/tool flow](https://developers.openai.com/api/docs/guides/realtime-conversations), [cost/context controls](https://developers.openai.com/api/docs/guides/realtime-costs), [owned-call hangup](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup). These establish documented API shapes, not a live application pass.
