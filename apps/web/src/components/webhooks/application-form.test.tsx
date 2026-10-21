// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/client';
import { ApplicationForm } from './application-form';

function setup(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const user = userEvent.setup();
  render(
    <ApplicationForm
      initial={{ name: 'Production', description: 'Live traffic' }}
      submitLabel="Save"
      onSubmit={onSubmit}
      onCancel={() => undefined}
    />,
  );
  return { user, onSubmit };
}

describe('ApplicationForm when editing', () => {
  it('starts from the current name and description and submits the changes', async () => {
    const { user, onSubmit } = setup();

    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Production');
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Staging');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Staging', description: 'Live traffic' });
  });

  it('submits no description when it was emptied', async () => {
    const { user, onSubmit } = setup();

    await user.clear(screen.getByLabelText('Description'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Production' });
  });

  it('shows a server validation error on its field', async () => {
    const { user } = setup(
      vi
        .fn()
        .mockRejectedValue(
          new ApiError(400, 'VALIDATION_FAILED', 'Invalid', [
            { path: 'name', message: 'The name can have at most 100 characters' },
          ]),
        ),
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('The name can have at most 100 characters')).toBeTruthy();
  });

  it('refuses an empty name without calling the API', async () => {
    const { user, onSubmit } = setup();

    await user.clear(screen.getByLabelText('Name'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
