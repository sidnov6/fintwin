import type { Env } from './db';
import type { ChatProvider } from './providers';
import { TOOL_DEFS } from './tools';
import { apiFetch } from './groq';
import { reserve, settle } from './budget';
import { textCost } from './pricing';
import { AppError } from './errors';

interface OutputItem {
  type: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: Array<{ type: string; text?: string; refusal?: string }>;
}
interface ProviderResponse {
  status?: string;
  output?: OutputItem[];
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number; input_tokens_details?: { cached_tokens: number } };
}

/** GPT-5.4 reasoning + function tools require Responses, not Chat Completions.
 * Keep encrypted reasoning only in this turn's memory, never in browser events,
 * logs or the household database. Replay full output items for subsequent tools.
 * https://developers.openai.com/api/docs/guides/migrate-to-responses */
export async function responsesRound(env: Env, provider: ChatProvider, input: unknown[], onDelta: (text: string) => void, signal?: AbortSignal, userId?: string) {
  const reservation = userId ? await reserve(env, userId, 'chat', provider.id, .50) : null;
  let completed: ProviderResponse | undefined;
  let usage: ProviderResponse['usage'];
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let pending = '';
  const visible = (delta: string) => {
    pending += delta;
    const marker = pending.search(/\n?\s*(?:SUGGESTIONS?|ASK)\s*:/i);
    if (marker >= 0) { if (marker) onDelta(pending.slice(0, marker)); pending = pending.slice(marker); return; }
    if (pending.length > 16) { onDelta(pending.slice(0, -16)); pending = pending.slice(-16); }
  };
  try {
    const response = await apiFetch(`${provider.baseUrl}/responses`, provider.apiKey, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal,
      body: JSON.stringify({ model: provider.model, input, stream: true, store: false,
        reasoning: { effort: provider.reasoningEffort || 'low' }, max_output_tokens: provider.maxTokens,
        ...(provider.verbosity ? { text: { verbosity: provider.verbosity } } : {}),
        tools: TOOL_DEFS.map(tool => ({ type: 'function', ...tool.function, strict: false })), tool_choice: 'auto' }),
    });
    reader = response.body?.getReader();
    if (!reader) throw new AppError('provider_stream_incomplete', 502);
    const decoder = new TextDecoder();
    let buffer = '';
    const consume = (line: string) => {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      const event = JSON.parse(data) as { type: string; delta?: string; response?: ProviderResponse };
      if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') visible(event.delta || '');
      if (event.response?.usage) usage = event.response.usage;
      if (event.type === 'response.completed') completed = event.response;
      if (['error', 'response.failed', 'response.incomplete'].includes(event.type)) throw new AppError('provider_response_failed', 502);
    };
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const line of lines) consume(line.trim());
      if (done) { if (buffer.trim()) consume(buffer.trim()); break; }
    }
    if (completed?.status !== 'completed' || !Array.isArray(completed.output)) throw new AppError('provider_stream_incomplete', 502);
    const toolCalls = completed.output.filter(item => item.type === 'function_call').map(item => {
      if (!item.call_id || !item.name || typeof item.arguments !== 'string') throw new AppError('provider_response_failed', 502);
      return { id: item.call_id, name: item.name, arguments: item.arguments };
    });
    const text = completed.output.filter(item => item.type === 'message').flatMap(item => item.content || [])
      .map(part => part.type === 'output_text' ? part.text || '' : part.type === 'refusal' ? part.refusal || '' : '').join('');
    if (pending && !/(?:SUGGESTIONS?|ASK)\s*:/i.test(pending)) onDelta(pending);
    return { text, toolCalls, finish: toolCalls.length ? 'tool_calls' : 'stop', responseOutput: completed.output };
  } finally {
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
    const normalized = usage ? { prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens,
      total_tokens: usage.total_tokens, prompt_tokens_details: usage.input_tokens_details } : null;
    if (reservation) await settle(env, reservation, usage ? { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, total_tokens: usage.total_tokens } : null, textCost(provider.model, normalized));
  }
}
