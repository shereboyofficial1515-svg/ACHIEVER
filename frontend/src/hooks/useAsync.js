import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Screen data that was already loaded in this session, for instant back-navigation
 * (stale-while-revalidate). Memory only — never written to storage — and cleared when the
 * signed-in user changes or signs out, so one account can never see another's data.
 */
const cache = new Map();   // key -> { data, meta, at }
const MAX_ENTRIES = 60;
export function clearAsyncCache() {
  cache.clear();
}

/**
 * Minimal data-fetching hook: loading / error / data with reload and abort on unmount.
 *
 * Options:
 *   cacheKey  – show the last result for this key immediately and refresh in the background
 *               (`refreshing` is true meanwhile). Use only for read-only summaries — never for
 *               balances that must be exact before acting (the wallet uses its own endpoint).
 * Financial screens always reload from the server after mutations rather than updating
 * optimistically.
 */
export function useAsync(fn, deps = [], { immediate = true, cacheKey } = {}) {
  const cached = cacheKey ? cache.get(cacheKey) : undefined;
  const [state, setState] = useState(() => ({
    data: cached?.data, meta: cached?.meta, error: null, loading: immediate && !cached, refreshing: immediate && Boolean(cached),
  }));
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const keyRef = useRef(cacheKey);
  keyRef.current = cacheKey;
  const mounted = useRef(true);
  const seq = useRef(0);

  const run = useCallback(async (...args) => {
    const id = ++seq.current;
    setState((s) => (s.data !== undefined && keyRef.current ? { ...s, refreshing: true, error: null } : { ...s, loading: true, error: null }));
    try {
      const result = await fnRef.current(...args);
      if (mounted.current && id === seq.current) {
        const isEnvelope = result && typeof result === 'object' && 'data' in result;
        const data = isEnvelope ? result.data : result;
        setState({ data, meta: result?.meta, error: null, loading: false, refreshing: false });
        if (keyRef.current) {
          cache.delete(keyRef.current);
          cache.set(keyRef.current, { data, meta: result?.meta, at: Date.now() });
          if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
        }
      }
      return result;
    } catch (error) {
      if (mounted.current && id === seq.current) setState((s) => ({ ...s, error, loading: false, refreshing: false }));
      return undefined;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (cacheKey) {
      const hit = cache.get(cacheKey);
      if (hit) setState((s) => (s.data === hit.data ? s : { ...s, data: hit.data, meta: hit.meta, loading: false }));
    }
    if (immediate) run();
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  /**
   * Background refresh (pull-to-refresh): keeps the current screen while it
   * loads, and on failure keeps the data already shown and rethrows so the
   * caller can say "Couldn't refresh" instead of replacing the screen.
   */
  const refresh = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, refreshing: true }));
    try {
      const result = await fnRef.current();
      if (mounted.current && id === seq.current) {
        const isEnvelope = result && typeof result === 'object' && 'data' in result;
        const data = isEnvelope ? result.data : result;
        setState({ data, meta: result?.meta, error: null, loading: false, refreshing: false });
        if (keyRef.current) {
          cache.delete(keyRef.current);
          cache.set(keyRef.current, { data, meta: result?.meta, at: Date.now() });
        }
      }
      return result;
    } catch (error) {
      if (mounted.current && id === seq.current) setState((s) => (s.data === undefined ? { ...s, error, loading: false, refreshing: false } : { ...s, refreshing: false }));
      throw error;
    }
  }, []);

  const setData = useCallback((data) => setState((s) => {
    const next = typeof data === 'function' ? data(s.data) : data;
    if (keyRef.current && cache.has(keyRef.current)) cache.set(keyRef.current, { ...cache.get(keyRef.current), data: next });
    return { ...s, data: next };
  }), []);

  return { ...state, reload: run, refresh, setData };
}

/** Wrap a mutation with pending state and error capture. */
export function useAction(fn) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const run = useCallback(
    async (...args) => {
      setPending(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (err) {
        setError(err);
        throw err;
      } finally {
        setPending(false);
      }
    },
    [fn],
  );
  return { run, pending, error, setError };
}
