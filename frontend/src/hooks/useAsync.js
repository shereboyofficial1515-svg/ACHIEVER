import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Minimal data-fetching hook: loading / error / data with reload and abort on
 * unmount. Financial screens always reload from the server after mutations
 * rather than updating optimistically.
 */
export function useAsync(fn, deps = [], { immediate = true } = {}) {
  const [state, setState] = useState({ data: undefined, meta: undefined, error: null, loading: immediate });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const mounted = useRef(true);
  const seq = useRef(0);

  const run = useCallback(async (...args) => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const result = await fnRef.current(...args);
      if (mounted.current && id === seq.current) {
        const isEnvelope = result && typeof result === 'object' && 'data' in result;
        setState({ data: isEnvelope ? result.data : result, meta: result?.meta, error: null, loading: false });
      }
      return result;
    } catch (error) {
      if (mounted.current && id === seq.current) setState((s) => ({ ...s, error, loading: false }));
      return undefined;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (immediate) run();
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, reload: run, setData: (data) => setState((s) => ({ ...s, data })) };
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
