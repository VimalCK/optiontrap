import { useEffect, useRef } from 'react';

/**
 * Aborts on unmount. The abort waits one tick so React StrictMode's simulated
 * unmount doesn't cancel requests that are still needed.
 */
export function useAbortSignal(): AbortSignal {
  const controllerRef = useRef<AbortController | null>(null);
  const abortTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!controllerRef.current) controllerRef.current = new AbortController();

  useEffect(() => {
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
