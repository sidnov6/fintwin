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
    const audio = this.element(), url = URL.createObjectURL(blob);
    audio.src = url; audio.volume = 1; audio.muted = false;
    return new Promise((resolve, reject) => {
      let finished = false, timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error) => {
        if (finished) return; finished = true;
        clearTimeout(timer); signal.removeEventListener('abort', abort);
        audio.onended = null; audio.onerror = null; audio.pause(); audio.removeAttribute('src');
        URL.revokeObjectURL(url); this.release = null; this.retry = null;
        if (error) reject(error); else resolve();
      };
      const abort = () => finish();
      const attempt = () => {
        if (finished || signal.aborted) return;
        void audio.play().then(() => {
          if (finished) return; this.retry = null; this.onPlaying();
          timer = setTimeout(() => finish(new Error('playback_timeout')), 90000);
        }).catch(error => {
          if (finished) return;
          if (error?.name === 'NotAllowedError') { this.retry = attempt; this.onBlocked(); }
          else finish(new Error('playback_failed'));
        });
      };
      this.release = () => finish(); audio.onended = () => finish();
      audio.onerror = () => finish(new Error('playback_failed'));
      signal.addEventListener('abort', abort, {once: true}); attempt();
    });
  }

  resume() { this.retry?.(); }
  stop() { this.release?.(); this.retry = null; this.audio?.pause(); }
}
