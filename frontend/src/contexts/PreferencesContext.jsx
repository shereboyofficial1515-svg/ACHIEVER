import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api.js';
import { useAuth } from './AuthContext.jsx';

/**
 * User settings that change how the app looks and behaves. Accessibility
 * settings are applied to <html> as data attributes (see styles/a11y.css) and
 * also cached locally so they apply before sign-in and without a flash.
 */
export const DEFAULTS = {
  accessibility: { fontScale: 1, reducedMotion: 'system', highContrast: false, largerTargets: false, underlineLinks: false, strongFocus: false },
  messages: { messageSound: true, callRingtone: true, messagePreview: true, autoLoadImages: true, readReceipts: true },
  privacy: { showOnlineStatus: true },
  security: { loginAlerts: 'new_device' },
};
const STORAGE_KEY = 'achiever.a11y';

function readLocal() {
  try {
    return { ...DEFAULTS.accessibility, ...(JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}) };
  } catch {
    return DEFAULTS.accessibility;
  }
}

/** Apply accessibility settings to the document (also used before React renders). */
export function applyAccessibility(a) {
  const root = document.documentElement;
  root.style.fontSize = `${Math.round((a.fontScale || 1) * 100)}%`;
  root.dataset.motion = a.reducedMotion || 'system';
  root.dataset.contrast = a.highContrast ? 'high' : 'normal';
  root.dataset.targets = a.largerTargets ? 'large' : 'normal';
  root.dataset.links = a.underlineLinks ? 'underline' : 'normal';
  root.dataset.focus = a.strongFocus ? 'strong' : 'normal';
}

/** True when animations should be skipped (user setting, else the OS preference). */
export function prefersReducedMotion() {
  const setting = document.documentElement.dataset.motion;
  if (setting === 'reduce') return true;
  if (setting === 'full') return false;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const PreferencesContext = createContext(null);

export function PreferencesProvider({ children }) {
  const { user, status } = useAuth();
  const [prefs, setPrefs] = useState(() => ({ ...DEFAULTS, accessibility: readLocal() }));

  // Server settings win once signed in.
  useEffect(() => {
    if (status === 'authenticated' && user?.preferences) {
      setPrefs((p) => ({ ...p, ...user.preferences }));
    }
  }, [status, user?.preferences]);

  useEffect(() => {
    applyAccessibility(prefs.accessibility);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs.accessibility));
    } catch {
      /* private mode: settings still apply for this visit */
    }
  }, [prefs.accessibility]);

  // Saves are sent one at a time, and only the newest response is applied, so
  // quick successive changes never overwrite each other.
  const queue = useRef(Promise.resolve());
  const latest = useRef(0);

  /** Update one section (applied immediately); saved to the server when signed in. */
  const update = useCallback((section, patch) => {
    setPrefs((p) => ({ ...p, [section]: { ...p[section], ...patch } }));
    if (status !== 'authenticated') return Promise.resolve(null);
    const ticket = ++latest.current;
    const run = queue.current.catch(() => {}).then(async () => {
      const { data } = await api.put('/profiles/me/preferences', { [section]: patch });
      if (ticket === latest.current) setPrefs((p) => ({ ...p, ...data }));
      return data;
    });
    queue.current = run;
    return run;
  }, [status]);

  const value = useMemo(() => ({ prefs, update }), [prefs, update]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  return useContext(PreferencesContext) || { prefs: DEFAULTS, update: async () => null };
}
