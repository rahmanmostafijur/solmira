'use client';

import clsx from 'clsx';
import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type ToastTone = 'success' | 'error' | 'info';
interface Toast {
  readonly id: number;
  readonly tone: ToastTone;
  readonly message: string;
}

const ToastContext = createContext<((message: string, tone?: ToastTone) => void) | null>(null);
const DISMISS_AFTER_MS = 5_000;
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);

  const dismiss = useCallback(
    (id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)),
    [],
  );

  const notify = useCallback(
    (message: string, tone: ToastTone = 'success') => {
      const id = nextId++;
      setToasts((current) => [...current, { id, tone, message }]);
      setTimeout(() => dismiss(id), DISMISS_AFTER_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={useMemo(() => notify, [notify])}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={clsx(
              'pointer-events-auto flex items-start gap-3 rounded-lg border bg-surface px-4 py-3 text-sm shadow-lg',
              toast.tone === 'error'
                ? 'border-danger/30'
                : toast.tone === 'success'
                  ? 'border-ok/30'
                  : 'border-line',
            )}
          >
            <span
              aria-hidden
              className={clsx(
                'mt-1.5 size-2 shrink-0 rounded-full',
                toast.tone === 'error'
                  ? 'bg-danger'
                  : toast.tone === 'success'
                    ? 'bg-ok'
                    : 'bg-accent',
              )}
            />
            <p className="flex-1">{toast.message}</p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(toast.id)}
              className="text-ink-muted hover:text-ink"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const notify = useContext(ToastContext);
  if (!notify) throw new Error('useToast must be used inside <ToastProvider>');
  return notify;
}
