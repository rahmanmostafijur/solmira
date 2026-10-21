'use client';

import type { DeliveryStats } from '@solmira/contracts';
import Link from 'next/link';
import { Alert, EmptyState, LoadingRows, Panel } from '@/components/ui/feedback';
import { TBody, Table, THead, Td, Th, Tr } from '@/components/ui/table';
import { describeError } from '@/lib/api/client';
import { useApplicationAnalytics, useEndpoints } from '@/lib/webhook-queries';
import { formatAttemptsPerDelivery, formatLatency, formatRate } from './delivery-stats';

const WINDOW_HOURS = 24;

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Figures({ stats }: { stats: DeliveryStats }) {
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      <Figure label="Success rate" value={formatRate(stats.successRate)} />
      <Figure label="Attempts" value={String(stats.attempts)} />
      <Figure
        label="Attempts per delivery"
        value={formatAttemptsPerDelivery(stats.attemptsPerDelivery)}
      />
      <Figure label="p50 latency" value={formatLatency(stats.latencyMs.p50)} />
      <Figure label="p95 latency" value={formatLatency(stats.latencyMs.p95)} />
      <Figure label="p99 latency" value={formatLatency(stats.latencyMs.p99)} />
    </dl>
  );
}

/** How deliveries of one application went over the last day, as a whole and per endpoint. */
export function DeliveryHealthPanel({
  organizationId,
  applicationId,
}: {
  organizationId: string;
  applicationId: string;
}) {
  const report = useApplicationAnalytics(organizationId, applicationId, WINDOW_HOURS);
  const endpoints = useEndpoints(organizationId, applicationId);
  const urlOf = new Map(
    (endpoints.data?.items ?? []).map((endpoint) => [endpoint.id, endpoint.url]),
  );

  return (
    <Panel title="Delivery health" description="The last 24 hours, from every real send.">
      {report.isPending ? (
        <LoadingRows label="Loading delivery health" />
      ) : report.isError ? (
        <div className="p-5">
          <Alert tone="error">{describeError(report.error)}</Alert>
        </div>
      ) : report.data.summary.attempts === 0 ? (
        <EmptyState title="No deliveries in the last 24 hours" />
      ) : (
        <div className="space-y-5 p-5">
          <Figures stats={report.data.summary} />
          <Table caption="Delivery health by endpoint">
            <THead>
              <Tr>
                <Th>Endpoint</Th>
                <Th>Success rate</Th>
                <Th>Attempts</Th>
                <Th>Per delivery</Th>
                <Th>p50</Th>
                <Th>p95</Th>
                <Th>p99</Th>
              </Tr>
            </THead>
            <TBody>
              {report.data.endpoints.map((endpoint) => (
                <Tr key={endpoint.endpointId}>
                  <Td>
                    <Link
                      href={`/applications/${applicationId}/endpoints/${endpoint.endpointId}`}
                      className="text-accent hover:underline"
                    >
                      {urlOf.get(endpoint.endpointId) ?? endpoint.endpointId}
                    </Link>
                  </Td>
                  <Td>{formatRate(endpoint.successRate)}</Td>
                  <Td>{endpoint.attempts}</Td>
                  <Td>{formatAttemptsPerDelivery(endpoint.attemptsPerDelivery)}</Td>
                  <Td>{formatLatency(endpoint.latencyMs.p50)}</Td>
                  <Td>{formatLatency(endpoint.latencyMs.p95)}</Td>
                  <Td>{formatLatency(endpoint.latencyMs.p99)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}
