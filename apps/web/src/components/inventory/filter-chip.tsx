import { X } from 'lucide-react';

/** A filter that arrived with the link (e.g. one variant), shown so it can be seen and cleared. */
export function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft py-0.5 pr-1 pl-2.5 text-xs font-medium text-accent ring-1 ring-accent/20 ring-inset">
      {label}
      <button
        type="button"
        aria-label={`Clear filter: ${label}`}
        onClick={onClear}
        className="rounded-full p-0.5 hover:bg-accent/10"
      >
        <X aria-hidden className="size-3" />
      </button>
    </span>
  );
}
