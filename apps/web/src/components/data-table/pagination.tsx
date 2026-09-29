'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const PAGE_SIZES = [10, 25, 50, 100] as const;

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export function describeRange(page: number, pageSize: number, total: number): string {
  if (total === 0) return 'No results';
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return `${first}–${last} of ${total}`;
}

export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm"
    >
      <p className="text-ink-muted" aria-live="polite">
        {describeRange(page, pageSize, total)}
      </p>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-ink-muted">
          Rows per page
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="rounded-md border border-line bg-surface px-2 py-1 text-ink"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
          <span className="px-2 text-ink-muted">
            Page {Math.min(page, Math.max(totalPages, 1))} of {Math.max(totalPages, 1)}
          </span>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Next page"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight aria-hidden className="size-4" />
          </Button>
        </div>
      </div>
    </nav>
  );
}
