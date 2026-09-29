import { useCallback, useRef, useState } from 'react';

/**
 * Run an async action at most once at a time. Double clicks, rapid taps and
 * Enter-key repeats while it runs are ignored (the button also shows its
 * loading state). The server additionally de-duplicates money actions with an
 * idempotency key, so a slow network can never create two transactions.
 */
export function useSingleFlight() {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const run = useCallback(async (fn) => {
    if (busy.current) return undefined;
    busy.current = true;
    setPending(true);
    try {
      return await fn();
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, []);
  return [run, pending];
}
