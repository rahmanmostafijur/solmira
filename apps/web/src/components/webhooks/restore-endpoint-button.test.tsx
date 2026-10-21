// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import { ApiError } from '@/lib/api/client';
import { RestoreEndpointButton, describeRestoreError } from './restore-endpoint-button';

let outcome: { error?: unknown };
const mutate = vi.fn(
  (_id: string, handlers: { onSuccess: () => void; onError: (error: unknown) => void }) =>
    outcome.error === undefined ? handlers.onSuccess() : handlers.onError(outcome.error),
);

vi.mock('@/lib/webhook-queries', () => ({
  useRestoreEndpoint: () => ({ mutate, isPending: false }),
}));

const policyRefusal = new ApiError(400, 'VALIDATION_FAILED', 'url is not allowed', [
  { path: 'url', message: 'The host resolves to a private address' },
]);

function setup() {
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <RestoreEndpointButton organizationId="org" applicationId="app" endpointId="ep-1" />
    </ToastProvider>,
  );
  return { user };
}

describe('RestoreEndpointButton', () => {
  beforeEach(() => {
    outcome = {};
    mutate.mockClear();
  });

  it('restores the endpoint and confirms it', async () => {
    const { user } = setup();

    await user.click(screen.getByRole('button', { name: 'Restore' }));

    expect(mutate).toHaveBeenCalledWith('ep-1', expect.anything());
    expect(await screen.findByText('Endpoint restored')).toBeTruthy();
  });

  it('says the endpoint stays archived when its URL no longer passes the URL policy', async () => {
    outcome = { error: policyRefusal };
    const { user } = setup();

    await user.click(screen.getByRole('button', { name: 'Restore' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('stays archived');
    expect(alert.textContent).toContain('The host resolves to a private address');
  });
});

describe('describeRestoreError', () => {
  it('falls back to the usual text for other failures', () => {
    expect(describeRestoreError(new ApiError(404, 'NOT_FOUND', 'Application not found'))).toBe(
      'Application not found',
    );
  });
});
