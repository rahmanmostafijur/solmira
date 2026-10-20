# ADR-0026: Signing secret storage and reveal

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

Webhook signing needs the plaintext secret at send time (HMAC), so it cannot be hashed. It must
still be unreadable from a database dump, never appear in logs, and be disclosed only deliberately.

## Decision

- **Format.** `whsec_` followed by the base64 of 32 random bytes, as the Standard Webhooks
  libraries expect.
- **Envelope encryption.** Each secret is encrypted with its own random 256-bit data key
  (AES-256-GCM). The data key is wrapped by a key-encryption key (AES-256-GCM) that never touches
  the database. Stored per secret: ciphertext, wrapped data key and the id of the key-encryption
  key that wrapped it. The organization and endpoint ids are bound as authenticated data, so a
  ciphertext copied to another row fails to decrypt.
- **Key source.** A `SecretCipher` port with a local implementation reading a base64 32-byte key
  from `SECRETS_ENCRYPTION_KEY` (development and tests). The AWS KMS implementation is added with
  the AWS deployment (Phase 12). The service refuses to start without a key.
- **Disclosure.** The secret is returned once, in the response that creates the endpoint. After
  that only `POST .../secret/reveal` returns it, and only for callers holding
  `endpoint_secrets.reveal`, which only OWNER and ADMIN have. Every reveal writes an
  `endpoint_secret.revealed` event to the outbox in the same transaction (the audit trail; the
  event never contains the secret).
- **Rotation.** The table keeps several secrets per endpoint with a status, so rotation with a
  dual-signing window (Phase 7) needs no migration.

## Alternatives considered

- **Store plaintext, rely on disk encryption.** Rejected: a SQL injection or backup leak exposes
  every secret.
- **KMS from day one.** Rejected for development ergonomics; the port keeps the switch cheap.
- **Return the secret on every read.** Rejected: it turns every read permission into secret access.

## Consequences

Losing the key-encryption key loses every secret; in AWS the key lives in KMS with its own
backup and rotation policy. Decrypting on each send is cheap; the dispatcher may cache plaintext
in memory for a short time.

## Failure, scaling, security and operational implications

Secrets are redacted by field name in logs, and no log call receives a secret. Reveal is rate
limited by the gateway like other API calls and is audited.
