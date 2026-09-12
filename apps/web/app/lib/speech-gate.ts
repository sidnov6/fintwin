/** Cheap local gate: never pay to transcribe silence or a single click. */
export class SpeechGate {
  private voicedMs = 0;
  private lastSample: number | null = null;
  sample(rms: number, now: number) {
    const elapsed = this.lastSample === null ? 0 : Math.max(0, Math.min(100, now - this.lastSample));
    this.lastSample = now;
    if (rms > .022) this.voicedMs += elapsed;
  }
  get hasSpeech() { return this.voicedMs >= 400; }
}
