/** Short, quiet two-note chime for new messages (Web Audio; no files to load). */
let ctx = null;
export function playMessageSound() {
  try {
    if (typeof window.AudioContext === 'undefined') return;
    ctx = ctx || new AudioContext();
    if (ctx.state === 'suspended') return; // browsers only allow sound after user interaction
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + i * 0.09;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    });
  } catch {
    /* sound is optional */
  }
}
