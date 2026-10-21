// @vitest-environment jsdom
import type { ApplicationReport } from '@solmira/contracts';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryHealthPanel } from './delivery-health-panel';

const ENDPOINT = '0190a000-0000-7000-8000-000000000002';
const stats = {
  attempts: 110,
  successfulAttempts: 95,
  successRate: 0.8636,
  deliveries: 105,
  attemptsPerDelivery: 1.05,
  latencyMs: { p50: 52.5, p95: 120, p99: 1500 },
};
let analytics: { isPending: boolean; isError: boolean; error?: unknown; data?: ApplicationReport };

vi.mock('@/lib/webhook-queries', () => ({
  useApplicationAnalytics: () => analytics,
  useEndpoints: () => ({ data: { items: [{ id: ENDPOINT, url: 'https://hooks.example/a' }] } }),
}));

const report = (summary: ApplicationReport['summary'] = stats): ApplicationReport => ({
  applicationId: '0190a000-0000-7000-8000-000000000001',
  from: '2026-10-20T00:00:00.000Z',
  to: '2026-10-21T00:00:00.000Z',
  summary,
  endpoints: [{ endpointId: ENDPOINT, ...stats }],
});

describe('DeliveryHealthPanel', () => {
  beforeEach(() => {
    analytics = { isPending: false, isError: false, data: report() };
  });

  it('shows the summary figures and one row per endpoint with its address', () => {
    render(<DeliveryHealthPanel organizationId="org" applicationId="app" />);

    expect(screen.getAllByText('86.4%').length).toBeGreaterThan(0);
    expect(screen.getByText('1.05', { selector: 'dd' })).toBeTruthy();
    expect(screen.getByText('1.50 s', { selector: 'dd' })).toBeTruthy();
    const row = screen.getByRole('link', { name: 'https://hooks.example/a' }).closest('tr')!;
    expect(within(row).getByText('53 ms')).toBeTruthy();
  });

  it('says so when nothing was delivered', () => {
    analytics = {
      isPending: false,
      isError: false,
      data: report({ ...stats, attempts: 0, successRate: null, attemptsPerDelivery: null }),
    };
    render(<DeliveryHealthPanel organizationId="org" applicationId="app" />);
    expect(screen.getByText('No deliveries in the last 24 hours')).toBeTruthy();
  });

  it('shows the failure instead of stale or empty figures', () => {
    analytics = { isPending: false, isError: true, error: new Error('x') };
    render(<DeliveryHealthPanel organizationId="org" applicationId="app" />);
    expect(screen.getByText(/Could not reach the server/)).toBeTruthy();
  });
});
