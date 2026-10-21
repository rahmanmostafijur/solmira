import { expect, test, type Page } from '@playwright/test';
import { TestReceiver, isValidSignature } from './receiver';

/**
 * The main product flow against the real stack: a person signs up, sets up an application with an
 * endpoint and an API key in the console, their backend sends an event, the receiver gets a signed
 * delivery, and a failure is inspected and replayed from the message inspector.
 */
const receiver = new TestReceiver();
const run = Date.now().toString(36);
const EVENT_TYPE = 'order.created';

test.beforeAll(() => receiver.start());
test.afterAll(() => receiver.stop());

async function readSecret(page: Page): Promise<string> {
  return (await page.getByTestId('secret-value').textContent()) ?? '';
}

test('sets up delivery in the console, delivers a signed event, then replays a failure', async ({
  page,
  request,
}) => {
  // Sign up. Creating an account signs the person in and lands on the organizations page.
  await page.goto('/register');
  // Forms only work once the page has hydrated; a fresh dev server compiles pages on first visit.
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Full name').fill('Eve Tester');
  await page.getByLabel('Work email').fill(`e2e-${run}@example.com`);
  await page.getByLabel('Password').fill('a long e2e password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/organizations/);

  await page.getByLabel('Organization name').fill(`Northwind ${run}`);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByText(`Northwind ${run}`).first()).toBeVisible();

  // An event type.
  await page.goto('/event-types');
  await page.getByRole('button', { name: 'New event type' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill(EVENT_TYPE);
  await page.getByRole('button', { name: 'Create event type' }).click();
  await expect(page.getByRole('cell', { name: EVENT_TYPE })).toBeVisible();

  // An application, and its API key (shown once).
  await page.goto('/applications');
  await page.getByRole('button', { name: 'New application' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('Storefront');
  await page.getByRole('button', { name: 'Create application' }).click();
  await page.getByRole('link', { name: 'Storefront' }).click();
  await expect(page).toHaveURL(/\/applications\/[0-9a-f-]{36}$/);
  const applicationId = page.url().split('/').pop()!;

  await page.getByRole('button', { name: 'New API key' }).click();
  await page.getByRole('dialog').getByLabel('Name').fill('backend');
  await page.getByRole('button', { name: 'Create key' }).click();
  await expect(page.getByText('This is the only time the key is shown')).toBeVisible();
  const apiKey = await readSecret(page);
  expect(apiKey).toMatch(/^slm_/);
  await page.getByRole('button', { name: 'Done' }).click();

  // An endpoint that receives the event type, and its signing secret (shown once).
  await page.getByRole('button', { name: 'New endpoint' }).click();
  await page.getByRole('dialog').getByLabel('URL', { exact: true }).fill(receiver.url);
  await page.getByRole('dialog').getByLabel(EVENT_TYPE).check();
  await page.getByRole('button', { name: 'Create endpoint' }).click();
  await expect(page.getByText('Copy the signing secret')).toBeVisible();
  const signingSecret = await readSecret(page);
  await page.getByRole('button', { name: 'Done' }).click();

  // The customer's backend sends an event through the ingestion API.
  const send = (payload: Record<string, unknown>) =>
    request.post(`/api/v1/applications/${applicationId}/messages`, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Idempotency-Key': `e2e-${run}-${Date.now()}` },
      data: { eventType: EVENT_TYPE, payload },
    });
  const accepted = await send({ orderId: 'A-1001' });
  expect(accepted.status()).toBe(202);

  // The receiver gets exactly one signed delivery with the payload unchanged.
  await expect.poll(() => receiver.received.length).toBe(1);
  const delivery = receiver.received[0]!;
  expect(JSON.parse(delivery.body)).toEqual({ orderId: 'A-1001' });
  expect(isValidSignature(signingSecret, delivery)).toBe(true);

  // The inspector shows the message, its payload and the successful attempt.
  await page.goto(`/applications/${applicationId}/messages`);
  await page.getByRole('link', { name: EVENT_TYPE }).first().click();
  await expect(page.getByText('"orderId": "A-1001"')).toBeVisible();
  await expect(page.getByText('Delivered (HTTP 200)')).toBeVisible();

  // New messages appear in the list by themselves through the realtime feed: while it is live the
  // page does not poll, so a second row can only come from the feed.
  await page.goto(`/applications/${applicationId}/messages`);
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
  const rows = page.getByRole('link', { name: EVENT_TYPE });
  await expect(rows).toHaveCount(1);
  expect((await send({ orderId: 'A-1001b' })).status()).toBe(202);
  await expect(rows).toHaveCount(2);

  // The application page reports how deliveries went, from the analytics service.
  await page.goto(`/applications/${applicationId}`);
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole('cell', { name: '100.0%' })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 40_000 });

  // The receiver starts failing; the short retry schedule of the test stack exhausts quickly.
  receiver.status = 500;
  expect((await send({ orderId: 'A-1002' })).status()).toBe(202);
  await page.goto(`/applications/${applicationId}/messages`);
  await page.getByRole('link', { name: EVENT_TYPE }).first().click();
  await expect(page.getByText('"orderId": "A-1002"')).toBeVisible();
  await expect(page.getByText('Failed', { exact: true })).toBeVisible();
  await expect(page.getByText('Receiver error (HTTP 500)').first()).toBeVisible();

  // The receiver recovers; replaying the delivery from the inspector delivers it.
  receiver.status = 200;
  await page.getByRole('button', { name: 'Replay', exact: true }).click();
  await expect(page.getByText('Delivered (HTTP 200)')).toBeVisible();

  // The test-send button on the endpoint reaches the receiver too.
  const before = receiver.received.length;
  await page.goto(`/applications/${applicationId}`);
  await page.getByRole('link', { name: receiver.url }).click();
  await page.getByRole('button', { name: 'Send test event' }).click();
  await expect.poll(() => receiver.received.length).toBeGreaterThan(before);
  expect(receiver.received.at(-1)!.body).toContain('solmira.test');
});
