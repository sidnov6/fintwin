# Conversation evaluation — evidence, not scores by assertion

5 September 2026. **Paid/live conversations observed: 0. Real audio samples: 0.** The candidate text/voice policy is implemented; no human-likeness, accent accuracy, latency or one-hour reliability score has been awarded.

## Deterministic and mocked observations

- `acceptance.test.ts`: first-turn multi-fact capture; annual/gross/net provenance; multi-field corrections; hypothetical/friend/partner exclusion; skip/side-question continuity; removal; German amounts; strict numerical semantics.
- `recovery.test.ts`: compound-scope leakage, real-versus-synthetic reset, idempotent next steps, late messages after reset, conservative usage and aggregate cap; **mocked** actual custom-provider invocation and a partial-stream fallback.
- `scenarios.test.ts`: exact snapshot handoff, pension zero/assumptions, stale snapshots, previous IDs, unchanged baseline and source-linked briefs.
- `realtime.test.ts` in worker: **mocked** sideband ownership, budget-before-response, permission/configuration boundaries, late turns, PTT ordering and hangup.
- `apps/web/app/lib/realtime.test.ts`: **mocked** media permission, late grant cleanup, selected device, mute/end, generation filtering, rapid PTT and typed turns.
- Real Chromium E2E tests exercise the built application/Node host with **providers off**, not a model-quality test.

All these results are regression evidence. A finite parser correctly handling test sentences does not establish general natural-language understanding. It defers ambiguous information and provides the model with the same validated tools when authorized.

## Ten unscripted live evaluations to perform

Use these as starting situations, not memorized scripts. An independent person should vary phrasing, amount, order and language. Repeat failures and successes with new values. Keep only synthetic details in evaluation notes; do not save raw audio by default.

| # | Situation / starting utterance | State or behavior to verify | Live observation / score |
| --- | --- | --- | --- |
| 1 | “I'm Alex, 40; 5000 net monthly, 2500 spending and 20000 cash. I'd like more breathing room.” | All clear values captured once; goal acknowledged; one useful next question. | Not run / unscored |
| 2 | “I earn 60000 a year.” Then clarify gross, then supply net separately. | Never infer after-tax income; annual provenance and conversion survive. | Not run / unscored |
| 3 | “Actually 5500—sorry, 5000 net monthly. Spending is 2500, not 3500.” | Last intended values win, no double capture or repeated question. | Not run / unscored |
| 4 | “What if I earned 7000 and spent only 2000? My friend earns that.” | No baseline mutation; hypothetical explanation remains distinct. | Not run / unscored |
| 5 | Combined household income followed by a partner's income | Clarify overlap/scope instead of adding the partner again. | Not run / unscored |
| 6 | Skip pension, ask a side question, then return and say “I expect no pension.” | Unknown stays unknown until explicit zero; conversation does not restart. | Not run / unscored |
| 7 | “Ich verdiene 5.500,50 Euro netto im Monat…” with a pause and accent | Natural pause handling; German Sie; localized numbers captured or clarified. | Not run / unscored |
| 8 | Sample, EUR 300 extra payment, Ask FinTwin, then change rate | Correct immutable IDs, comparison, unallocated shortfall and contract caveat. | Not run / unscored |
| 9 | Interrupt audio, type a correction, edit another fact in Picture | Old audio never resumes; next reasoning sees updated revision. | Not run / unscored |
| 10 | “Which ETF should I buy?” followed by preparing the adviser brief | Useful neutral criteria/questions; no product ranking, false guarantee or suitability verdict. | Not run / unscored |

## Rubric (1–5, with an example supporting every awarded score)

Score these dimensions separately: listening/non-repetition; fact capture/correction; clarification/scope; exact scenario grounding; concise natural language; turn-taking/interruption; unsupported-financial-claim avoidance.

- **1:** Clear failure (for example, hypothetical salary overwrites income, or interrupted audio resumes).
- **2:** Repeated assistance needed; a material omission or awkward turn still remains.
- **3:** Task eventually succeeds with minor correction; noticeable repetition or pause trouble.
- **4:** Correct, useful and conversational on the observed run; only minor friction.
- **5:** No observed defect on the varied run, supported by the recording notes/state diff—not a claim of universal perfection.

For each conversation record: language, variant utterances, transport/model, baseline revision and final revision, exact scenario IDs, failure/fallback origin, score per dimension, one concrete supporting example and retest result. Unsupported advice, covert mutation or cross-session leakage is a release-blocking failure regardless of the average score.

## Latency worksheet

These are **engineering targets, not measurements**. No timings below were inferred from unit-test duration or a server “speaking” event; those are not proof of audible output.

| Measurement | Target | Actual n | Median / p95 |
| --- | --- | --- | --- |
| Speech end → first audible response, simple no-tool | median ≤ 2 s, p95 ≤ 4 s | 0 | Not measured |
| Speech end → first audible response, tool turn | Report separately; explain tool latency | 0 | Not measured |
| Detected interruption → stopped playback | ≤ 300 ms | 0 | Not measured |
| Successful mutation event arriving → displayed state | ≤ 500 ms | 0 | Not measured |

Measure using a consented device recording with a visible timer or a validated audio-output capture, plus browser state-event timestamps. Do not store private conversations. Record browser, hardware/input, network, model, voice, language, tool/no-tool status and sample count. Sort durations to compute median and nearest-rank p95; retain the individual observations. Server readiness/SSE timings are diagnostic proxies only. Tune semantic VAD against real non-native pauses rather than sacrificing turn quality for a latency number.

## Release decision

Deterministic behavior and transport guards have automated evidence. **Live model quality, natural woman-like voice perception, semantic pauses, EN/DE accented audio, real interruption timing and continuous rehearsal remain unverified.** Keep Realtime disabled for presentation until the runbook and this worksheet have actual observations.
