// @vitest-environment jsdom
import type { EventType } from '@solmira/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/client';
import { EndpointForm } from './endpoint-form';

const eventTypes = [
  { id: '0190a000-0000-7000-8000-000000000001', name: 'invoice.paid' },
  { id: '0190a000-0000-7000-8000-000000000002', name: 'invoice.failed' },
] as EventType[];

function setup(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const user = userEvent.setup();
  render(<EndpointForm eventTypes={eventTypes} onSubmit={onSubmit} onCancel={() => undefined} />);
  return { user, onSubmit };
}

describe('EndpointForm', () => {
  it('submits the url, parsed headers, rate limit and chosen event types', async () => {
    const { user, onSubmit } = setup();

    await user.type(screen.getByLabelText('URL'), 'https://example.com/hook');
    await user.type(screen.getByLabelText(/Rate limit/), '5');
    await user.type(screen.getByLabelText('Custom headers'), 'X-Team: billing');
    await user.click(screen.getByLabelText('invoice.paid'));
    await user.click(screen.getByRole('button', { name: 'Create endpoint' }));

    expect(onSubmit).toHaveBeenCalledWith({
      url: 'https://example.com/hook',
      rateLimitPerSecond: 5,
      headers: { 'x-team': 'billing' },
      eventTypeIds: [eventTypes[0]!.id],
    });
  });

  it('says every event type is received when none is chosen', () => {
    setup();
    expect(screen.getByText(/receives every event type/)).toBeTruthy();
  });

  it('rejects a malformed header line without calling the API', async () => {
    const { user, onSubmit } = setup();

    await user.type(screen.getByLabelText('URL'), 'https://example.com/hook');
    await user.type(screen.getByLabelText('Custom headers'), 'not a header');
    await user.click(screen.getByRole('button', { name: 'Create endpoint' }));

    expect(screen.getByText(/Line 1/)).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects a rate limit outside the allowed range', async () => {
    const { user, onSubmit } = setup();

    await user.type(screen.getByLabelText('URL'), 'https://example.com/hook');
    await user.type(screen.getByLabelText(/Rate limit/), '0');
    await user.click(screen.getByRole('button', { name: 'Create endpoint' }));

    expect(screen.getByText(/whole number from 1 to/)).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the error the server returns', async () => {
    const { user } = setup(
      vi
        .fn()
        .mockRejectedValue(new ApiError(422, 'ENDPOINT_URL_REJECTED', 'The URL is not allowed')),
    );

    await user.type(screen.getByLabelText('URL'), 'http://10.0.0.1');
    await user.click(screen.getByRole('button', { name: 'Create endpoint' }));

    expect(await screen.findByText('The URL is not allowed')).toBeTruthy();
  });
});
