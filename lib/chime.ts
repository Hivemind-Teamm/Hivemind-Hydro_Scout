/**
 * Synthesised hazard notification chime using Web Audio API.
 * No audio files required — generates a two-tone descending bell in-browser.
 */
let context: AudioContext | null = null;
function audioContext() {
  if (!context || context.state === 'closed') context = new AudioContext();
  return context;
}

/** Called by trusted page gestures to allow later live-map notification audio. */
export function prepareNotificationAudio() {
  if (typeof window === 'undefined') return;
  try { void audioContext().resume().catch(() => {}); } catch { /* Audio unavailable. */ }
}

export function playHazardChime() {
  if (typeof window === 'undefined') return;
  try {
    const ctx = audioContext();
    if (ctx.state !== 'running') {
      const requested = Date.now();
      void ctx.resume().then(() => {
        // Never queue old fire alerts for replay after a much later gesture.
        if (ctx.state === 'running' && Date.now() - requested < 1000) playHazardChime();
      }).catch(() => {});
      return;
    }
    const now = ctx.currentTime;

    // Descending two-tone chime: A5 → E5
    const tones = [880, 660];
    tones.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.value = freq;

      const t = now + i * 0.22;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.28, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);

      osc.start(t);
      osc.stop(t + 0.55);
    });

  } catch {
    // AudioContext blocked (e.g. no user gesture yet) — fail silently
  }
}
