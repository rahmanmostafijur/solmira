# @solmira/webhooks

Sign and verify webhooks with [Standard Webhooks](https://www.standardwebhooks.com/) (HMAC-SHA256,
`webhook-id`, `webhook-timestamp`, `webhook-signature`). Solmira uses it to sign what it sends, and it
is the library a receiver uses to check what it gets. No dependencies beyond `node:crypto`.

```ts
import { WebhookVerificationError, parseWebhook } from '@solmira/webhooks';

const event = parseWebhook({
  headers: request.headers, // names are matched without regard to case
  body: rawBody, // the exact bytes that arrived, as a string or Buffer
  secrets: [process.env.WEBHOOK_SECRET!], // `whsec_...`, from the endpoint's page in the console
});
```

`parseWebhook` verifies first and returns the body parsed as JSON. It throws
`WebhookVerificationError` (with a `reason`) when the request is not genuine, and `WebhookPayloadError`
when it is genuine but not JSON. Use `verifyWebhook` instead if you want to parse the body yourself.

## What a receiver must do

1. **Verify the raw body.** The signature covers the bytes that were sent. Read the body as text or a
   Buffer _before_ any JSON parser touches it: parsing and re-serializing changes spacing and key order
   and the signature no longer matches. In Express use `express.raw({ type: '*/*' })` on the route, in
   a `Request` handler use `await request.text()`.
2. **Reject old and future requests.** The timestamp must be within five minutes of your clock
   (`toleranceSeconds` changes that). This stops a captured request from being replayed later. Keep
   your servers' clocks synchronized.
3. **Answer 2xx quickly, and do slow work afterwards.** Anything else, a timeout included, is a failed
   attempt and is retried on a schedule (immediately, then 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 10 h).
4. **Expect duplicates.** Delivery is at least once. Every attempt of a message carries the same
   `webhook-id`; remember the ids you handled (a unique key in your database, or a cache with an expiry)
   and acknowledge a repeat without doing the work again.
5. **Do not leak why you refused.** Answer 400 and log the `reason` for yourself. The error never
   contains a secret or an expected signature.

### Plain `node:http`

[`examples/node-http-receiver.ts`](examples/node-http-receiver.ts): raw body with a size limit,
verification, duplicate handling, 500 so the sender retries when your handler fails.

### Next.js, Hono, Workers, Bun, Deno (`Request` to `Response`)

[`examples/web-standard-handler.ts`](examples/web-standard-handler.ts):

```ts
// app/api/webhooks/route.ts
export const POST = createWebhookHandler({ secrets: [process.env.WEBHOOK_SECRET!], onEvent });
```

### Express

```ts
import express from 'express';
import { WebhookVerificationError, parseWebhook } from '@solmira/webhooks';

app.post('/webhooks', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
  try {
    const event = parseWebhook({ headers: req.headers, body: req.body, secrets: [secret] });
    // hand `event` to your queue or handler, then:
    res.sendStatus(204);
  } catch (error) {
    if (error instanceof WebhookVerificationError) return res.sendStatus(400);
    throw error;
  }
});
```

Mount `express.json()` for your other routes only; on this route it would replace the raw body.

[`examples/send-signed-request.ts`](examples/send-signed-request.ts) signs and sends a request, to try
a receiver locally. The examples are tested (`examples/receivers.test.ts`).

## Rotating a secret

While the platform rotates an endpoint's secret it signs every delivery with the old and the new one,
which arrive as two space-separated signatures in one header. A receiver that knows **either** secret
accepts the request, so you can switch without downtime: put the new secret in your configuration next
to the old one (`secrets: [next, current]`), wait until the window ends, then remove the old one.
`verifyWebhook` accepts a request when any signature matches any of your secrets, and ignores
signature versions it does not know (`v1a`, `v2`, ...).

## Signing (for senders and tests)

```ts
import { signWebhook } from '@solmira/webhooks';

const headers = signWebhook({ id: 'msg_123', timestamp: 1614265330, body, secrets: [secret] });
// { 'webhook-id': ..., 'webhook-timestamp': ..., 'webhook-signature': 'v1,<base64>' }
```

Pass two secrets to sign with both.

## Verifying in another language

The recipe, for a language without a library:

1. `key` = base64-decode the secret after removing the `whsec_` prefix.
2. `signed` = `webhook-id` + `.` + `webhook-timestamp` + `.` + the raw body.
3. `expected` = base64(HMAC-SHA256(`key`, `signed`)).
4. The header is a space-separated list of `version,signature`; accept if any `v1` entry equals
   `expected` (compare in constant time), and reject if the timestamp is more than five minutes from now.

The specification's reference vector, which this package's tests check:

| Input     | Value                                             |
| --------- | ------------------------------------------------- |
| secret    | `whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw`          |
| id        | `msg_p5jXN8AQM9LWM0D4loKWxJek`                    |
| timestamp | `1614265330`                                      |
| body      | `{"test": 2432232314}`                            |
| signature | `v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=` |

## Failure reasons

`WebhookVerificationError.reason` is one of `missing_headers`, `invalid_timestamp`,
`timestamp_too_old`, `timestamp_too_new` and `no_matching_signature` (wrong secret, altered body, or an
altered id or timestamp).

## Tests

`src/standard-webhooks.test.ts` and `src/specification-cases.test.ts` check the reference vector and the
behaviours the reference libraries check (empty and invalid secrets, missing and malformed headers,
partial signatures, tolerance edges in both directions, several signatures, rotation, header case,
multi-byte and empty bodies). The expected signatures in the latter are computed with `node:crypto`
from the specification's recipe, independently of this code. `pnpm --filter @solmira/webhooks test`.
