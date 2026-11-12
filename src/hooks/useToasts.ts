/**
 * useToasts — the messages a screen shows in its ToastStack
 * (src/components/Toast/): `showToast(text, color)` adds one, and it disappears
 * after TOAST_DURATION_MS.
 */
import { useCallback, useRef, useState } from 'react';
import type { ToastColorId } from '@/utils/uiEnums';

/** How long a toast stays on screen. */
const TOAST_DURATION_MS = 2000;

export interface Toast {
  id: number;
  text: string;
  color: ToastColorId;
}

/** The screen's current toasts, and the function that shows a new one. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const showToast = useCallback((text: string, color: ToastColorId) => {
    const id = ++nextId.current;
    setToasts((prev) => [...prev, { id, text, color }]);
    setTimeout(() => setToasts((prev) => prev.filter((toast) => toast.id !== id)), TOAST_DURATION_MS);
  }, []);

  return { toasts, showToast };
}
