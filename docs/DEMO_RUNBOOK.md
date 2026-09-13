# FinTwin demonstration runbook

## Hosted voice repair — 13 September 2026

The private Sites publication uses **chained OpenAI voice**, not the Node-only Realtime transport. **Start voice conversation** now starts capture, transcribes after a short pause, submits the text to the same saved household and speaks the reply. It listens again when playback finishes. **End voice** cancels recording, pending transcription and playback. This path is turn-taking; it does not promise simultaneous, interruptible WebRTC audio.

Choose the correct input under **Microphone & options**. The selector now controls the recording device. A visible microphone meter and **Listening / Transcribing** status separate capture from network work. A short “yes” is accepted by the speech gate; silence still sends no request. Transcription text appears after the pause, not word-by-word while speaking.

The owner requested reusing the existing private project OpenAI key on the hosted site. It is stored only as a server secret; it is not committed or exposed to the browser. Groq's earlier access rejection is now shown as a provider-key problem rather than a microphone-permission problem. Existing budgets and saved facts are unchanged. The hosted preflight reports the active speech voice instead of always displaying the Realtime voice.

Free verification: all 17 browser flows and 30 frontend tests pass, including selected input, capture → transcription → saved fact → playback → next capture, provider-auth errors and cancellation of late transcription. These use synthetic capture and mocked providers; physical microphone/speaker quality still requires the user's device check.

Live verification after publication: the signed-in hosted browser displayed Marin and an enabled Start voice button; **Test voice** completed without an error. One direct OpenAI transcription request using an existing synthetic MP3 and the same private project key returned HTTP 200 in 628 ms: “My savings are 18,000 euros.” No room microphone or household fact was used or changed. The short-lived Sites diagnostic bearer did not establish a signed-in household for API calls (401, zero paid requests), so it was not treated as an end-to-end hosted-transcription pass. Actual microphone capture on the user's device still needs a user check.

## Fast interview route — 13 September 2026

Use a fresh synthetic demo session. Choose **Explore a sample household** for the fastest path (no onboarding questions).

1. **Show my spending trends** → six monthly bars, exact category totals and expandable transaction evidence.
2. **What about groceries?** → the grocery trend. **And in August?** → **€1,040.00 across four transactions**, with the previous category remembered.
3. **Show my mortgage trends** → historical payments plus a separate engine-calculated balance projection. Explain that history is fixed, while scenarios change assumptions.
4. Open **Bank** → filter month/category, search a merchant, inspect recurring payments and paginate the ledger. Closing balance is **€61,900.00**; all 119 entries reconcile to it. August spending is **€6,483.24**. Investment transfers are not spending.
5. Open **Plan**, adjust an assumption, then **Prepare meeting** for the sourced brief.

To demonstrate capture instead, use another fresh session and reply:

- “I'm Alex, I am thirty two and I want to retire at forty.”
- “I take home five thousand a month and spend three thousand.”
- “Twenty thousand in cash, forty thousand invested, no debt.”

Then say “Actually, spending is 2800, not 3000.” Reload to show that the correction and other facts survive. The name is optional; incomplete or skipped facts stay unknown. The sample button does not overwrite a household containing personal figures.

This is an explicitly **synthetic** bank feed, fixed to March–August 2026—not an Open Banking integration or live history. Requests outside that coverage report missing data. Automated checks use providers disabled or mocked; this update does not establish live voice quality or interview-duration reliability.

## Earlier implementation and voice rehearsal notes

Status: 5 September 2026. Current implementation: independent synthetic household/adviser demonstration. Short synthetic live voice and conversation checks have passed; a 60-minute real-device rehearsal has not. See the latest section in `TEST_EVIDENCE/README.md` for measured scope.

## Safe local review

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm demo
```

Open `http://127.0.0.1:8787`, passphrase `local-synthetic-demo-only`. The command forces providers off and uses in-memory SQLite, even if a private `.env` contains keys. Stop with Ctrl-C. No existing saved household is opened or erased.

If port 8787 is occupied, leave the existing process alone:

```bash
PORT=8798 corepack pnpm demo
FINTWIN_CHECK_URL=http://127.0.0.1:8798 corepack pnpm preflight
```

The owner's existing port 8798 preview is now the paid-enabled persistent host described below. `pnpm demo` remains provider-free. Browser tests use 8799; do not run another test server there.

## Persistent protected host

The owner's localhost:8798 host now uses `FINTWIN_LOCAL_OPEN=1`: opening the app creates a private cookie session automatically without a passphrase. Existing valid sessions keep their household/history; new browsers get independent sessions. This does not enable paid calls by itself or change provider keys/budgets. The flag is rejected with a non-loopback bind, public origin, or cross-origin setting. Do not tunnel/proxy this mode publicly. Set it to `0` and restart to restore the gate; public deployments remain protected by default. The provider-free `pnpm demo` and browser suite explicitly keep their original protected mode.

1. Keep `.env` private and untracked. Use `.env.example` as the configuration reference.
2. Set `FINTWIN_DEMO_PASSPHRASE` to a private value of at least 12 characters. The built-in passphrase is only for loopback, synthetic, provider-free review.
3. Choose `FINTWIN_DB` deliberately. Node startup creates a backup beside an existing database before an upgrade; retain it. Migrations are additive. Do not point a test command at a real client database.
4. Build with a same-origin browser API, then start:

```bash
NEXT_PUBLIC_API_URL= corepack pnpm build
corepack pnpm start:production
corepack pnpm preflight
```

Behind a reverse proxy, set `FINTWIN_PUBLIC_ORIGIN=https://your-exact-host`, preserve that Host header, use TLS and proxy SSE without buffering. Do not expose an unverified platform-header bypass. Node strips browser-supplied platform/device identity. Only an explicitly verified worker gateway may use `FINTWIN_TRUST_PLATFORM=verified-gateway`; the Node host never forwards that setting.

The Dockerfile targets port 7860 and `/data/fintwin.sqlite`. Configure persistent storage, private secrets and a protected origin before running it. Docker was **not** built/run here because the daemon is unavailable. Worker-only Sites hosting has no Node sideband and needs the historical 0002 profile/message metadata columns verified before rollout. No public deployment is authorized or included.

## Text-provider configuration

All paid routes require `FINTWIN_ALLOW_PAID=1`. A key alone does nothing.

- Custom compatible endpoint: set **all** of `LLM_BASE_URL` (HTTPS API base), `LLM_API_KEY`, `LLM_MODEL`. It takes precedence over OpenAI and Groq. Choose `LLM_TOKEN_FIELD=max_tokens` or `max_completion_tokens` for the actual model. Temperature is absent unless explicitly permitted. Reasoning options are restricted to the registry's supported families.
- Without a custom endpoint, OpenAI is primary when its key is configured: `OPENAI_CHAT_MODEL=gpt-5.4`. Groq remains the automatic text backup on provider failure; messages record the actual provider/model and display the backup label. Completed tool outputs survive failover. Local budget failures never trigger a backup call.
- Groq: `GROQ_API_KEY`, optionally `GROQ_CHAT_MODEL`. The candidate default is `openai/gpt-oss-120b`, not a measured quality claim.
- Invalid custom configuration does not borrow a Groq model name. Presenter preflight exposes a configuration error; failed live turns use a clearly labelled deterministic fallback.

Keys previously pasted in a chat should be replaced privately before live use. No key was rotated by this implementation. Never put a permanent key in `NEXT_PUBLIC_*`, a screenshot, the conversation evaluator or a committed document.

## Chained voice: silent playback / Orpheus account terms

On 5 September, an authorized synthetic English voice check returned Groq
`model_terms_required` (HTTP 400). A valid API key and a model catalogue entry
do not establish that the account may generate speech. No audio was produced.
The owner must review and accept the Orpheus terms in their own
[Groq Console](https://console.groq.com/); the app/agent cannot do that for them.

The chat now labels the configured voice and provides **Test voice**, **Read
reply**, **Stop audio**, and an actual read-aloud toggle. Hannah is the configured
female English AI voice; German uses a separately labelled system voice when
no multilingual provider is configured. Test voice never activates a microphone.
Groq's terms error becomes the sanitized application code `voice_terms_required`
with an actionable message, not an invisible generic failure. A browser autoplay
block keeps the generated clip for **Play audio**, without another provider call.
Playback failure stops hands-free capture and never silently switches voices.

The local host at 8798 was explicitly enabled for Groq by the owner after the
original provider-free review. It now uses a private persistent demo database;
`pnpm demo` itself remains provider-free. This was the earlier Groq-only configuration; the OpenAI setup below supersedes it for the owner's local host.

## Owner-approved OpenAI rehearsal setup — 5 September 2026

The existing local preview at port 8798 uses a private, ignored `.env` and the
same persistent SQLite household database. OpenAI is now configured for text,
transcription, chained speech and Realtime. Groq's key remains private and intact.
No credentials belong in this document, browser bundles or committed files.

The owner approved **USD 50 per signed-in demo and USD 75 aggregate** for the
existing usage window. These are application allowances, not credit purchases,
provider account balances or exact invoice limits. Existing usage was not reset.
The `.env.example` and provider-free `pnpm demo` retain their safer defaults.

Local overrides: Realtime maximum **3300 seconds (55 minutes)**, idle timeout
**300 seconds**, maximum **240 model responses** per connection (tool follow-ups
count too). Reconnect manually between rehearsal segments; start a fresh voice
connection immediately before the 45-minute interview. Saved facts and aggregate
usage persist across reconnects. There is no automatic paid reconnection.

OpenAI imposes a [60-minute Realtime session maximum](https://developers.openai.com/api/docs/guides/realtime-conversations).
The local cap leaves margin below it. It is not a promise of 55 minutes of useful
audio: network/device errors, response limits, budget and idle expiry can end a call.

Budget recommendation: **USD 75 prepaid API credits** as a conservative planning
buffer for 120 minutes testing plus a 45-minute interview, not a measured bill or
guarantee. At a hypothetical 50/50 speaking split, 82.5 minutes of user audio plus
82.5 minutes of assistant audio costs about **USD 7.92 for newly generated audio
alone**: 600 input tokens/minute at USD 32/M and 1200 output tokens/minute at
USD 64/M. See [Realtime cost accounting](https://developers.openai.com/api/docs/guides/realtime-costs)
and [GPT-Realtime-2.1 pricing](https://developers.openai.com/api/docs/models/gpt-realtime-2.1).
That baseline excludes repeated conversation context, text/reasoning, input
transcription, separate chat/TTS, retries and any applicable taxes. Long context
and changing household instructions can materially increase cost and reduce caching.
Review actual usage after a short funded rehearsal before relying on an estimate.

Known GPT-5.4 and GPT-Realtime-2.1 usage is settled using versioned token-price
estimates instead of retaining USD 0.50/1 per completed response. Unknown models,
missing usage, interrupted calls, capture/transcription and chained speech retain
conservative reservations. This is not reconciliation against a provider invoice.

Verification boundary: a read-only model catalogue request accepted the configured
OpenAI key and listed the selected models. The owner reports **no purchased credits**.
No paid inference/audio call or long rehearsal was run for this setup. Model listing
does not verify balance, paid inference eligibility, rate limits, timbre or latency.
The owner must fund [OpenAI API billing](https://platform.openai.com/settings/organization/billing/overview)
separately; creating a key does not add credits. No credits were purchased and no
automatic top-up was enabled. Rotate keys pasted into chat privately before sharing
or deploying; neither key is exposed by the app.
The new voice model has **not** passed an audible quality or microphone test.

## Realtime voice trial — only after explicit approval

Use the Node host, not the worker-only bundle. Candidate settings:

```dotenv
FINTWIN_ALLOW_PAID=1
FINTWIN_VOICE_MODE=realtime
OPENAI_API_KEY=<private server secret>
OPENAI_REALTIME_MODEL=gpt-realtime-2.1
OPENAI_REALTIME_VOICE=marin
FINTWIN_REALTIME_MAX_SECONDS=300
FINTWIN_REALTIME_IDLE_SECONDS=90
FINTWIN_SESSION_BUDGET_USD=25
FINTWIN_TOTAL_BUDGET_USD=40
FINTWIN_BUDGET_WINDOW=interview-2026-09
```

Do not enable this for the interview until the device checks below pass. Provider model access and actual voice quality were not established here. The sideband shares the text policy, intake validation, facts, tools and scenario storage. No financial arithmetic is delegated to a separate voice implementation.

1. Open presenter preflight; check selected language, provider/mode and remaining reservations. Configuration is not a smoke-test pass.
2. In Chat open **Voice conversation & microphone**. Choose the computer's input, then start. Permission is requested only by this explicit action.
3. Device names may be hidden before permission. If needed: allow access, **End voice**, choose the now-labelled MacBook/built-in microphone, then reconnect. Do not keep retrying an unavailable phone input. FinTwin does not change macOS settings.
4. Try natural pauses, corrections and accented EN/DE numbers. Check recorded facts rather than trusting the transcript alone. Unknown or ambiguous amounts must remain questions.
5. Interrupt, type while speech is active, mute/unmute, use hold-to-talk (mouse and keyboard), change a fact in Picture, return and ask about it. Verify the current revision.
6. Try permission denial, loss of network, refresh, navigation and session expiry. Text and saved facts must remain usable. Autoplay denial should offer **Enable sound**.
7. Choose **End voice** while staying on the page. Confirm the browser microphone indicator turns off and no old audio resumes. Reconnect deliberately; it must not silently create concurrent sessions.

The session cap is five minutes by default, with a 90-second idle timeout; reconnects are explicit. It is not a seamless hour-long call. Three active host voice slots and a per-session response limit bound the demo. Duration, output/context caps and reservations reduce cost exposure, but are **not invoice guarantees**. Keep a provider-side spending cap. Closing a sideband alone is insufficient: the host also calls the provider's owned-call hangup endpoint.

## Optional paid text smoke

```bash
# Refuses, without contacting a provider:
corepack pnpm smoke:live
# Run only after the owner approves paid use:
corepack pnpm smoke:live --allow-paid
```

This creates a fresh synthetic gate session and sends one opening text turn. It requires a nonempty reply from the configured primary provider/model; a Groq backup reply fails this check. Sanitized status/model/timestamp is saved to `data/last-text-smoke.json`; no transcript or key is exported. The test session is signed out afterward. Normal verification never calls it.

The funded repair on 5 September passed OpenAI primary text, German portfolio
tool calling and a synthetic microphone → Realtime transcription → intake → Marin
audio round trip. See `docs/TEST_EVIDENCE/README.md` for exact scope and remaining
physical-device/long-call limitations. OpenAI now uses Responses to preserve
GPT-5.4 reasoning with function tools; Groq stays on Chat Completions.

Additional **paid, opt-in, local-only** checks (not part of normal verification):

```bash
corepack pnpm smoke:live --allow-paid --portfolio
node scripts/realtime-smoke.mjs --allow-paid --audio=data/generated/voice-smoke-KRwq1q/en.mp3
```

The second command requires that existing synthetic fixture and an installed
Chromium test browser. It makes one synthetic microphone turn in an isolated
account, verifies the saved €18,000 and received audio, and closes its owned call.
It never captures the physical microphone or retries automatically. Keep it
separate from a subjective device/voice-quality or interview-duration test.

## Six-to-eight-minute presentation

| Time | Action | What to explain |
| --- | --- | --- |
| 0:00–1:00 | Open protected entry; choose blank conversation | Name, goal and context come through conversation, not a questionnaire. Say Alex's name, age, income, spending and cash in one turn. |
| 1:00–2:00 | Correct spending; try annual gross income | Corrections change the picture. Gross/annual information is not invented as monthly net. Unknown pension differs from an explicit zero. |
| 2:00–3:00 | Use a separate fresh browser session for the sample | One frozen synthetic household, no fake bank connection or live-price claim. Own figures are never mixed into it. |
| 3:00–4:00 | Discuss retirement versus the mortgage | Age 52, retirement goal 63, mortgage term 240 months. The dates do not line up automatically. Monthly surplus is EUR 756.76; EUR 568 is already committed to saving, leaving EUR 188.76 unallocated. |
| 4:00–5:00 | Plan: EUR 300 monthly extra repayment, Ask FinTwin | The selected server snapshot carries the exact assumptions. At unchanged spending/saving, EUR 300 exceeds the unallocated EUR 188.76: the alternative leaves a EUR 111.24 monthly shortfall. Contractual repayment permission is not assumed. |
| 5:00–6:30 | Prepare meeting, inspect a source, switch language and print | A useful, deterministic adviser brief—not a product pick, an offer or a regulated advice record. |
| 6:30–8:00 | Review unknowns, reset sample, show fallback/preflight | Reset restores the fixture; historical snapshots are stale, not silently rewritten. Voice demonstration only if separately verified. |

Do not demonstrate real personal details. Do not imply that the prototype is affiliated with DVAG or has assessed product suitability.

## Recovery / tested fallback

### Current voice interaction

When Realtime is available, **Start voice conversation** is the primary control.
One click starts continuous listening; speech detection ends each turn and a new
utterance interrupts playback. There is no per-turn play/pause requirement.
Marin is an AI voice, not a human operator. Assistant transcripts and result cards
appear after the spoken reply; interrupted, unspoken transcript deltas are dropped.
Text remains usable and is not separately read aloud by the chained speech player.

**Microphone & options** contains the device selector and optional push-to-talk.
The selected device persists in this browser; the app does not change macOS input
settings. An unavailable saved device fails explicitly instead of silently falling
back to an iPhone. Browser sound blocking pauses capture and provides Enable sound.
Mute and End voice remain visible while connected. End closes capture and the
owned provider call; no paid calls run merely because the page is open.

The bounded live scripts require explicit `--allow-paid` and use isolated synthetic
households. `scripts/conversation-smoke.mjs` checks four text turns and an agreed
retirement illustration. `scripts/realtime-smoke.mjs` now defaults to two hands-free
turns using an existing generated fixture; `--push-to-talk` retains the older test.
Neither is invoked by startup, build or the normal automated suite.

Existing conversations and household facts are preserved, not retrospectively
rewritten. A previously misclassified total in Retirement accounts needs a scoped
review before relying on that saved household; historical scenario cards are
immutable, not corrected forecasts. New illustrations use `current_assets` as a
total override and never add that total as another account.

To disable voice but retain an authorized live text model: set `FINTWIN_VOICE_MODE=text` and restart the host.

To disable all paid traffic while retaining the chosen persistent database:

```bash
FINTWIN_NO_PROVIDERS=1 corepack pnpm start:production
```

For a disposable demonstration with no saved data at risk: `pnpm demo`. The deterministic companion handles a bounded set of financial intents; it is not a replacement for an unrestricted LLM. Text, calculators, state editing and the brief remain available without provider calls. The browser app still requires the local/server host; this is not an offline-installed PWA.

## Sixty-minute manual rehearsal checklist — NOT RUN

- Record operator, date, commit, host, browser/version, microphone, selected voice/model, network and budget window.
- Minute 0: explicit consent to paid trial, gate/permission/device checks, record initial budget.
- Minutes 0–10: EN introduction, annual income clarification, numerical corrections, side questions.
- Minutes 10–20: natural pauses, interruption, typing while speaking, mute/PTT.
- Minutes 20–30: German and accented-number turns, locale switch, verify canonical state.
- Minutes 30–40: UI edits, selected snapshot, changed baseline, stale brief and fresh export.
- Minutes 40–50: idle expiry, explicit rollover/reconnect, temporary network failure, fallback and recovery.
- Minutes 50–60: second reset of synthetic state, repeat one fact correction, inspect usage, End voice and sign out.
- Record every error/reconnect and actual costs from the provider dashboard separately. Do not clear the budget window to get past an exhausted allowance.
- Fill the evaluation rubric and measured latency rows. Release remains unverified until this actual-device observation is complete.
