import { randomUUID } from 'node:crypto';
import type { TestApp } from './test-app.js';

/** POSTs a message the way a tenant backend would: API key plus Idempotency-Key. */
export function sendMessage(
  t: TestApp,
  applicationId: string,
  key: string,
  body: object,
  idempotencyKey: string | null = randomUUID(),
) {
  const request = t
    .http()
    .post('/api/v1/applications/' + applicationId + '/messages')
    .set('Authorization', 'Bearer ' + key);
  if (idempotencyKey !== null) request.set('Idempotency-Key', idempotencyKey);
  return request.send(body);
}
