/**
 * Screens hold the messages with `useToasts` (src/hooks/useToasts.ts).
 */
import React from 'react';
import './Toast.css';
import type { Toast } from '@/hooks/useToasts';

export interface ToastStackProps {
  toasts: Toast[];
}

const ToastStack: React.FC<ToastStackProps> = ({ toasts }) => {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.color.toLowerCase()}`}>{toast.text}</div>
      ))}
    </div>
  );
};

export default ToastStack;
