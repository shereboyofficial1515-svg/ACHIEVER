import { useEffect } from 'react';
import { setSecureScreen } from '../platform/index.js';

/**
 * While a screen shows sensitive data (payment approval, tokens, PINs), hide it
 * from screenshots and the Android recent-apps preview. No effect on the web.
 */
export function useSecureScreen(active = true) {
  useEffect(() => {
    if (!active) return undefined;
    setSecureScreen(true);
    return () => { setSecureScreen(false); };
  }, [active]);
}
