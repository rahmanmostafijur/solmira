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

  it('routes insufficient stock details through the field mapping', () => {
    const setError = vi.fn();
    const error = new ApiError(409, 'INSUFFICIENT_STOCK', 'Not enough stock', [
      { path: 'lines.0.quantity', message: 'Only 3 available' },
      { path: 'lines.0.variantId', message: 'Unknown variant' },
    ]);

    applyServerError(error, setError, (path) => (path.endsWith('.quantity') ? 'quantity' : ''));

    expect(setError).toHaveBeenCalledWith('quantity', {
      type: 'server',
      message: 'Only 3 available',
    });
    expect(setError).toHaveBeenCalledWith('root', { type: 'server', message: 'Unknown variant' });
  });

  it('shows any other failure on the form root', () => {
    const setError = vi.fn();

    applyServerError(new ApiError(404, 'NOT_FOUND', 'Stock level not found'), setError);

    expect(setError).toHaveBeenCalledWith('root', {
      type: 'server',
      message: 'Stock level not found',
    });
  });
});
