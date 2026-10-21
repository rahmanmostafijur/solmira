'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, Panel } from '@/components/ui/feedback';
import { TextField } from '@/components/ui/field';
import { describeError } from '@/lib/api/client';
import { useReplayEndpoint } from '@/lib/webhook-queries';

/** Re-queues every delivery to this endpoint for messages created in a time range, for example after an outage. */
export function ReplayRange({
  organizationId,
  applicationId,
  endpointId,
}: {
  organizationId: string;
  applicationId: string;
  endpointId: string;
}) {
  const replay = useReplayEndpoint(organizationId, applicationId, endpointId);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string>();

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    const start = Date.parse(from);
    const end = Date.parse(to);
    if (Number.isNaN(start) || Number.isNaN(end)) return setError('Choose both a start and an end');
    if (start >= end) return setError('The end must be after the start');
    replay.mutate(
      { from: new Date(start).toISOString(), to: new Date(end).toISOString() },
      { onError: (caught) => setError(describeError(caught)) },
    );
  }

  return (
    <Panel
      title="Replay a time range"
      description="Send again every message created in the range, with a new delivery cycle."
    >
      <form onSubmit={submit} noValidate className="space-y-4 p-5">
        {error && <Alert tone="error">{error}</Alert>}
        {replay.data && (
          <Alert tone="success">
            {replay.data.replayed} deliveries queued
            {replay.data.more ? '. More match; run it again to continue.' : '.'}
          </Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="From"
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <TextField
            label="To"
            type="datetime-local"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        <Button type="submit" loading={replay.isPending}>
          Replay range
        </Button>
      </form>
    </Panel>
  );
}
