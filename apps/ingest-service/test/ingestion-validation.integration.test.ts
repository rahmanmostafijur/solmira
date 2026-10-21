import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiKey, createApplication, createEventType } from './support/resources.js';
import { sendMessage } from './support/ingestion.js';
import { createTestApp, newOrganizationId, type Actor, type TestApp } from './support/test-app.js';

describe('message validation', () => {
  let t: TestApp;
  let admin: Actor;
  let appId: string;
  let eventType: string;
  let key: string;

  beforeAll(async () => {
    t = await createTestApp();
    admin = await t.actor(newOrganizationId(), 'ADMIN');
    appId = (await createApplication(t, admin, 'Validation')).id;
    eventType = (await createEventType(t, admin, 'invoice.paid')).name;
    key = (await createApiKey(t, admin, appId)).key;
  });
  afterAll(() => t.close());

  const send = (body: object, idempotencyKey?: string | null) =>
    sendMessage(t, appId, key, body, idempotencyKey);
  const valid = (payload: object = { id: 'inv_1' }) => ({ eventType, payload });

  it('rejects a missing or malformed Idempotency-Key', async () => {
    const missing = await send(valid(), null).expect(400);
    expect(missing.body.error.details[0].path).toBe('Idempotency-Key');
    expect(missing.body.error.details[0].rule).toBe('required');
    const short = await send(valid(), 'short').expect(400);
    expect(short.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Idempotency-Key is too short',
    });
    expect(short.body.error.details).toEqual([
      {
        path: 'Idempotency-Key',
        rule: 'too_short',
        message:
          'Idempotency-Key must be 8 to 100 characters long (letters, digits, - _ : .); got 5. ' +
          'Example: order-1234-created',
        example: 'order-1234-created',
        minimum: 8,
        maximum: 100,
      },
    ]);
  });

  it('rejects a malformed body and names the field and the rule', async () => {
    const notObject = await send({ eventType, payload: 'not an object' }).expect(400);
    expect(notObject.body.error.details[0]).toMatchObject({
      path: 'payload',
      rule: 'invalid_type',
      message: 'payload must be a JSON object; got a string.',
    });
    const missing = await send({ payload: {} }).expect(400);
    expect(missing.body.error.message).toBe('eventType is required');
    expect(missing.body.error.details[0]).toMatchObject({
      rule: 'required',
      example: 'invoice.paid',
    });
    const badName = await send({ eventType: 'Not Valid', payload: {} }).expect(400);
    expect(badName.body.error.details[0]).toMatchObject({
      path: 'eventType',
      rule: 'invalid_format',
    });
    expect(badName.body.error.details[0].message).toContain('for example invoice.paid');
  });

  it('answers 422 UNKNOWN_EVENT_TYPE for an unknown or an archived event type', async () => {
    const unknown = await send({ eventType: 'does.not.exist', payload: {} }).expect(422);
    expect(unknown.body.error.code).toBe('UNKNOWN_EVENT_TYPE');
    const old = await createEventType(t, admin, 'retired.event');
    await t
      .http()
      .post('/api/v1/event-types/' + old.id + '/archive')
      .set(admin.auth)
      .expect(200);
    const archived = await send({ eventType: old.name, payload: {} }).expect(422);
    expect(archived.body.error.code).toBe('UNKNOWN_EVENT_TYPE');
  });

  it('answers 413 PAYLOAD_TOO_LARGE above the limit and accepts a payload right below it', async () => {
    const overhead = JSON.stringify({ blob: '' }).length;
    const fits = 256 * 1024 - overhead;
    const large = await send(valid({ blob: 'x'.repeat(300 * 1024) })).expect(413);
    expect(large.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(large.body.error.details[0]).toMatchObject({
      path: 'payload',
      rule: 'too_big',
      maximum: 256 * 1024,
    });
    await send(valid({ blob: 'x'.repeat(fits) })).expect(202);
    await send(valid({ blob: 'x'.repeat(fits + 1) })).expect(413);
  });

  it('validates the payload against the event type schema and names the failing fields', async () => {
    const typed = await t
      .http()
      .post('/api/v1/event-types')
      .set(admin.auth)
      .send({
        name: 'order.created',
        schema: {
          type: 'object',
          required: ['orderId', 'email'],
          properties: { orderId: { type: 'string' }, email: { type: 'string', format: 'email' } },
          additionalProperties: false,
        },
      })
      .expect(201);
    const name = typed.body.name as string;
    const bad = await send({ eventType: name, payload: { orderId: 7, email: 'nope' } }).expect(422);
    expect(bad.body.error.code).toBe('PAYLOAD_INVALID');
    expect(bad.body.error.details[0].path).toMatch(/^payload\./);
    const missing = await send({ eventType: name, payload: { orderId: 'o1' } }).expect(422);
    expect(missing.body.error.code).toBe('PAYLOAD_INVALID');
    const extra = await send({
      eventType: name,
      payload: { orderId: 'o1', email: 'a@b.co', x: 1 },
    });
    expect(extra.status).toBe(422);
    await send({ eventType: name, payload: { orderId: 'o1', email: 'a@example.com' } }).expect(202);
  });

  it('applies a changed schema to the next message', async () => {
    const created = await t
      .http()
      .post('/api/v1/event-types')
      .set(admin.auth)
      .send({ name: 'changing.schema', schema: { type: 'object', required: ['a'] } })
      .expect(201);
    await send({ eventType: 'changing.schema', payload: { b: 1 } }).expect(422);
    await t
      .http()
      .patch('/api/v1/event-types/' + created.body.id)
      .set(admin.auth)
      .send({ schema: { type: 'object', required: ['b'] } })
      .expect(200);
    await send({ eventType: 'changing.schema', payload: { b: 1 } }).expect(202);
  });

  it('stores nothing for a rejected request', async () => {
    const count = async () =>
      (
        await t.db.query('select count(*)::int as n from messages where organization_id = $1', [
          admin.organizationId,
        ])
      ).rows[0].n as number;
    const before = await count();
    await send({ eventType: 'does.not.exist', payload: {} }).expect(422);
    await send(valid({ blob: 'x'.repeat(300 * 1024) })).expect(413);
    expect(await count()).toBe(before);
  });
});
