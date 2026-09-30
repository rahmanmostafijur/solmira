import { MAX_STOCK_QUANTITY, type FieldIssue } from '@solmira/contracts';
import { AppError, ValidationError } from '@solmira/service-kit';

/**
 * Not enough available stock for a requested movement. 409 because the request is well formed
 * but conflicts with the current state; the details name each short line and what is available.
 */
export class InsufficientStockError extends AppError {
  constructor(details: readonly FieldIssue[]) {
    super('INSUFFICIENT_STOCK', 'Not enough stock available', 409, details);
  }
}

export const shortage = (path: string, available: number): FieldIssue => ({
  path,
  message: available > 0 ? `Only ${available} available` : 'No stock available',
});

/** An increase that would take a level past the stock ceiling (keeps counters inside integer). */
export const stockCeilingError = (path: string): ValidationError =>
  new ValidationError([
    { path, message: `Stock cannot exceed ${MAX_STOCK_QUANTITY.toLocaleString('en-US')} units` },
  ]);
