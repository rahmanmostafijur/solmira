import type { FieldIssue } from '@solmira/contracts';
import { AppError } from '@solmira/service-kit';

/** The event type is missing, or archived and so closed to new messages. */
export class UnknownEventTypeError extends AppError {
  constructor(name: string) {
    super('UNKNOWN_EVENT_TYPE', 'Unknown or archived event type: ' + name, 422, [
      {
        path: 'eventType',
        message:
          `No active event type is named "${name}". Check the spelling, or create the event ` +
          'type first (console: Event types, API: POST /api/v1/event-types)',
      },
    ]);
  }
}

/** The payload does not match the JSON Schema of its event type. */
export class PayloadInvalidError extends AppError {
  constructor(issues: readonly FieldIssue[]) {
    super('PAYLOAD_INVALID', 'The payload does not match the event type schema', 422, issues);
  }
}

/** Sizes are bytes of the payload's JSON form (UTF-8), the same measure the limit uses. */
export class PayloadTooLargeError extends AppError {
  constructor(limitBytes: number, actualBytes: number) {
    super('PAYLOAD_TOO_LARGE', 'The payload can be at most ' + limitBytes + ' bytes', 413, [
      {
        path: 'payload',
        message:
          `The payload must be at most ${limitBytes} bytes as JSON; got ${actualBytes}. Send ` +
          'less data, or store large content elsewhere and send a reference to it',
        rule: 'too_big',
        maximum: limitBytes,
      },
    ]);
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
