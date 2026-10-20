import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api/client';
import { applyServerError } from './forms';

describe('applyServerError', () => {
  it('puts validation details on their fields', () => {
    const setError = vi.fn();
    const error = new ApiError(400, 'VALIDATION_FAILED', 'Invalid', [
      { path: 'name', message: 'Enter a name' },
    ]);

    applyServerError(error, setError);

    expect(setError).toHaveBeenCalledWith('name', { type: 'server', message: 'Enter a name' });
  });

  it('maps nested server paths through the field mapping of the caller', () => {
    const setError = vi.fn();
    const error = new ApiError(400, 'VALIDATION_FAILED', 'Invalid', [
      { path: 'lines.0.quantity', message: 'Only 3 allowed' },
      { path: 'lines.0.itemId', message: 'Unknown item' },
    ]);

    applyServerError(error, setError, (path) => (path.endsWith('.quantity') ? 'quantity' : ''));

    expect(setError).toHaveBeenCalledWith('quantity', {
      type: 'server',
      message: 'Only 3 allowed',
    });
    expect(setError).toHaveBeenCalledWith('root', { type: 'server', message: 'Unknown item' });
  });

  it('shows any other failure on the form root', () => {
    const setError = vi.fn();

    applyServerError(new ApiError(404, 'NOT_FOUND', 'Resource not found'), setError);

    expect(setError).toHaveBeenCalledWith('root', {
      type: 'server',
      message: 'Resource not found',
    });
  });
});
