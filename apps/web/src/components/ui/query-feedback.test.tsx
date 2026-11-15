// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/client';
import { QueryError, QueryLoading } from './query-feedback';

const unavailable = new ApiError(503, 'SERVICE_UNAVAILABLE', 'The service is unavailable');

describe('QueryLoading', () => {
  it('shows the skeleton on a first load', () => {
    render(
      <QueryLoading query={{ fetchStatus: 'fetching', failureReason: null }} label="Loading x" />,
    );
    expect(screen.getByRole('status', { name: 'Loading x' })).toBeTruthy();
    expect(screen.queryByText('Reconnecting…')).toBeNull();
  });

  it('says it is reconnecting, not that it failed, while a restart is waited out', () => {
    render(<QueryLoading query={{ fetchStatus: 'fetching', failureReason: unavailable }} />);
    expect(screen.getByText('Reconnecting…')).toBeTruthy();
    expect(screen.getByText(/service is restarting/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('QueryError', () => {
  it('explains the failure and tries again on Retry', async () => {
    const refetch = vi.fn();
    const user = userEvent.setup();
    render(<QueryError query={{ error: unavailable, refetch }} />);

    expect(screen.getByRole('alert').textContent).toMatch(/A Solmira service is restarting/);
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
