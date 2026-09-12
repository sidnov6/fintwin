# Voice/conversation handoff — 5 September 2026

The local protected demo at http://127.0.0.1:8798 uses the latest code and saved
database. OpenAI remains primary; Groq remains a private fallback. No public
deployment, secret rotation or credit purchase was performed.

## Completed this pass

- Visible one-click continuous Realtime conversation with Marin. No per-turn
  play/pause; optional PTT is under Microphone & options. Device choice persists
  in the browser. Text stays full-width and does not trigger a competing player.
- Audio-first display: complete assistant text/cards follow the spoken reply.
  Obsolete transcript deltas are dropped on interruption. Capture pauses if the
  browser blocks sound; End voice closes the microphone and provider call.
- Shared conversational parsing and concise model policy fix the reported
  after-tax, cash-account sum, age/retirement-age, historical portfolio, zero/no
  cover, single-household and ordinary-confirmation failures. “I'm debt-free”
  cannot rename the person. A numeric amount alone is not a goal.
- Retirement `current_assets` is a scenario TOTAL, not another account. The live
  synthetic regression used exactly 135,000 rather than 235,000 and did not turn
  an assumed zero pension into a baseline fact.

## Verified

157 backend, 22 frontend unit and 12 Chromium tests passed; production build,
packaging and typechecks passed. Lint has the existing font warning only.
Four primary GPT-5.4 text turns and two continuous Realtime synthetic spoken turns
passed. Final first-audio delay was 3.8–4.3 seconds after fixture end; text appeared
after audio. All owned test calls and signed-in test sessions were closed. The
physical microphone was not used while the owner was away.

See TEST_EVIDENCE/README.md and the ignored data/last-conversation-smoke.json and
data/last-realtime-smoke.json for measurements, failed-attempt accounting and
limits. Paid scripts are opt-in, never part of build/start/test.

## Continue tomorrow

1. Reconcile any already-saved erroneous retirement-account total from the old
   conversation, scoped to the owner's household with provenance/backup. Do not
   wipe that household or rewrite immutable historical scenario results. This
   pass intentionally preserved existing data and history.
2. Real-room microphone/earpiece, accented speech, interruption and German live
   conversation assessment. Automated barge-in tests are not real-device proof.
3. Reduce the remaining speech-start pause if required; then a separately
   budgeted interview-length rehearsal. No overnight recording, monitoring or
   automatic paid session is active.

Existing unrelated worktree changes remain untouched. Keep credentials and the
private SQLite database out of source control and external artifacts.
