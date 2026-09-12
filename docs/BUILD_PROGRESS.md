# Master-build progress

Updated 5 September 2026. Source baseline `a0d722a`, initially clean. The full master spec was read and copied to `docs/FinTwin_Codex_Master_Build_Spec.md`. No repository/ancestor AGENTS.md; historical audit document not available. Current code, not an older snapshot, was inspected.

## Milestone status

| Milestone | Implementation | Gate / remaining work |
| --- | --- | --- |
| M0 baseline and safety | Implemented | Initial checks recorded; additive generated migration, protected opaque sessions, transactional adapter and private-data preservation. Only synthetic in-memory stores used. |
| M1 C01–C13, N01–N05, P01–P04 | Implemented; deterministic/mocked gates passed | Shared intake/provenance, locale/domain validation, routing and truthful origin. General live-model quality still requires evaluation. |
| M2 S01–S07, E01–E04, D01–D02 | Implemented; automated gates passed | Immutable exact-ID handoff, repeated sample reset, reconciled cashflow, receipt/CAS guards, streaming replacement and stale-generation protection. |
| M3 V01–V10 | Implemented; **mocked lifecycle evidence only** | Browser capture/output ownership, server sideband, PTT/mute/end, shared tools. Live pauses, accents, actual audio, UI-edit-to-voice sequence and measured latency remain unverified. Feature defaults off. |
| M3 A01–A04 | Demo controls implemented/tested | Gate, origin/identity/body limits, retained usage reservations, sanitized errors and bundle scan. Not a production security/compliance certification. |
| M4 B01–B04, U01–U02 | Implemented; browser/print checks passed | Brief with actual assumptions/sources/stale flow, presenter preflight, bilingual layouts, keyboard, settings/sign-out, tested Axe surfaces. Both sample PDFs one A4 page, visually reviewed. |
| M5 reproducibility and evidence | Implemented; native/Node route passed | verify/demo/preflight/opt-in-smoke commands and delivery docs. Docker/public host and authorized manual live gates remain outstanding. |

**No claim of production readiness or one-hour-demo readiness.** Missing live approval/device observations did not stop independent implementation. No paid call, deployment, push, credential rotation or real-data deletion was performed.

## Actual checks

- Baseline: Node 26.3.1, pnpm 11.19.0. Typecheck passed, lint one existing font warning, 37 worker tests passed. Web tests failed because none existed.
- Final complete `NEXT_PUBLIC_API_URL= corepack pnpm verify`: passed typecheck, lint, **85 backend tests**, **8 web unit tests**, **8 Chromium browser tests**, static app and worker builds. This includes final transaction guards, zero-required-capital retirement semantics, and draft retention across main-screen navigation.
- Frozen-lockfile install passed. New pinned Node dependency: `ws@8.18.3`.
- Browser tests run against built static assets and the real Node/SQLite adapter, providers forced off, database in memory. Viewports: 1440×900, 1280×800, 390px, 200% zoom. Keyboard slider and settings/Escape/sign-out checked. Zero serious/critical Axe issues on tested chat/brief surfaces.
- EN and DE browser-generated sample briefs: one A4 page each, rendered and inspected. Print sources/assumptions visible in the review workflow. Screenshots/PDFs are in `TEST_EVIDENCE/`, all synthetic.
- Bundle/evidence text scan found zero suspected permanent-key files. No raw provider error payloads or financial transcript logs added.
- `pnpm smoke:live` without `--allow-paid`: correctly refused before any provider call (expected exit 2).
- Docker daemon probe failed: `/Users/sid/.docker/run/docker.sock` unavailable. No Docker build/run claimed.
- `PORT=8798 pnpm demo`: built and started successfully; read-only preflight confirmed reachable storage and providers off. Existing app/process on port 8787 was not stopped or changed. Preview uses a disposable in-memory store.

## Remaining external gates

1. Owner-approved paid text/Realtime smoke against the actual accessible model.
2. Actual laptop microphone selection, EN/DE/accented numbers, natural pauses and interruption/playback verification.
3. Honest latency measurements with sample counts; ten varied live conversations scored by observation.
4. Continuous 60-minute manual rehearsal with idle/session rollover, network interruption, reset, brief and budget checks.
5. Docker daemon availability and authorized protected target-host verification. Worker-only deployment additionally needs its legacy 0002 metadata-column state verified.

Exact procedures and fallback are in `DEMO_RUNBOOK.md`. Complete changes, acceptance-ID mapping and limitations are in `IMPLEMENTATION_REPORT.md`; live evaluation fields are deliberately unscored in `CONVERSATION_EVALS.md`.
