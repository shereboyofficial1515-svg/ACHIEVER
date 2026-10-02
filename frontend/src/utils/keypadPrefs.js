/**
 * Secure keypad preferences for this device (not account data): key-press
 * vibration on Android and a shuffled PIN layout. Storage may be unavailable
 * (private mode); defaults then apply.
 */
const KEY = 'achiever.keypad';
const DEFAULTS = { haptics: true, shuffle: false };

export function keypadPrefs() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setKeypadPrefs(patch) {
  const next = { ...keypadPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify({ haptics: Boolean(next.haptics), shuffle: Boolean(next.shuffle) }));
  } catch { /* storage unavailable: keep defaults */ }
  return next;
}
