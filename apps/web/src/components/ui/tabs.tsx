'use client';

import clsx from 'clsx';
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem<T extends string> {
  readonly id: T;
  readonly label: string;
  readonly count?: number;
}

interface TabsProps<T extends string> {
  label: string;
  tabs: readonly TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  children: ReactNode;
}

/**
 * WAI-ARIA tabs: one tab stop for the list, arrow keys move between tabs, Home/End jump to the
 * ends. Only the active panel is rendered, so inactive tabs do not fetch their data.
 */
export function Tabs<T extends string>({ label, tabs, active, onChange, children }: TabsProps<T>) {
  const baseId = useId();
  const refs = useRef(new Map<T, HTMLButtonElement>());

  const focusTab = (index: number) => {
    const tab = tabs[(index + tabs.length) % tabs.length];
    if (!tab) return;
    onChange(tab.id);
    refs.current.get(tab.id)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    focusTab(target);
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        className="mb-5 flex gap-1 overflow-x-auto border-b border-line"
      >
        {tabs.map((tab, index) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                if (node) refs.current.set(tab.id, node);
                else refs.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={clsx(
                '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap',
                selected
                  ? 'border-accent font-medium text-accent'
                  : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span className="rounded-full bg-canvas px-1.5 text-xs text-ink-muted">
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${active}`}>
        {children}
      </div>
    </div>
  );
}
