'use client';

import {
  MAX_ENDPOINT_RATE_LIMIT_PER_SECOND,
  type CreateEndpointRequest,
  type Endpoint,
  type EventType,
} from '@solmira/contracts';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { TextAreaField, TextField } from '@/components/ui/field';
import { describeError } from '@/lib/api/client';
import { formatHeadersText, parseHeadersText } from '@/lib/headers-text';

export type EndpointSubmission = Omit<CreateEndpointRequest, 'enabled'>;

/** Creates or edits an endpoint: where to deliver, which events, and optional limits and headers. */
export function EndpointForm({
  eventTypes,
  initial,
  submitLabel = 'Create endpoint',
  onSubmit,
  onCancel,
}: {
  eventTypes: readonly EventType[];
  initial?: Endpoint;
  submitLabel?: string;
  onSubmit: (values: EndpointSubmission) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState(initial?.url ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [rate, setRate] = useState(initial?.rateLimitPerSecond?.toString() ?? '');
  const [headersText, setHeadersText] = useState(formatHeadersText(initial?.headers ?? {}));
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    new Set(initial?.eventTypeIds ?? []),
  );
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    const headers = parseHeadersText(headersText);
    if (headers.error) return setError(headers.error);
    const rateLimit = rate.trim() === '' ? undefined : Number(rate);
    if (
      rateLimit !== undefined &&
      !(
        Number.isInteger(rateLimit) &&
        rateLimit >= 1 &&
        rateLimit <= MAX_ENDPOINT_RATE_LIMIT_PER_SECOND
      )
    ) {
      return setError(
        `Rate limit must be a whole number from 1 to ${MAX_ENDPOINT_RATE_LIMIT_PER_SECOND}`,
      );
    }
    setPending(true);
    try {
      await onSubmit({
        url: url.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(rateLimit !== undefined ? { rateLimitPerSecond: rateLimit } : {}),
        headers: headers.headers,
        eventTypeIds: [...selected],
      });
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <TextField
        label="URL"
        type="url"
        placeholder="https://example.com/webhooks"
        hint="HTTPS only in production. Private addresses are refused."
        value={url}
        onChange={(event) => setUrl(event.target.value)}
      />
      <TextField
        label="Description"
        hint="Optional"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <TextField
        label="Rate limit (requests per second)"
        inputMode="numeric"
        hint="Optional. Leave empty for no limit."
        value={rate}
        onChange={(event) => setRate(event.target.value)}
      />
      <TextAreaField
        label="Custom headers"
        hint="Optional, one per line as name: value."
        value={headersText}
        onChange={(event) => setHeadersText(event.target.value)}
      />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">Event types</legend>
        <p className="text-xs text-ink-muted">
          {selected.size === 0
            ? 'None selected: the endpoint receives every event type.'
            : `${selected.size} selected.`}
        </p>
        <div className="max-h-40 space-y-1 overflow-y-auto">
          {eventTypes.map((eventType) => (
            <label key={eventType.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.has(eventType.id)}
                onChange={() => toggle(eventType.id)}
              />
              <code className="font-mono text-xs">{eventType.name}</code>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
