import type { FieldIssue } from '@solmira/contracts';
import { AppError } from '@solmira/service-kit';

/** The event type is missing, or archived and so closed to new messages. */
export class UnknownEventTypeError extends AppError {
  constructor(name: string) {
    super('UNKNOWN_EVENT_TYPE', 'Unknown or archived event type: ' + name, 422, [
      { path: 'eventType', message: 'No active event type has this name' },
    ]);
  }
}

/** The payload does not match the JSON Schema of its event type. */
export class PayloadInvalidError extends AppError {
  constructor(issues: readonly FieldIssue[]) {
    super('PAYLOAD_INVALID', 'The payload does not match the event type schema', 422, issues);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(limitBytes: number) {
    super('PAYLOAD_TOO_LARGE', 'The payload can be at most ' + limitBytes + ' bytes', 413);
  }
}

/** The Idempotency-Key was used before for a different request. */
export class IdempotencyConflictError extends AppError {
  constructor() {
    super(
      'IDEMPOTENCY_CONFLICT',
      'This Idempotency-Key was already used with a different event type or payload',
      409,
    );
  }
}
