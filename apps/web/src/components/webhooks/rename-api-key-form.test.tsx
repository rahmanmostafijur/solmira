// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/client';
import { RenameApiKeyForm } from './rename-api-key-form';

function setup(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const user = userEvent.setup();
  render(<RenameApiKeyForm name="backend" onSubmit={onSubmit} onCancel={() => undefined} />);
  return { user, onSubmit };
}

describe('RenameApiKeyForm', () => {
  it('starts from the current name and submits only the new name, trimmed', async () => {
    const { user, onSubmit } = setup();

    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('backend');
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), '  billing worker ');
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    expect(onSubmit).toHaveBeenCalledWith({ name: 'billing worker' });
  });

  it('refuses an empty name without calling the API', async () => {
    const { user, onSubmit } = setup();

    await user.clear(screen.getByLabelText('Name'));
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    expect(await screen.findByText('Enter a name')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows why the server refused, for example a key revoked meanwhile', async () => {
    const { user } = setup(
      vi.fn().mockRejectedValue(new ApiError(409, 'CONFLICT', 'A revoked key cannot be renamed')),
    );

    await user.click(screen.getByRole('button', { name: 'Rename' }));

    expect(await screen.findByText('A revoked key cannot be renamed')).toBeTruthy();
  });
});
