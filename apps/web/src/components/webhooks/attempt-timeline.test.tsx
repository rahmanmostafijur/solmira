// @vitest-environment jsdom
import type { AttemptView } from '@solmira/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AttemptTimeline } from './attempt-timeline';

const base: AttemptView = {
  deliveryId: '0190a000-0000-7000-8000-000000000001',
  endpointId: '0190a000-0000-7000-8000-000000000002',
  attempt: 1,
  startedAt: '2026-10-21T10:00:00.000Z',
  durationMs: 120,
  statusCode: 500,
  errorClass: 'http_5xx',
  responseBody: 'upstream exploded',
  responseBodyTruncated: false,
  nextAttemptAt: '2026-10-21T10:05:00.000Z',
};

describe('AttemptTimeline', () => {
  it('says so when nothing was attempted yet', () => {
    render(<AttemptTimeline attempts={[]} />);
    expect(screen.getByText('No attempts recorded yet.')).toBeTruthy();
  });

  it('lists each attempt with its outcome, the response and the next try', () => {
    render(
      <AttemptTimeline
        attempts={[
          base,
          {
            ...base,
            attempt: 2,
            statusCode: 200,
            errorClass: null,
            responseBody: null,
            nextAttemptAt: null,
          },
        ]}
      />,
    );

    const items = within(screen.getByRole('list', { name: 'Attempts' })).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('Receiver error (HTTP 500)')).toBeTruthy();
    expect(within(items[0]!).getByText('upstream exploded')).toBeTruthy();
    expect(within(items[0]!).getByText(/Next attempt/)).toBeTruthy();
    expect(within(items[1]!).getByText('Delivered (HTTP 200)')).toBeTruthy();
    expect(within(items[1]!).queryByText(/Next attempt/)).toBeNull();
  });

  it('marks a response body that was cut off', () => {
    render(<AttemptTimeline attempts={[{ ...base, responseBodyTruncated: true }]} />);
    expect(screen.getByText(/truncated/)).toBeTruthy();
  });
});
