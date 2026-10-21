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

describe('EventTypeForm when editing', () => {
  const existing = {
    name: 'invoice.paid',
    description: 'An invoice was paid',
    schema: { type: 'object' },
  };

  function setupEdit(onSubmit = vi.fn().mockResolvedValue(undefined)) {
    const user = userEvent.setup();
    render(
      <EventTypeForm
        initial={existing}
        submitLabel="Save"
        onSubmit={onSubmit}
        onCancel={() => undefined}
      />,
    );
    return { user, onSubmit };
  }

  it('shows the name read-only and the current schema as JSON', () => {
    setupEdit();
    const name = screen.getByLabelText('Name') as HTMLInputElement;
    expect(name.value).toBe('invoice.paid');
    expect(name.readOnly).toBe(true);
    expect(screen.getByText(/name cannot change/)).toBeTruthy();
    expect(
      JSON.parse((screen.getByLabelText('Payload schema') as HTMLTextAreaElement).value),
    ).toEqual({ type: 'object' });
  });

  it('submits the changed description and schema', async () => {
    const { user, onSubmit } = setupEdit();

    await user.clear(screen.getByLabelText('Description'));
    await user.type(screen.getByLabelText('Description'), 'Paid in full');
    await user.clear(screen.getByLabelText('Payload schema'));
    await user.click(screen.getByLabelText('Payload schema'));
    await user.paste('{"type":"object","required":["id"]}');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'invoice.paid',
      description: 'Paid in full',
      schema: { type: 'object', required: ['id'] },
    });
  });

  it('submits no schema when it was emptied, so validation can be removed', async () => {
    const { user, onSubmit } = setupEdit();

    await user.clear(screen.getByLabelText('Payload schema'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'invoice.paid',
      description: 'An invoice was paid',
    });
  });

  it('edits a platform event type without objecting to its reserved name', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <EventTypeForm
        initial={{ name: 'solmira.test', description: null, schema: null }}
        submitLabel="Save"
        onSubmit={onSubmit}
        onCancel={() => undefined}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).toHaveBeenCalledWith({ name: 'solmira.test' });
  });
});
