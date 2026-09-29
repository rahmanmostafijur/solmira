'use client';

import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const DEBOUNCE_MS = 300;

/**
 * Search box that commits after the user pauses typing, so each keystroke does not become a
 * request (and a history entry). An outside change, such as "Clear filters", resets it.
 */
export function SearchInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);

  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setDraft(value);
    }
  }, [value]);

  useEffect(() => {
    if (draft === committed.current) return;
    const timer = setTimeout(() => {
      committed.current = draft;
      onChange(draft.trim());
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, onChange]);

  return (
    <div className="relative w-full max-w-xs">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted"
      />
      <input
        type="search"
        aria-label={label}
        placeholder={label}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="w-full rounded-md border border-line bg-surface py-1.5 pr-3 pl-8 text-sm placeholder:text-ink-muted/70"
      />
    </div>
  );
}
