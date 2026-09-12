import type { VoiceEvent } from './realtime';

/** Audio-first: provider transcript deltas can lead playback by many seconds.
 * Reveal the completed spoken turn only after output playback has finished.
 * Interrupted, unspoken words must never become a completed chat bubble. */
export class SpokenTurnDelivery {
  private generation = -1;
  private started = false;
  private playback = false;
  private pending: VoiceEvent | null = null;
  constructor(private emit: (event: VoiceEvent) => void) {}
  playbackReady() { this.playback = true; this.flush(); }
  playbackBlocked() { this.playback = false; }
  accept(event: VoiceEvent) {
    if ((event.generation ?? this.generation) > this.generation || event.type === 'ended' || (event.type === 'status' && event.status === 'interrupted')) {
      this.generation = event.generation ?? this.generation;
      this.pending = null; this.started = false;
    }
    if (event.type === 'transcript' || event.type === 'card') return;
    if (event.type === 'status' && event.status === 'speaking') this.started = true;
    if (event.type === 'done') { this.pending = event; this.flush(); return; }
    this.emit(event);
  }
  private flush() {
    if (!this.playback || !this.started || !this.pending) return;
    const done = this.pending; this.pending = null; this.emit(done);
  }
}
