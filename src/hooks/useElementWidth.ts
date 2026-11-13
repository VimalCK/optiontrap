import { useCallback, useRef, useState } from 'react';

/**
 * An element's content width, kept current as it resizes. Returns a callback ref, so it also follows an element
 * that mounts and unmounts (e.g. with a loading state).
 */
export function useElementWidth(): [number, (el: HTMLElement | null) => void] {
  const [width, setWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    observerRef.current = observer;
  }, []);
  return [width, ref];
}
