/** One clip playing and at most one being prepared. No speculative requests for
 * the whole answer, no out-of-order playback, and cancellation owns both jobs. */
export async function playSpeechQueue<T>(
  chunks: string[], signal: AbortSignal,
  synthesize: (text: string, signal: AbortSignal) => Promise<T>,
  play: (clip: T, signal: AbortSignal) => Promise<void>,
): Promise<void> {
  if (signal.aborted || !chunks.length) return;
  const owner = new AbortController();
  const linked = AbortSignal.any([signal, owner.signal]);
  // Handle prefetch failures immediately; surface them in playback order.
  const load = (text: string) => Promise.resolve().then(() => {
    linked.throwIfAborted();
    return synthesize(text, linked);
  }).then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
  let ready = load(chunks[0]);
  try {
    for (let index = 0; index < chunks.length; index++) {
      const current = await ready;
      if (linked.aborted) return;
      if (!current.ok) throw current.error;
      if (index + 1 < chunks.length) ready = load(chunks[index + 1]);
      await play(current.value, linked);
      if (linked.aborted) return;
    }
  } finally { owner.abort(); }
}
