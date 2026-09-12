/** USD estimates, verified 2026-09-05 against official model pricing.
 * These are not invoices. Unknown models or incomplete usage retain reservations.
 * https://developers.openai.com/api/docs/models/gpt-5.4
 * https://developers.openai.com/api/docs/models/gpt-realtime-2.1
 */
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function textCost(model: string, usage: unknown): number | undefined {
  if (model !== 'gpt-5.4') return undefined;
  const u = record(usage), input = u.prompt_tokens, output = u.completion_tokens;
  const cached = record(u.prompt_tokens_details).cached_tokens ?? 0;
  if (!count(input) || !count(output) || !count(cached) || cached > input || input > 272000) return undefined;
  return ((input - cached) * 2.5 + cached * .25 + output * 15) / 1e6;
}

export function realtimeCost(model: string, usage: unknown): number | undefined {
  if (model !== 'gpt-realtime-2.1') return undefined;
  const u = record(usage), i = record(u.input_token_details), o = record(u.output_token_details);
  const input = u.input_tokens, output = u.output_tokens;
  const text = i.text_tokens, audio = i.audio_tokens, images = i.image_tokens ?? 0;
  const outText = o.text_tokens, outAudio = o.audio_tokens;
  if (!count(input) || !count(output) || !count(text) || !count(audio) || !count(images) ||
      !count(outText) || !count(outAudio) || input !== text + audio + images || outText + outAudio > output) return undefined;
  const cached = i.cached_tokens ?? 0, details = record(i.cached_tokens_details);
  if (!count(cached) || cached > input) return undefined;
  // Without modality-specific cache details, conservatively charge uncached rates.
  const ct = details.text_tokens ?? 0, ca = details.audio_tokens ?? 0, ci = details.image_tokens ?? 0;
  if (!count(ct) || !count(ca) || !count(ci) || ct > text || ca > audio || ci > images || ct + ca + ci > cached) return undefined;
  // Output totals include reasoning; any non-audio remainder is priced as text.
  return ((text - ct) * 4 + (audio - ca) * 32 + (images - ci) * 5 +
    (ct + ca) * .4 + ci * .5 + (output - outAudio) * 24 + outAudio * 64) / 1e6;
}
