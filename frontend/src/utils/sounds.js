/**
 * Message sounds: short, quiet tones made with Web Audio, so there is nothing to download
 * and nothing to wait for when a message arrives. One shared AudioContext for the whole app
 * (no leaks); it is unlocked on the first tap because browsers block sound until then.
 *
 *   incoming: a soft two-note chime (rising)
 *   outgoing: a single short "tick" (sent)
 *   notification: a gentle single note
 */
let ctx = null;
let unlocked = false;

function context() {
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return null;
  ctx = ctx || new window.AudioContext();
  return ctx;
}

/** Call once at start-up: the first tap or key press allows sound for the rest of the session. */
export function unlockSoundsOnFirstGesture() {
  if (unlocked || typeof window === 'undefined') return;
  const unlock = () => {
    unlocked = true;
    const c = context();
    if (c?.state === 'suspended') c.resume().catch(() => {});
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

const TONES = {
  incoming: [{ f: 784, at: 0, len: 0.16, vol: 0.06 }, { f: 1046, at: 0.09, len: 0.2, vol: 0.05 }],
  outgoing: [{ f: 1318, at: 0, len: 0.07, vol: 0.035 }],
  notification: [{ f: 880, at: 0, len: 0.22, vol: 0.05 }],
};

function play(kind) {
  try {
    const c = context();
    if (!c || c.state === 'suspended') return;
    for (const t of TONES[kind]) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      const start = c.currentTime + t.at;
      osc.type = 'sine';
      osc.frequency.value = t.f;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(t.vol, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + t.len);
      osc.connect(gain).connect(c.destination);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); };
      osc.start(start);
      osc.stop(start + t.len + 0.02);
    }
  } catch {
    /* sound is optional */
  }
}

/**
 * Should this sound play under the user's settings?
 * messageSound is the master switch; sleep mode silences chat and non-critical sounds.
 */
export function soundAllowed(kind, m = {}) {
  if (m.sleepMode) return false;
  if (kind === 'notification') return m.notificationSound !== false;
  if (m.messageSound === false) return false;
  if (kind === 'incoming') return m.incomingSound !== false;
  if (kind === 'outgoing') return m.outgoingSound !== false;
  return false;
}

export function playSound(kind, messagePrefs) {
  if (soundAllowed(kind, messagePrefs)) play(kind);
}
