// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SecretDisplay } from './secret-display';

describe('SecretDisplay', () => {
  it('shows the secret and copies it to the clipboard', async () => {
    const user = userEvent.setup();
    render(<SecretDisplay label="Signing secret" value="whsec_abc123" />);

    expect(screen.getByTestId('secret-value').textContent).toBe('whsec_abc123');
    await user.click(screen.getByRole('button', { name: 'Copy Signing secret' }));

    expect(await navigator.clipboard.readText()).toBe('whsec_abc123');
    expect(screen.getByRole('button', { name: 'Copy Signing secret' }).textContent).toContain(
      'Copied',
    );
  });
});
