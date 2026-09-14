/** One reusable audio owner. Blocked autoplay retains the clip for a user tap;
 * retrying playback never spends another speech request. No microphone access. */
export class VoiceAudioPlayer {
  private audio: HTMLAudioElement | null = null;
  private release: (() => void) | null = null;
  private retry: (() => void) | null = null;
  constructor(private onBlocked: () => void, private onPlaying: () => void) {}

  private element() { return this.audio ??= new Audio(); }

  /** Called directly from a click/submit, before an asynchronous model reply. */
  prepare() {
    if (this.release) return;
    const audio = this.element();
    // 10 ms of silent, unsigned 8-bit mono PCM. Unlock this same element.
    const wav = new Uint8Array(124), view = new DataView(wav.buffer);
    const write = (at: number, text: string) => [...text].forEach((c, i) => wav[at + i] = c.charCodeAt(0));
    write(0, 'RIFF'); view.setUint32(4, 116, true); write(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 8000, true); view.setUint32(28, 8000, true);
    view.setUint16(32, 1, true); view.setUint16(34, 8, true); write(36, 'data');
    view.setUint32(40, 80, true); wav.fill(128, 44);
    const silent = `data:audio/wav;base64,${btoa(String.fromCharCode(...wav))}`;
    audio.src = silent;
    void audio.play().then(() => { if (audio.src === silent && !this.release) audio.pause(); }).catch(() => {});
  }

  play(blob: Blob, signal: AbortSignal): Promise<void> {
    this.stop();
    if (signal.aborted) return Promise.resolve();
    if (!blob.size || !blob.type.startsWith('audio/')) return Promise.reject(new Error('invalid_audio'));
    return this.playSource(URL.createObjectURL(blob), signal);
  }

  /** Play MP3 bytes as they arrive. Unsupported browsers/formats keep the
   * existing Blob path, without a second synthesis request. */
  async playResponse(response: Response, signal: AbortSignal): Promise<void> {
    this.stop();
    if (signal.aborted) { await response.body?.cancel().catch(() => {}); return; }
    const mime = response.headers.get('content-type')?.split(';')[0].trim();
    if (mime !== 'audio/mpeg' || !response.body || typeof MediaSource === 'undefined' || !MediaSource.isTypeSupported(mime)) {
      return this.play(await response.blob(), signal);
    }
    const source = new MediaSource(), owner = new AbortController();
    const linked = AbortSignal.any([signal, owner.signal]);
    const reader = response.body.getReader();
    let open: (() => void) | undefined;
    const dispose = () => {
      owner.abort();
      if (open) source.removeEventListener('sourceopen', open);
      void reader.cancel().catch(() => {});
    };
    return this.playSource(URL.createObjectURL(source), signal, dispose, fail => {
      open = () => {
        void (async () => {
          const buffer = source.addSourceBuffer(mime);
          let bytes = 0;
          while (!linked.aborted) {
            const { value, done } = await reader.read();
            if (linked.aborted) return;
            if (done) {
              if (!bytes) throw new Error('invalid_audio');
              if (source.readyState === 'open') source.endOfStream();
              return;
            }
            if (!value.byteLength) continue;
            bytes += value.byteLength;
            await new Promise<void>((resolve, reject) => {
              const clear = () => { buffer.removeEventListener('updateend', end); buffer.removeEventListener('error', error); linked.removeEventListener('abort', abort); };
              const end = () => { clear(); resolve(); };
              const error = () => { clear(); reject(new Error('playback_failed')); };
              const abort = () => { clear(); reject(new Error('cancelled')); };
              buffer.addEventListener('updateend', end, { once: true });
              buffer.addEventListener('error', error, { once: true });
              linked.addEventListener('abort', abort, { once: true });
              try { buffer.appendBuffer(value); } catch { error(); }
            });
          }
        })().catch(() => { if (!linked.aborted) fail(new Error('playback_failed')); });
      };
      source.addEventListener('sourceopen', open, { once: true });
    });
  }

  private playSource(url: string, signal: AbortSignal, dispose: () => void = () => {}, setup?: (fail: (error: Error) => void) => void): Promise<void> {
    const audio = this.element();
    audio.src = url; audio.volume = 1; audio.muted = false;
    return new Promise((resolve, reject) => {
      let finished = false, timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error) => {
        if (finished) return; finished = true;
        clearTimeout(timer); signal.removeEventListener('abort', abort); dispose();
        audio.onended = null; audio.onerror = null; audio.pause(); audio.removeAttribute('src');
        URL.revokeObjectURL(url); this.release = null; this.retry = null;
        if (error) reject(error); else resolve();
      };
      const abort = () => finish();
      const attempt = () => {
        if (finished || signal.aborted) return;
        void audio.play().then(() => {
          if (finished) return; this.retry = null; this.onPlaying();
          clearTimeout(timer);
          timer = setTimeout(() => finish(new Error('playback_timeout')), 90000);
        }).catch(error => {
          if (finished) return;
          if (error?.name === 'NotAllowedError') { this.retry = attempt; this.onBlocked(); }
          else finish(new Error('playback_failed'));
        });
      };
      this.release = () => finish(); audio.onended = () => finish();
      audio.onerror = () => finish(new Error('playback_failed'));
      signal.addEventListener('abort', abort, {once: true});
      timer = setTimeout(() => finish(new Error('playback_timeout')), 90000);
      setup?.(finish); attempt();
    });
  }

  resume() { this.retry?.(); }
  stop() { this.release?.(); this.retry = null; this.audio?.pause(); }
}
