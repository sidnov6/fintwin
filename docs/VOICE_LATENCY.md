# Voice latency improvement — 14 September 2026

## Implemented

- The existing GPT-5.4 Responses route now defaults to `reasoning.effort: none` and `text.verbosity: low`. The model is unchanged. `OPENAI_REASONING_EFFORT` permits an explicit override; unknown model overrides retain the previous low-effort default. Groq/custom behavior is unchanged.
- Spoken turns request a short first sentence and usually one to three sentences, retaining fact-validation, calculation tools, and negative-budget warnings. Detailed answers are still available when asked for.
- End-of-speech silence is 800 ms instead of 1,200 ms. The speech/noise gate and manual stop remain intact.
- Completed replies start with a short sentence-sized clip (up to 180 characters), with later clips capped at 400 characters or the provider's smaller limit. Decimal amounts and common German/English abbreviations are preserved.
- MP3 playback uses MediaSource where supported, consuming incoming bytes instead of awaiting the full audio Blob. Other formats/browsers use the existing Blob path with the same response, not a second paid request.
- A bounded queue prepares only the next clip while the current clip plays. Interruption cancels playback and prefetch; no silent provider/voice switch is introduced.
- Only completed answers reach speech. Speculative model text or partial tool calls are not read aloud. Stored facts, deterministic calculations, authentication, and budgets are unchanged.

## Verification and measured scope

Provider-free checks: 186 backend tests, 40 frontend unit tests, type checks, and 17 browser tests covering chat, charts, scenarios, and hosted-voice flows. Streaming lifecycle tests cover progressive playback, cancellation, unsupported-format fallback, decode failure, and bounded prefetch. The production build passes (an existing custom-font lint warning is unchanged).

Authorized live checks used the existing private key, synthetic prompts, and an isolated in-memory local household. No production household was edited, and no physical microphone was used.

| Check | Observation |
| --- | --- |
| Old whole-reply audio, 317 characters | Headers after 1,129 ms; full audio available after 3,518 ms. The old player waited for the latter. |
| Sentence-sized audio, 149 characters | Headers after 1,268 ms; full audio available after 2,699 ms. |
| Actual streamed MP3 in headless Chromium | Headers after 2,811 ms; playback started after 2,910 ms, before download completion. Cancellation passed. |
| Short definition, original low reasoning | First text 1,434 ms; completed answer 1,740 ms. |
| Same definition, reasoning disabled | First text 1,042 ms; completed answer 1,431 ms. |
| Mortgage what-if, original low reasoning | First text 1,984 ms; completed answer 2,765 ms. |
| Same mortgage what-if, reasoning disabled | First text 4,284 ms; completed answer 4,971 ms. Correct scenario card and calculation returned. |

These are individual observations, not a controlled benchmark or a latency SLA. The mortgage sample was slower, so they do **not** establish that disabling reasoning speeds up every request. The reproducible improvements are removal of the extra 400 ms silence tail, removal of whole-audio buffering on supported browsers, bounded audio look-ahead, and the configured no-reasoning conversational route. The final spoken-delivery prompt was added after these live timings.

The hosted flow remains recording → transcription → chat/tools → speech. It is not full-duplex Realtime. Provider/network latency, transcription time, and required tool rounds remain. Real-device microphone timing and subjective voice quality still require a rehearsal on the user's browser.

Official references checked: [GPT-5.4 supported reasoning settings](https://developers.openai.com/api/docs/models/gpt-5.4), [OpenAI latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization).
