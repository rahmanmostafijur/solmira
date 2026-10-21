// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReplayRange } from './replay-range';

const mutate = vi.fn();
vi.mock('@/lib/webhook-queries', () => ({
  useReplayEndpoint: () => ({ mutate, isPending: false, data: undefined }),
}));

function setup() {
  const user = userEvent.setup();
  render(<ReplayRange organizationId="org" applicationId="app" endpointId="ep" />);
  return user;
}

describe('ReplayRange', () => {
  beforeEach(() => mutate.mockReset());

  it('sends the range as ISO timestamps', async () => {
    const user = setup();

    await user.type(screen.getByLabelText('From'), '2026-10-21T08:00');
    await user.type(screen.getByLabelText('To'), '2026-10-21T09:30');
    await user.click(screen.getByRole('button', { name: 'Replay range' }));

    expect(mutate).toHaveBeenCalledWith(
      {
        from: new Date('2026-10-21T08:00').toISOString(),
        to: new Date('2026-10-21T09:30').toISOString(),
      },
      expect.any(Object),
    );
  });

  it('requires both ends and an end after the start', async () => {
    const user = setup();

    await user.click(screen.getByRole('button', { name: 'Replay range' }));
    expect(screen.getByText('Choose both a start and an end')).toBeTruthy();

    await user.type(screen.getByLabelText('From'), '2026-10-21T09:00');
    await user.type(screen.getByLabelText('To'), '2026-10-21T08:00');
    await user.click(screen.getByRole('button', { name: 'Replay range' }));
    expect(screen.getByText('The end must be after the start')).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
  });
});
