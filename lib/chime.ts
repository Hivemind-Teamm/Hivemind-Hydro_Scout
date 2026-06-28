/**
 * Synthesised hazard notification chime using Web Audio API.
 * No audio files required — generates a two-tone descending bell in-browser.
 */
export function playHazardChime() {
  if (typeof window === 'undefined') return;
  try {
    const ctx = new AudioContext();
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

    setTimeout(() => ctx.close(), 1600);
  } catch {
    // AudioContext blocked (e.g. no user gesture yet) — fail silently
  }
}
