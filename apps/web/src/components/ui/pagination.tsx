import type { Page } from '@solmira/contracts';
import { Button } from './button';

/** Previous and next for an offset-paginated list; hidden when everything fits on one page. */
export function Pagination({
  page,
  onChange,
}: {
  page: Pick<Page<unknown>, 'page' | 'totalPages' | 'total'>;
  onChange: (page: number) => void;
}) {
  if (page.totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between px-4 py-3 text-sm">
      <p className="text-ink-muted">
        Page {page.page} of {page.totalPages} ({page.total} in total)
      </p>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={page.page <= 1}
          onClick={() => onChange(page.page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={page.page >= page.totalPages}
          onClick={() => onChange(page.page + 1)}
        >
          Next
        </Button>
      </div>
    </nav>
  );
}
