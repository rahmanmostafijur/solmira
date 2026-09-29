'use client';

import clsx from 'clsx';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

interface DropdownMenuProps {
  /** Accessible label and content of the trigger button. */
  label: string;
  trigger: ReactNode;
  align?: 'left' | 'right';
  /** Non-interactive content above the items. Kept outside role="menu", which exposes only items. */
  header?: ReactNode;
  children: (close: () => void) => ReactNode;
}

/** Minimal accessible menu: Escape and outside clicks close it, focus returns to the trigger. */
export function DropdownMenu({
  label,
  trigger,
  align = 'right',
  header,
  children,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-canvas"
      >
        {trigger}
      </button>
      {open && (
        <div
          className={clsx(
            'absolute top-full z-40 mt-1 min-w-56 rounded-lg border border-line bg-surface py-1 shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {header}
          <div id={menuId} role="menu" aria-label={label}>
            {children(() => setOpen(false))}
          </div>
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  onSelect,
  children,
  disabled,
}: {
  onSelect: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-canvas disabled:cursor-default disabled:opacity-60"
    >
      {children}
    </button>
  );
}
