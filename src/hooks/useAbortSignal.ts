import { useEffect, useRef } from 'react';

/**
 * AbortSignal tied to the component's lifetime — the React equivalent of a
 * page-scoped CancellationToken. Pass it to every request the component makes
 * (`apiClient.get(url, { signal })`); when the user navigates to another page
 * or tab and the component unmounts, all in-flight requests are cancelled.
 *
 * The abort is deferred by one tick so React StrictMode's simulated
 * unmount/remount in development doesn't cancel requests that are still needed.
 */
export function useAbortSignal(): AbortSignal {
  const controllerRef = useRef<AbortController | null>(null);
  const abortTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!controllerRef.current) controllerRef.current = new AbortController();

  useEffect(() => {
    // StrictMode remount: cancel the abort scheduled by the simulated unmount.
    if (abortTimerRef.current) {
      clearTimeout(abortTimerRef.current);
      abortTimerRef.current = null;
    }
    const controller = controllerRef.current!;
    return () => {
      abortTimerRef.current = setTimeout(() => controller.abort(), 0);
    };
  }, []);

  return controllerRef.current.signal;
}
