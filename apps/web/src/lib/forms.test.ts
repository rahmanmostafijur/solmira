import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api/client';
import { applyServerError } from './forms';

/** A stand-in for a react-hook-form form whose fields hold these values. */
function formWith(values: Record<string, unknown>) {
  return { setError: vi.fn(), getValues: vi.fn(() => values) };
}

describe('applyServerError', () => {
  it('puts validation details on their fields', () => {
    const form = formWith({ name: '' });
    const error = new ApiError(400, 'VALIDATION_FAILED', 'Invalid', [
      { path: 'name', message: 'Enter a name' },
    ]);

    applyServerError(error, form);

    expect(form.setError).toHaveBeenCalledWith('name', { type: 'server', message: 'Enter a name' });
  });

  it('maps nested server paths through the field mapping of the caller', () => {
    const form = formWith({ quantity: 1 });
    const error = new ApiError(400, 'VALIDATION_FAILED', 'Invalid', [
      { path: 'lines.0.quantity', message: 'Only 3 allowed' },
      { path: 'lines.0.itemId', message: 'Unknown item' },
    ]);

    applyServerError(error, form, (path) => (path.endsWith('.quantity') ? 'quantity' : ''));

    expect(form.setError).toHaveBeenCalledWith('quantity', {
      type: 'server',
      message: 'Only 3 allowed',
    });
    expect(form.setError).toHaveBeenCalledWith('root', {
      type: 'server',
      message: 'Unknown item',
    });
  });

  it('shows details for fields the form does not have on the root instead of dropping them', () => {
    const form = formWith({ password: '' });
    const error = new ApiError(400, 'VALIDATION_FAILED', 'token is too short', [
      { path: 'token', message: 'token must be 20 to 200 characters long; got 3.' },
      { path: 'password', message: 'Use at least 12 characters' },
      { path: '', message: 'Send at least one field to change' },
    ]);

    applyServerError(error, form);

    expect(form.setError).toHaveBeenCalledWith('password', {
      type: 'server',
      message: 'Use at least 12 characters',
    });
    expect(form.setError).toHaveBeenCalledWith('root', {
      type: 'server',
      message: 'token must be 20 to 200 characters long; got 3. Send at least one field to change',
    });
    expect(form.setError).toHaveBeenCalledTimes(2);
  });

  it('shows a detail inside a field on that field', () => {
    const form = formWith({ headers: 'x-tenant: acme' });
    const error = new ApiError(400, 'VALIDATION_FAILED', 'Invalid', [
      { path: 'headers.x-tenant', message: 'Header values cannot contain control characters' },
    ]);

    applyServerError(error, form);

    expect(form.setError).toHaveBeenCalledWith('headers', {
      type: 'server',
      message: 'Header values cannot contain control characters',
    });
  });

  it('shows any other failure on the form root', () => {
    const form = formWith({});

    applyServerError(new ApiError(404, 'NOT_FOUND', 'Resource not found'), form);

    expect(form.setError).toHaveBeenCalledWith('root', {
      type: 'server',
      message: 'Resource not found',
    });
  });
});
