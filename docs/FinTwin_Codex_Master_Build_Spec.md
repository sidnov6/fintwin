# FinTwin — Codex master build specification

**Owner:** Siddharth Jain  
**Prepared:** 4 September 2026  
**Target:** A reliable, polished interview demonstration for a nontechnical senior financial adviser at DVAG in Germany.  
**Status:** Implementation requirements. These changes have NOT been implemented or tested by preparing this document.  
**Primary experience:** Natural, interruptible English/German conversation, grounded in an editable household picture and deterministic scenarios.  
**Budget context:** Owner is willing to spend approximately EUR 30–50 on the interview experience and preparation; do not treat this as permission for unlimited automated API calls.

## 0. Execution instruction

Implement this specification in the existing FinTwin repository. Do not return another architecture proposal instead of working code. Inspect the current working tree and existing repository instructions first, preserve the owner's uncommitted changes, and implement in the gated milestones below. Make reasonable reversible implementation decisions; document them rather than repeatedly asking the owner to choose libraries.

Read this entire specification before editing. The accompanying `FinTwin_Audit.md` supplies historical defect evidence; the current local source is authoritative for whether a defect still exists. This specification supersedes the earlier implementation handoff's optional scope: realtime voice is a requested deliverable, but it must remain feature-flagged until genuinely verified. Do not discard a functioning fallback to make the new route appear complete.

Do not push, deploy publicly, delete existing user data, rotate credentials, or start sustained paid tests without the owner's explicit authorization. Never print secret values. Implement, run available local checks, and report blockers precisely. Missing credentials should block live verification, not the implementation of mock-tested adapters and the rest of the application.

Create `docs/BUILD_PROGRESS.md` with each requirement's status: not started, in progress, implemented/unverified, verified, or blocked. Include changed files, actual commands/results, remaining issues, and the next executable step. Update it at each milestone. A plan, screenshot, mocked provider result, or source-only check does not establish live audio readiness.

## 1. Product contract

Build a **financial conversation and adviser-meeting preparation companion**, not an autonomous product salesperson. The interviewer's takeaway should be: “This helps a client explain their situation, see trade-offs and arrive better prepared for a meeting with me.”

Keep the existing FinTwin identity, restrained styling, Chat/Picture/Plan structure, editable facts, shared financial engine, and sample-data labels. Improve the experience, not the number of dashboards. No DVAG logo, affiliation claim, compliance badge, or implication that the prototype is endorsed by DVAG.

The visible success criteria are:

1. A person can speak naturally, provide facts out of order, pause, correct themselves and ask a side question without fighting onboarding.
2. Chat, voice, financial picture, scenarios and meeting brief use the same current information.
3. Missing or uncertain information is visibly different from zero. User-reported information is not presented as externally verified.
4. Each numerical scenario is reproducible, explicitly hypothetical and grounded in the existing server-side engine.
5. Voice interruption works; failures recover to an honest usable state rather than a frozen spinner or simulated live response.
6. A one-page adviser-meeting brief is a useful, reviewable end product.

Do not promise to reproduce ChatGPT exactly or call the product “perfect.” Deliver the acceptance evidence defined here.

## 2. Existing application and initial inspection

The audited snapshot uses these paths. Locate equivalent paths if the owner has since refactored:

| Area | Existing location |
|---|---|
| Frontend | `apps/web/app` — Next.js static export and React |
| Chat UI / message cards | `components/Chat.tsx`, `components/Cards.tsx` |
| Financial picture / editing | `components/Picture.tsx`, `components/FactEditor.tsx` |
| Planning | `components/Plan.tsx` |
| API client / voice / labels | `lib/api.ts`, `lib/voice.ts`, `lib/i18n.ts`, `lib/format.ts` |
| Active backend | `sites-worker/src/index.ts`, `chat.ts`, `companion.ts`, `tools.ts` |
| Providers / state / persistence | `sites-worker/src/providers.ts`, `groq.ts`, `voice.ts`, `state.ts`, `db.ts` |
| Shared types | `packages/contracts/src/index.ts` |
| Pure financial functions / fact registry | `packages/engine/src/index.ts` |
| Node host / environment forwarding | `scripts/dev-api.mjs`, `scripts/bundle-worker.mjs` |
| Deployment | `Dockerfile`, `scripts/build-sites.sh` |
| Tests | `sites-worker/tests`, `apps/web/tests/e2e`, app Vitest/Playwright configuration |

`services/api` is an older FastAPI reference service in the audited snapshot. Do not accidentally implement the upgrade there while leaving the active UI unchanged.

Before changing behavior, inspect `git status`, package scripts, lockfile, Node requirements, database initialization, routes and existing tests. Use the repository's package-manager version. Do not perform unrelated major dependency upgrades. Add narrow transport/test dependencies only where needed.

The Docker host serves static frontend and API on one origin at port 7860. Next.js API routes alone will NOT implement backend functionality for a static export. New routes must be connected to the active server. The current Node runner explicitly allowlists provider environment variables; add every new server setting to the relevant binding/types/forwarding paths. Keep Node-specific long-lived WebSocket code out of worker/browser bundles.

## 3. Non-negotiable architecture boundaries

**One conversation, one household state, one calculation engine.** Realtime voice is a transport to the same application, not a parallel chatbot with its own untracked memory.

Use a shared server-side application layer for validating fact proposals, applying changes, deriving the picture, creating scenario snapshots and assembling briefs. Both the text route and realtime tools call that layer. Reuse existing tools where possible rather than introducing a second implementation of the calculations.

The model can understand intent, propose structured updates and explain returned results. It cannot bypass input validation, session ownership, fact revisions, or financial tools. Browser calculations are responsive previews; server-recomputed results are authoritative for chat and briefs.

Maintain three distinct categories: baseline user/sample facts, planning assumptions, and scenario outputs. Never silently promote a scenario assumption to a personal fact. Loading sample data must not quietly mix a second household into an existing one.

Extend current types and schema through additive migrations. Do not require a database reset to upgrade. Back up the local database before migration; do not copy it into deliverables. Use transactional mutation/revision handling in both the real backend and Node SQLite adapter; do not assume the existing shim's sequential `batch` is atomic.

## 4. Repair conversation and fact capture

### 4.1 One intake path for every turn

Process the complete first introduction before choosing the next question. Remove early returns that save only a name or accept only the first matching financial amount. Handle all clearly stated facts in one turn, including corrections embedded in the same sentence.

For text, use schema-constrained extraction where needed and deterministic handling for safe unambiguous patterns. For realtime, use structured tool proposals from the voice agent, with the same server validation. Do not add two competing extraction mechanisms that both write the same fact. Bind proposals to the source conversation turn; transcript availability and a model's confidence are not guarantees of correctness.

A proposal must express: intended operation (`set`, `correct`, `remove`, `question`, `hypothetical`), fact key, typed amount/value, currency, period, income basis where relevant, household scope where relevant, source turn/reference, original wording or evidence span, and uncertainty/clarification requirements. Store minimal provenance, not a second unrestricted copy of all transcripts in logs.

Clear user statements can be stored immediately as user-reported facts with a visible acknowledgement. Do not ask “confirm?” for every ordinary fact. Ambiguity that changes a result must be clarified rather than guessed. “Confirmed” in the UI means confirmed by the user, not verified by a bank or adviser.

### 4.2 Meaning-preserving updates

- “I earn 60000 a year” identifies annual income but leaves gross/net unresolved. Ask about gross/net. Do not populate monthly net income with 60000.
- “My net income is 60000 euros per year” produces EUR 5000 monthly equivalent, retaining the annual source meaning.
- Gross salary never becomes net salary through an invented tax calculation.
- “No, spending is 2500, not 3500” sets 2500, not the first/last arbitrary number.
- “Actually 5500 — sorry, 5000 net a month” uses the final clear correction.
- “What if I earned 7000?” leaves actual income unchanged.
- “My friend earns 7000” does not update the user's income.
- “My partner earns 2000 as well” is not silently overwritten into personal income or added again to an already combined household figure. Clarify scope where needed.
- “I don't know my pension” remains unknown; “I expect no pension” may set explicit zero if the meaning is clear.
- “Forget my salary” removes it and invalidates dependent current summaries; it does not convert it to zero. Existing historical scenario snapshots stay historical and are marked stale.

Minimal per-fact provenance should retain source type (`user`, `edit`, `sample`, `derived`), original period/basis/scope when relevant, update time, source turn ID and revision. Do not present model confidence scores as probabilities that a financial fact is true.

### 4.3 Flexible conversation policy

Ask at most one main question per normal turn. Follow the user's current goal and the most consequential missing information. Support skip, return later, topic changes and side questions. Do not ask for an already usable fact. Do not force a full questionnaire before answering a simple question or showing a labelled example.

Give concise responses by default: approximately 20–60 spoken words, normally one observation plus one implication or question. This is a style target, not a blind truncation rule. Direct factual answers can be shorter; requested explanations can be longer. Do not end every response with an unnecessary question. Put detailed assumptions in cards rather than reading an entire dashboard aloud.

Default to the selected language; use natural English and professional German with “Sie.” Support an explicit switch without resetting state. Do not switch languages merely because an English utterance contains a German financial term. Handle pauses and accented speech without pretending poor transcription is certain.

### 4.4 Prompt baseline to implement and evaluate

> You are FinTwin, an independent financial-meeting preparation companion. Help the user organize their situation, understand illustrative scenarios and prepare questions for a human adviser. Speak naturally in their selected language. Capture all clear facts; ask one focused clarification when meaning is uncertain. Distinguish user facts from assumptions and hypotheticals. Use application tools for updates, calculations and current state. Never claim a change was saved or a calculation finished until its tool succeeds. Explain the exact scenario returned by the tool, including important limitations. Do not recommend named financial products, assert suitability, guarantee returns or claim DVAG endorsement. Be concise, warm and matter-of-fact. Avoid repeated praise, boilerplate disclaimers and unnecessary onboarding questions. On interruption, listen to the new instruction and do not resume an obsolete answer.

Place policy in one versioned source of truth used by both modes. Prompts supplement server validation; they do not replace it.

## 5. Strict numeric semantics and financial consistency

Use canonical numeric JSON at mutation/tool boundaries. Reject localized numeric strings there unless routed through an explicitly declared locale parser first. The UI/transcript adapter may parse localized text, then submit canonical values. Reject `null`, empty/whitespace text, `abc`, `NaN`, infinity and invalid ranges. Explicit zero, absent and removal are distinct operations.

Parse German `5.500,50` as 5500.50 under German conventions and English `5,500.50` as 5500.50 under English conventions. Never silently truncate to 5.5. Ambiguous shorthand must use explicit conversational/locale context or trigger clarification. Annual/monthly conversion and currency are separate decisions. Do not invent exchange rates; unsupported non-EUR facts stay unresolved for EUR totals.

Keep currency precision and rounding consistent with the existing engine; monetary display and comparisons should not drift across components. Preserve known-good formulas and boundary tests. Fix formula defects only with documented examples and regression tests.

The current registry describes monthly spending as including housing payments. Preserve that convention visibly. Do not deduct the mortgage twice. Distinguish income minus spending from additional money available after already committed saving/investing. Do not automatically claim the entire surplus is available for extra repayments while also allocating it to retirement contributions.

Unknown inputs must not yield a confident complete net worth or readiness score. A partial subtotal is acceptable only when labelled partial and accompanied by missing inputs. A retirement calculation with unknown pension may show a deliberately labelled zero-pension scenario, but not an asserted personal shortfall. Pension, target spending and projection outputs need an explicit nominal/today's-money convention; keep the existing engine's real/nominal distinction visible.

Show the assumptions actually used: returns, fees, inflation, withdrawal rule, contribution timing and any omitted costs/taxes. Existing defaults are illustrative assumptions, not current market estimates or guarantees. A “readiness ratio” is a model ratio, never a probability of success. Explain that scheduled monthly extra repayment is the engine's simplified assumption, not proof a mortgage contract permits it.

## 6. Unified provider routing and honest status

Use `chatProvider(...)` or its replacement as the sole resolver for text-provider capability. Eliminate Groq-key-only branching in chat, status and startup logs. Preserve documented custom-provider precedence. Do not add a dummy Groq key as a workaround. A custom provider without an explicit valid model must not silently receive a Groq-specific default model ID.

Separate configured/available capability from actual response origin. Each turn should record its true origin: live model, deterministic/scripted, policy, or fallback; record provider/model only when actually invoked. The UI may simplify the language, but must not badge scripted onboarding as a live generated reply.

Preserve existing custom text/Groq support. Make parameters provider-aware: endpoint shape, token fields, reasoning options, streaming/tool schemas. Never blindly send unsupported options. Add new adapters only where a verified API requires them. The requested main voice provider is independent of the configured text provider.

Add an opt-in provider smoke command that validates a real streamed response and a harmless tool round trip with synthetic inputs. Normal tests are provider-free. A configured key is not a passed smoke test.

## 7. Realtime voice: requested primary experience

### 7.1 Transport decision

Implement OpenAI Realtime speech-to-speech over browser WebRTC as the primary enhanced voice route, using currently documented supported APIs. The official voice-agent guide checked for this brief uses `gpt-realtime-2.1`; set it as a configurable candidate, not an account-access guarantee [R1]. Validate availability and supported session options with the owner's actual project before enabling it for the interview.

Prefer the documented unified, server-mediated SDP initialization on the existing Node host, plus a server-side control connection. This lets the server establish ownership of a provider call while the browser exchanges media directly. Official documentation describes both the unified and temporary-client-credential connection patterns [R2] and server-side control/tool handling [R3]. Do not combine incompatible snippets from different API generations.

The permanent OpenAI key stays server-side. Server-owned session configuration chooses model, instructions, tools and limits. Bind each provider call ID to the authenticated application session. Do not let an arbitrary browser-supplied call ID acquire a privileged server connection. Use the supported session SDK where it simplifies the application; raw WebRTC is acceptable when better aligned with the server-owned handshake. Choose one implementation and document it.

Implement a small Node-only transport module for long-lived provider controls where necessary; route all tool execution into the existing shared server application layer. Keep the worker's non-realtime paths deployable. A runtime without the new transport must truthfully report realtime unavailable and retain existing text/chained voice. No new Python service, message broker or general multi-agent framework.

### 7.2 Shared tools and context

Expose narrow, schema-validated capabilities: read current household, propose/apply fact changes, obtain missing questions, create/read a scenario and assemble the meeting brief. Reuse current tool implementations. Authorization supplies the user identity; model/browser arguments cannot choose another user. Bind mutation calls to a turn and use idempotency keys.

Before financial statements, obtain current server facts/results. Do not let the audio model invent numerical results while a calculation is pending. A short truthful nonnumeric acknowledgement is acceptable. Sync successful edits from the Picture/Plan screens into the active voice session. Send the active scenario ID and its authoritative result rather than only a text summary of sliders.

Do not send the same user turn to both the realtime generator and the old text/TTS pipeline. One active audio capture owner and one active output owner. Switching modes must close old media tracks, response streams, timers and event subscriptions.

### 7.3 Turn taking and cancellation

Implement explicit connection and turn states: connecting, ready, listening, processing, speaking, interrupted, reconnecting and error. Separate microphone mute from ending a session. Do not show “Listening” while no capture/session is active.

Use supported voice activity detection with settings suited to natural pauses; consider semantic end-of-turn detection rather than simply minimizing a silence timer [R4]. Expose a simple push-to-talk option for difficult rooms or hesitant speech. Tune with English, German and the owner's actual speaking style.

When the user interrupts, stop old playback, cancel/invalidate the old generation, accept the new utterance, and ensure unplayed output is not treated as something the user heard. Follow the transport's actual interruption/truncation lifecycle rather than double-truncating SDK-managed events [R5].

Every asynchronous result has session, turn and generation IDs. Ignore stale completions. Cancellation must propagate through the Node request bridge, worker calls, transcription/model/TTS operations and queued audio; stopping an audio element alone is insufficient. A committed fact update is not undone by canceling its spoken explanation. Clearly show successful changes, and let the subsequent correction supersede them.

Keep text input available while voice is active. Submitting text should interrupt/serialize clearly, not be silently discarded because a request is busy. Debounce only accidental double submissions, not meaningful corrections.

### 7.4 Fallback and privacy behavior

Retain the chained route, fixed for cancellation, as an explicit fallback. Retain text-only operation even when every paid provider is unavailable. Never claim the deterministic fallback is the live model. A failed connection should offer “Continue in text” and “Try voice again” without losing facts.

Cover microphone denial, unavailable audio device, autoplay blocking, expired session, network loss, rate limit, provider outage and budget exhaustion. Silence must not cause recurring model calls. Stop capture on End conversation, navigation/unmount and session replacement. Do not retain raw audio by default. Display a brief microphone/provider-processing notice and an obvious stop control.

### 7.5 Configuration

Add/document these settings, choosing a consistent final naming scheme:

- `OPENAI_API_KEY`: backend only.
- `OPENAI_REALTIME_MODEL`: configurable; candidate `gpt-realtime-2.1`.
- `OPENAI_REALTIME_VOICE`: a currently supported, smoke-tested voice; do not invent a voice ID.
- `FINTWIN_VOICE_MODE`: `realtime`, `chained`, or `text`; rollback with one setting.
- Session duration, idle timeout, output limits and usage ceilings, all server enforced.

Add them to environment types, host forwarding, sanitized `.env.example`, health capability reporting and deployment documentation. Never use `NEXT_PUBLIC_` for secrets. Default the distributed configuration to a safe unavailable/fallback state when credentials or runtime capability are missing.

## 8. Immutable scenarios and synchronized displays

Replace lossy “Ask FinTwin” strings with an authenticated scenario ID referencing an immutable server snapshot. Include kind, all canonical inputs, material assumptions, baseline fact revision, engine version, creation time, authoritative results and provenance. Recompute browser-submitted inputs server-side; do not trust a browser result object.

A mortgage scenario carries principal, rate, term, extra payment amount/frequency and the exact baseline payment used. A retirement scenario carries current assets, contributions, ages/horizon, pension, target spending, return, fees, inflation and withdrawal assumption. Goal scenarios carry starting assets, target, contribution, return and an explicit as-of date. Resolve engine defaults into the snapshot so later defaults cannot silently change the story.

UI preview, chat explanation and brief must reference that same snapshot. “Why did that change?” and “Compare it with the previous version” should work through the selected scenario context, not vague memory. Support baseline plus one selected alternative clearly; no need for an unlimited comparison dashboard.

On changed household facts, mark prior snapshots “Based on an earlier version.” Allow explicit recalculation to create a new snapshot; do not rewrite historical results. Prevent stale React slider state from silently diverging after a correction/sample reset. Warn before replacing a user's unsaved scenario edits.

Separate `Apply to my facts` from `Explore scenario`. Saving zero pension must overwrite a previous positive pension. Hypothetical changes never mutate baseline automatically. Disable dependent explanation/export while validation is incomplete rather than showing an old result under new inputs.

## 9. Streaming and failure recovery

Extend shared event contracts to express terminal success, cancellation, error and replacement. Use stable IDs and ordering. A fallback after partial text must replace the incomplete assistant message or clearly terminate it with a separate recovery message; never append two sentences into corrupted prose. Stop the superseded speech output.

Guarantee busy-state cleanup on errors, aborted requests, disconnect, timeout and a stream ending without its expected completion event. Retry must not repeat a successful fact write or create duplicate next steps. Guard committed mutations with idempotency records and fact-revision checks, not frontend button state alone.

Show a human-readable error and a useful recovery action; keep technical error detail in sanitized diagnostics. Never expose raw provider errors containing secrets/request content. Do not substitute invented financial numbers when a tool fails. After server restart, reconcile authoritative state before resuming voice.

## 10. Product polish: preserve the visual system

Keep the existing fonts, restrained palette and component vocabulary unless a measured usability issue requires a change. Do not add a landing-page redesign, animated avatar, decorative 3D orb, stock images or unnecessary chart library. Functional polish has priority.

**Opening screen:** a clear purpose statement and two actions: “Start a conversation” and “Explore a sample household.” First spoken welcome should be brief, not a feature tour. Sample status stays visible throughout. Loading/resetting a sample with existing data requires explicit confirmation or a separate demo session.

**Conversation:** readable streaming responses, a compact persistent voice/status bar, obvious Stop/Mute/End controls and editable transcript-derived facts. Avoid forced autoscroll when the user is reading older messages. Offer a return-to-latest control. Show cards once, not repeatedly on every stream update.

**Financial picture:** distinguish “You told me,” “Sample,” “Assumption,” “Calculated” and “Not provided.” Make a successful edit visible near the changed fact, e.g. “Monthly spending: EUR 3500 → EUR 2500,” with unobtrusive highlighting. Do not label a user's estimate “verified.” Missing coverage is “Not confirmed,” not a diagnosed protection gap.

**Planning:** display baseline versus selected scenario, the main change, and expandable assumptions. Use plain-language tooltips for unfamiliar financial terms. Explain what the number represents; no unexplained scores, investment rankings or guaranteed outcomes.

**Meeting preparation:** a prominent “Prepare adviser meeting” action after enough context exists; explain what is missing when it does not. Allow a partial brief with labelled unknowns instead of forcing irrelevant onboarding.

**Accessibility/localization:** keyboard access, visible focus, labelled controls, readable contrast, reduced-motion support, no color-only status and correct locale formatting. Test desktop presentation at 1440×900 and 1280×800, a narrow 390px layout, both languages and 200% zoom. Status live regions must not read every streamed token aloud. German labels must not overflow.

## 11. Adviser-meeting brief: the principal new product output

Add a print-friendly review screen and browser print/save-as-PDF action; no email/CRM integration or heavyweight document service is needed. Title: **“Your adviser meeting brief” / “Ihr Überblick für das Beratungsgespräch.”** Target one readable A4 page for the demo fixture; paginate excess content instead of truncating or shrinking it illegibly.

Assemble a structured payload server-side from current facts and selected authoritative scenarios. Use a deterministic template for figures, assumptions and open questions. Optional model wording may paraphrase supported narrative but must not become the source of numerical facts. Generation must work without a paid model.

Include the household's stated objective, relevant user/sample facts, the selected scenario and baseline comparison, important assumptions/limits, unanswered questions, agreed next steps, suggested documents and date. Examples of documents may include a mortgage statement or pension estimate when relevant; do not claim every document is mandatory.

Every numeric field carries a fact/revision or scenario/result reference. “View source” in the review screen reveals that reference and its meaning. Keep personal identity optional/minimal. Distinguish user-reported estimates from external evidence. Prominently preserve the synthetic label for demo data.

Let the user review/correct underlying facts, then refresh the brief. A stale brief must be regenerated or explicitly exported as a dated historical snapshot. Printing a brief does not send it to anyone. No signatures, suitability verdicts, product recommendations, invented savings estimates or claim of regulated advice documentation.

## 12. Reconciled demo fixture and demonstration story

Create one polished, deterministic synthetic household using the existing sample, plus a blank fresh-start mode. Do not proliferate personas. Freeze the fixture date/version and any sample quotes in demo mode. Never call frozen prices live; this is not a market-data presentation.

Reconcile the existing mortgage before relying on it: the audit found EUR 240000 at 2.15% for 240 months with a stored EUR 1420 payment, whereas the current engine returned EUR 1231.24. Prefer deriving the sample payment from the same annuity calculation and documenting the fixture construction; do not alter the formula to fit the old fixture.

Because spending includes mortgage payments, preserve non-mortgage sample spending separately during fixture construction: original total 6672 minus original payment 1420. Then add the newly derived payment. Keep the existing committed monthly saving distinct from remaining unallocated cashflow. Use deterministic calculations for fixture expectations, with an independent golden/reference check where appropriate.

Preserve the original retirement aspiration and show any tension honestly. A household aged 52 with a 20-year modeled mortgage and a goal of retirement at 63 does not automatically repay the house by retirement. This is a useful discussion point, not a reason to fabricate a feasible plan.

Implement one-click reset for the current synthetic session with confirmation. Two resets produce identical facts/results; current real timestamps can appear separately from the frozen scenario as-of date. Reset invalidates old request generations and clears their UI/state ownership. It must not affect another session or reset aggregate usage accounting.

Document a 6–8 minute core demonstration:

1. Start with a blank household and speak a multi-fact introduction; show correct capture and a natural next question.
2. Correct a value mid-conversation; show the picture update without restarting onboarding.
3. Open the sample in a separate/reset-confirmed synthetic session; explain the mortgage/retirement concern.
4. Change one mortgage assumption and an extra repayment; ask FinTwin to explain the exact selected scenario and trade-off.
5. Ask what remains uncertain, then produce the adviser-meeting brief.
6. Invite one unscripted input. Keep a rehearsed text fallback available.

Do not fake responses for the rehearsed phrases. The demo must work with paraphrases and changed numbers.

## 13. Access, privacy, cost and operational readiness

Before public paid endpoints are enabled, provide a protected demo entry with server-issued signed/opaque sessions, secure cookie settings on HTTPS, origin/CSRF protection where appropriate, request limits and per-session ownership. A small demo passphrase gate is acceptable; it is not a production client-account system. Never use unsigned client/device IDs as proof of identity. In standalone hosting, strip forged platform identity headers. Only trust platform identity when explicitly deployed behind the verified injecting gateway.

Protect realtime initialization/control, chat, transcription, synthesis and tools. Enforce rate, body-size, duration, idle and concurrent-session limits. Do not accept a browser-selected model, provider URL or user ID. Session B must not read, modify or export session A's data. Use synthetic data only for demonstrations and tests.

Implement a server-owned usage ledger covering realtime audio/text, text-model calls and optional transcription/TTS. Use provider-reported usage where available; label estimates and unreported usage honestly. Realtime cost includes context as well as newly spoken audio, so duration alone is not an invoice [R6]. No raw secrets, transcripts, financial payloads or audio in default telemetry.

Use configurable provider-currency ceilings, with a conservative default such as USD 25 per logical demo session and USD 40 across the protected demo budget window, plus a separately authorized small smoke-test allowance. These are planning guardrails, not an assertion of an exact EUR exchange rate or invoice total. Do not run sustained tests simply because a key exists. Track usage across reconnects and resets, reserve conservative allowance for in-flight requests, and prevent new calls when the remaining allowance is insufficient. Do not represent a client-only counter or a delayed billing alert as a hard cap. Account-level/provider controls and outstanding charges still matter.

Permit manual stop and server-side termination of active paid sessions. Confirm what the chosen realtime API supports for closure and maximum duration. Warn/reconnect before provider session expiry where practical; retain the confirmed household and relevant selected scenario without pretending an unlimited audio history is preserved. Do not reset budget on a reconnect.

Add a presenter-only preflight view: backend reachability, actual provider capability, last explicitly run live smoke result/time, microphone permissions, selected voice/language, sample version, transport availability and remaining budget estimate. Do not show technical diagnostics by default to the adviser.

Keep local single-origin operation as a deployment fallback; document its dependency on internet for live providers. Offline deterministic text/calculators/brief must remain usable. Update Docker/environment examples and verify the image/host path; a dev-server-only pass is insufficient. Do not claim production or regulatory compliance from these demo safeguards.

## 14. Acceptance matrix — turn requirements into tests

Implement these as deterministic unit/integration/browser tests wherever possible. Cases involving actual speech/provider behavior also need explicitly recorded live/manual verification. Assert semantics and state, not identical generative wording.

| ID | Input or action | Required result |
|---|---|---|
| C01 | Fresh: “My name is Alex. I am 40 years old, earn 5000 net a month, spend 2500 a month and have 20000 in cash.” | Name, age and three amounts saved; no repeated questions about them. |
| C02 | “I earn 60000 a year.” | Annual income recognized; gross/net clarification; not stored as 60000 monthly net. |
| C03 | “My net income is 60000 euros per year.” | Monthly equivalent 5000 with annual provenance. |
| C04 | “My gross salary is 60000 a year.” | No invented net income. |
| C05 | “Income is 5000 net monthly and spending is 2500 monthly.” | Both updated in the same turn. |
| C06 | “No, spending is 2500, not 3500.” | Correct value saved; dependent picture refreshed. |
| C07 | “Actually 5500 — sorry, 5000 net monthly.” | Final intended 5000, not 5500. |
| C08 | “What if I earned 7000?” | Hypothetical; baseline unchanged. |
| C09 | “My friend earns 7000.” | No income mutation. |
| C10 | Partner's income after a combined-household figure | No double counting; scope clarified where needed. |
| C11 | Skip; side question; return to mortgage | Existing facts preserved; no onboarding restart. |
| C12 | “Forget my salary.” | Removed/unknown, not zero; dependent current output updated. |
| C13 | “Ich verdiene 5.500,50 Euro netto im Monat und gebe 2.500 Euro aus.” | Correct German amounts and natural German continuation. |
| N01 | Localized money, invalid strings, null, whitespace, NaN/infinity | Correct adapter parsing; strict API rejection where invalid. |
| N02 | Unknown pension versus explicit zero pension | Different stored state and appropriately qualified projections. |
| N03 | Unsupported currency or unclear period | No silently invented EUR/monthly conversion. |
| N04 | Age/rates/horizon outside valid domain | Validation, no NaN or misleading clipped result. |
| N05 | Spending already includes mortgage | No double deduction in cashflow/scenario comparison. |
| P01 | No provider keys | Honest deterministic/text capability, no fake live badge. |
| P02 | Groq only, custom only, both | Correct documented routing and actual invocation. |
| P03 | Scripted/policy response with valid keys | Correct per-turn origin, not mislabeled generated. |
| P04 | Custom endpoint without valid model configuration | Actionable configuration error, not Groq-model default leakage. |
| S01 | Mortgage extra repayment 300; click Ask FinTwin | 300 and all other inputs survive; server/UI/chat agree. |
| S02 | Change retirement pension/return; Ask FinTwin | Pension, return and every engine assumption retained. |
| S03 | Save pension zero over a positive value | Zero persists and derived values refresh. |
| S04 | Explain scenario after baseline facts change | Stale baseline identified; explicit recalculation available. |
| S05 | Tamper with client result | Server recomputes/validates; forged results not authoritative. |
| S06 | “Compare that with the previous scenario.” | Correct scenario IDs/results compared; no invented memory. |
| S07 | Reset sample while a Plan tab/response is open | No stale sliders, results or late writes into new state. |
| V01 | Interrupt during speech | Old speech stops; new input accepted; old output never resumes. |
| V02 | Cancel during transcription/model/TTS | Late result ignored; no unintended new submission/playback. |
| V03 | Type a correction while voice/model is busy | Clearly accepted/serialized; not silently discarded. |
| V04 | Natural mid-sentence pause | No premature confident response; tune on real audio. |
| V05 | Microphone permission denied | Text remains usable; actionable voice recovery. |
| V06 | Network/provider/session interruption | Honest status; state retained; no duplicate session/turn. |
| V07 | Switch realtime/chained/text repeatedly | One microphone/output owner; tracks/listeners released. |
| V08 | English/German and accented-number corrections | Correct capture or explicit clarification. |
| V09 | UI fact correction during a voice session | Subsequent voice reasoning uses the new revision. |
| V10 | End conversation; stay on page | No active microphone or continuing provider generation. |
| E01 | Model stream fails after partial text | Clean replacement/recovery; no garbled joined reply. |
| E02 | Stream ends without done | Busy state cleared; useful retry path. |
| E03 | Retry after a committed tool mutation | Exactly one effective mutation; no duplicate next step. |
| E04 | Old generation arrives after a newer correction | No overwrite of the newer fact/state. |
| B01 | Produce brief from current facts and scenario | All numerical fields have authoritative references. |
| B02 | Missing data or stale scenario/brief | Unknown/stale status visible; no invented completion. |
| B03 | Print EN/DE at A4 | Readable content and assumptions, no truncation. |
| B04 | Edit facts then regenerate brief | Updated revision appears; old figures do not persist silently. |
| D01 | Reconciled sample; unchanged scenario | No unexplained baseline saving; cashflow consistent. |
| D02 | Reset twice / provider-free demo | Same synthetic facts/results; deterministic calculators and brief work. |
| A01 | Forged device/platform identity / cross-session access | Rejected or isolated by server-established identity. |
| A02 | Unauthenticated paid endpoint / wrong-origin mutation | Denied before provider call or state mutation. |
| A03 | Budget exhausted / reconnect / reset | New paid work blocked; usage not reset or falsely zeroed. |
| A04 | Browser bundle/log/deliverable inspection | No permanent API secrets or default sensitive payload logs. |
| U01 | Desktop/narrow/zoom/keyboard/EN/DE | Primary controls usable, readable and correctly labelled. |
| U02 | Sample vs real entry; missing protection | Synthetic/unknown status honest; no invented risk diagnosis. |

Also retain all meaningful existing tests. The prior audit used an adapted harness for 37 worker test cases; this is not a native CI pass for this new implementation. Record fresh native results.

### Human/live evaluation

Create a short rubric for ten unscripted conversations: listens without repetition, captures/corrects facts, asks appropriate clarification, uses exact scenario, speaks concisely, handles interruption, and avoids unsupported financial claims. Score 1–5 with examples; no self-awarded “perfect” score. Repeat key provider tests with altered phrasing and values. Deterministic regression tests must pass on every run; stochastic live quality needs observed evidence, not one lucky response.

Measure speech-end to first audible response, detected-interruption to stopped playback, and successful mutation to displayed state. Record median/p95, sample size, transport/model, device/browser/network and tool vs no-tool turns separately. Initial engineering goals: median first audio within 2 seconds for simple no-tool turns, p95 within 4 seconds, detected-interruption stop within 300 ms, and visible update within 500 ms after the server mutation event reaches the client. These are targets, NOT claims about current performance; tune against measured results and explain misses. Do not rush non-native speakers merely to achieve a latency statistic.

Run a continuous 60-minute manual rehearsal on the actual device/hosting when authorized, including idle periods, interruptions and a provider-session rollover if applicable. Do not call the product one-hour-demo-ready without that observation. Provide a manual checklist rather than fabricating audio results when the coding environment lacks a microphone or credentials.

## 15. Milestones and completion gates

**M0 — Baseline and safety.** Inspect source/instructions, reproduce relevant defects, record native baseline commands, protect paid endpoints, prepare additive schema/contract changes. Preserve all owner work.

**M1 — Reliable conversation and facts.** Fix intake, meaning, numeric validation, provider routing, revisions and accurate status. Gate: C/N/P tests plus existing relevant tests. No voice rewrite may bypass these semantics.

**M2 — Grounded scenarios and recovery.** Snapshot handoff, reconciled fixture, state synchronization, idempotency and streaming/cancellation. Gate: S/E/D tests and browser verification of the complete text flow.

**M3 — Realtime voice.** Implement server-owned session/controls, common tools, browser lifecycle, fallback and sanitized telemetry. Gate: mocked lifecycle tests and explicitly separate live smoke/audio checks. Keep feature disabled for the interview until real-device checks pass.

**M4 — Adviser-facing finish.** Polish existing screens, add the grounded meeting brief and presenter preflight, complete bilingual/accessibility/print checks. Gate: B/U tests and a nontechnical walk-through.

**M5 — Release evidence.** Complete native checks, production-like/Docker verification, protected demo/fallback rehearsals, measurement and delivery docs. Gate: complete honest report; any unverified live behavior is explicitly outstanding.

Proceed through the milestones in order. Do not stop after M0 with a plan. When a milestone's external dependency is blocked, complete all remaining independent work and document the exact blocked test/setting. Do not compensate for missing access by silently changing the scope to a canned demo.

## 16. Commands, deliverables and final report

Inspect and use existing scripts. In the audited snapshot these root commands exist:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test:worker
pnpm test:web
pnpm --filter @fintwin/web test:e2e
pnpm build:web
pnpm build
```

The README mentions a root `pnpm test:e2e` shortcut that the audited root package does not actually define. Add a root alias or correct the documentation. Ensure Playwright's required browser is installed using the selected package version, then run the real suite. Do not merely run zero matching tests and report success.

Add a convenient `pnpm verify` aggregator for deterministic checks and clearly separate opt-in live commands. Add narrowly scoped regression commands where useful. A production-like start/preflight command should work without requiring the user to discover hidden environment variables. Update lockfile intentionally for required new dependencies.

Deliver actual implemented code plus:

- `docs/BUILD_PROGRESS.md`: state of every milestone, real checks and blockers.
- `docs/IMPLEMENTATION_REPORT.md`: changed behavior/files, decisions, migrations, commands/results, acceptance-ID mapping, measured vs untested behavior, outstanding limitations.
- `docs/DEMO_RUNBOOK.md`: setup, protected local/hosted start, provider configuration, 6–8 minute story, live verification steps, one-hour checklist and text fallback.
- `docs/CONVERSATION_EVALS.md` or structured equivalent: test utterances, expected state and observed live rubric results where actually run.
- `docs/TEST_EVIDENCE/`: actual browser screenshots/test artifacts, with mocks/synthetic fixtures labelled. Never export secrets or private databases.
- Updated `.env.example`, README and reproducible scripts, with no actual keys.

Finish by telling the owner what is implemented, what passed, what still requires live/manual testing, exact commands to start it, exact environment variable names to set privately, and how to roll back to the tested fallback. Do not say “production-ready,” “fully compliant” or “perfect.”

## 17. Explicitly out of scope

No multi-agent swarm, RAG/vector database, live banking, document OCR, brokerage execution, product recommendation/ranking engine, real client records, legal/tax conclusions, CRM/email integration, mobile app, major framework replacement or invented business-impact metrics. No deployment/paid-session automation without permission. Preserve existing useful portfolio features but do not let them dominate this household-adviser demo.

## References and evidence provenance

Code findings originate from the uploaded FinTwin snapshot and `FinTwin_Audit.md`. This specification also checked the Node environment forwarding, package scripts, Plan component, shared contracts, fact registry and retirement assumptions. It does not claim to rerun the earlier audit or any new native/live tests.

Official documentation checked 4 September 2026. Verify API signatures, model access and limits again while implementing; pin the actual working dependency versions. These sources support technical choices, not a guarantee of application correctness or financial/regulatory suitability.

- **[R1] OpenAI, Voice agents:** https://developers.openai.com/api/docs/guides/voice-agents
- **[R2] OpenAI, Realtime API with WebRTC:** https://developers.openai.com/api/docs/guides/realtime-webrtc
- **[R3] OpenAI, Webhooks and server-side controls:** https://developers.openai.com/api/docs/guides/realtime-server-controls
- **[R4] OpenAI, Voice activity detection:** https://developers.openai.com/api/docs/guides/realtime-vad
- **[R5] OpenAI, Realtime conversations:** https://developers.openai.com/api/docs/guides/realtime-conversations
- **[R6] OpenAI, Managing costs:** https://developers.openai.com/api/docs/guides/realtime-costs
- **[R7] OpenAI, Custom instructions with AGENTS.md:** https://developers.openai.com/codex/guides/agents-md

Keep this long specification in `docs/` and instruct Codex to read it explicitly. Do not overwrite an existing `AGENTS.md` with the entire brief; preserve repository instructions and add only a short pointer when appropriate [R7].
