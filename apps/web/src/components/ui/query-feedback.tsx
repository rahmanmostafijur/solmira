'use client';

import { describeError } from '@/lib/api/client';
import { isReconnecting, type RetryingQuery } from '@/lib/api/retry-policy';
import { Button } from './button';
import { Alert, LoadingRows } from './feedback';

/**
 * What a list or page shows before its query has data. While the query is waiting out a service
 * restart it says so calmly instead of showing a bare skeleton or, worse, an error.
 */
export function QueryLoading({
  query,
  rows,
  label = 'Loading',
}: {
  query: RetryingQuery;
  rows?: number;
  label?: string;
}) {
  if (!isReconnecting(query)) return <LoadingRows rows={rows} label={label} />;
  return (
    <div className="p-4">
      <Alert tone="info" title="Reconnecting…">
        A Solmira service is restarting. This loads as soon as it is back.
      </Alert>
    </div>
  );
}

/** A query that failed for good (retries are over), with a way to try again. */
export function QueryError({
  query,
}: {
  query: {
    readonly error: unknown;
    readonly refetch: () => unknown;
    readonly isFetching?: boolean;
  };
}) {
  return (
    <Alert tone="error">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>{describeError(query.error)}</span>
        <Button
          variant="secondary"
          size="sm"
          loading={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Retry
        </Button>
      </div>
    </Alert>
  );
}
