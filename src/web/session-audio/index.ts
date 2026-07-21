/** Small, non-blocking audio cue for session transitions. */
export class SessionAudioNotifier {
  private context: AudioContext | null = null;

  async unlock(): Promise<void> {
    const context = this.getContext();
    if (!context) return;
    try {
      if (context.state === "suspended") await context.resume();
    } catch {
      // Audio is optional. A browser policy or missing audio device should
      // never interrupt the posture session.
    }
  }

  notifyReturnToNormal(): void {
    const context = this.getContext();
    if (!context) return;

    const play = () => {
      if (!this.context || this.context.state !== "running") return;
      const start = this.context.currentTime + 0.005;
      this.playTone(660, start, 0.12);
      this.playTone(880, start + 0.14, 0.16);
    };

    // The session start already unlocks the context from a user gesture.
    // Avoid awaiting resume here so the cue stays aligned with the text
    // transition at scenario end.
    if (context.state === "running") {
      play();
    } else {
      void this.unlock().then(play);
    }
  }

  private getContext(): AudioContext | null {
    if (this.context) return this.context;

    const windowWithWebkitAudio = window as Window & {
      webkitAudioContext?: typeof AudioContext;
    };
    const AudioContextConstructor =
      window.AudioContext ?? windowWithWebkitAudio.webkitAudioContext;
    if (!AudioContextConstructor) return null;

    try {
      this.context = new AudioContextConstructor();
      return this.context;
    } catch {
      return null;
    }
  }

  private playTone(frequency: number, start: number, duration: number): void {
    if (!this.context) return;

    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }
}
