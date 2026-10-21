// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EventTypeForm } from './event-type-form';

function setup() {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<EventTypeForm onSubmit={onSubmit} onCancel={() => undefined} />);
  return { user, onSubmit };
}

describe('EventTypeForm', () => {
  it('submits a name with a parsed schema', async () => {
    const { user, onSubmit } = setup();

    await user.type(screen.getByLabelText('Name'), 'invoice.paid');
    await user.click(screen.getByLabelText('Payload schema'));
    await user.paste('{"type":"object"}');
    await user.click(screen.getByRole('button', { name: 'Create event type' }));

    expect(onSubmit).toHaveBeenCalledWith({ name: 'invoice.paid', schema: { type: 'object' } });
  });

  it('refuses the reserved platform prefix', async () => {
    const { user, onSubmit } = setup();

    await user.type(screen.getByLabelText('Name'), 'solmira.custom');
    await user.click(screen.getByRole('button', { name: 'Create event type' }));

    expect(await screen.findByText(/reserved for the platform/)).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses a schema that is not a JSON object', async () => {
    const { user, onSubmit } = setup();

    await user.type(screen.getByLabelText('Name'), 'invoice.paid');
    await user.click(screen.getByLabelText('Payload schema'));
    await user.paste('[1, 2]');
    await user.click(screen.getByRole('button', { name: 'Create event type' }));

    expect(await screen.findByText(/JSON object/)).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
