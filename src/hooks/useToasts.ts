/** Messages for a screen's ToastStack (src/components/Toast/); each disappears after TOAST_DURATION_MS. */
import { useCallback, useRef, useState } from 'react';
import type { ToastColorId } from '@/utils/uiEnums';

const TOAST_DURATION_MS = 2000;

export interface Toast {
  id: number;
  text: string;
  color: ToastColorId;
}

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
