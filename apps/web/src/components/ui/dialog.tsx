'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  size?: 'md' | 'lg';
}

/**
 * Modal built on the native <dialog> (like ConfirmDialog): showModal() provides the focus trap,
 * Escape handling and an inert page behind it. Content mounts only while open, so each opening
 * starts with a fresh form.
 */
export function Dialog({ open, title, description, onClose, children, size = 'md' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className={`m-auto w-full ${size === 'lg' ? 'max-w-2xl' : 'max-w-lg'} rounded-lg border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40`}
    >
      {open && (
        <>
          <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
            <div>
              <h2 id={titleId} className="font-semibold">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="text-ink-muted hover:text-ink"
            >
              <X aria-hidden className="size-4" />
            </button>
          </header>
          <div className="max-h-[75dvh] overflow-y-auto px-6 py-5">{children}</div>
        </>
      )}
    </dialog>
  );
}
