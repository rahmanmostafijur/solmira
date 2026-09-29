import clsx from 'clsx';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { StatusBadge } from '@/components/ui/status-badge';
import { serverEnv } from '@/lib/server-env';
import { fetchServiceStatuses, type ServiceStatus } from '@/lib/service-status';
import { RefreshControl } from './refresh-control';

export const metadata: Metadata = { title: 'Service status' };

function Summary({ statuses }: { statuses: readonly ServiceStatus[] }) {
  const ready = statuses.filter((status) => status.state === 'ready').length;
  const allReady = ready === statuses.length;

  return (
    <div
      className={clsx(
        'mb-4 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm',
        allReady ? 'border-ok/20 bg-ok-soft text-ok' : 'border-warn/25 bg-warn-soft text-warn',
      )}
    >
      <span aria-hidden className="size-2 rounded-full bg-current" />
      <span className="font-medium">
        {allReady ? 'All systems operational' : 'Some services need attention'}
      </span>
      <span className="ml-auto text-ink-muted">
        {ready} of {statuses.length} services ready
      </span>
    </div>
  );
}

function Dependencies({ status }: { status: ServiceStatus }) {
  if (status.checks.length === 0) {
    return <span className="text-xs text-ink-muted">No response from service</span>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={`${status.name} dependencies`}>
      {status.checks.map((check) => (
        <li
          key={check.name}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-mono text-[11px]',
            check.status === 'ok'
              ? 'border-line text-ink-muted'
              : 'border-danger/30 bg-danger-soft text-danger',
          )}
        >
          {check.name}
          <span className="opacity-70">
            {check.status === 'ok' ? `${check.latencyMs}ms` : 'down'}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function ServiceStatusPage() {
  // Always probe at request time; a cached status page is worse than none.
  await connection();
  const statuses = await fetchServiceStatuses(serverEnv.GATEWAY_INTERNAL_URL);
  const checkedAt = new Date().toISOString();

  return (
    <div className="mx-auto max-w-5xl">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Service status</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Readiness of each backend service and the infrastructure it depends on, probed through
            the gateway.
          </p>
        </div>
        <RefreshControl checkedAt={checkedAt} />
      </header>

      <Summary statuses={statuses} />

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">Readiness of Solmira services</caption>
          <thead className="border-b border-line bg-canvas text-left text-[11px] tracking-wider text-ink-muted uppercase">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Service
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Status
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                Dependencies
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {statuses.map((status) => (
              <tr key={status.key}>
                <td className="px-4 py-3">
                  <div className="font-medium">{status.name}</div>
                  <div className="text-xs text-ink-muted">{status.description}</div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge state={status.state} />
                </td>
                <td className="px-4 py-3">
                  <Dependencies status={status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
