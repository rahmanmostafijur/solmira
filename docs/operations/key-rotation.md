# Key and credential rotation

Not yet run on AWS. Rotation is manual: nothing here rotates by itself except the automatic annual KMS
key material rotation described below.

## Access-token signing key (identity)

Tokens are verified against the keys identity publishes at `/api/v1/auth/.well-known/jwks.json`. A
rotation keeps the old public key published until the tokens it signed have expired
(`ACCESS_TOKEN_TTL_SECONDS`, 15 minutes by default).

1. Generate a new Ed25519 pair and a new key id (see [first deployment, step 4](first-deploy.md#4-give-identity-its-signing-keys)).
2. In the identity signing-keys secret, put the new pair in `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` and
   `JWT_KEY_ID`, and add `JWT_PREVIOUS_PUBLIC_KEYS` with the old public key:
   `[{"kid":"identity-1","publicKey":"<PEM>"}]`.
3. Force a new deployment of identity (`aws ecs update-service --force-new-deployment`). Other services
   read the JWKS and pick up the new key within the JWKS cache lifetime (a few minutes).
4. After more than one access-token lifetime, remove `JWT_PREVIOUS_PUBLIC_KEYS` and deploy identity again.

If the private key leaked, skip the overlap: publish only the new key. Every outstanding access token is
rejected and users sign in again with their refresh token or password.

## Webhook signing-secret key (KMS)

Endpoint signing secrets are encrypted with a data key wrapped by the KMS key `signing_secrets_key_arn`.

- **Automatic rotation** is on: AWS rotates the key material yearly and keeps the old material, so nothing
  changes for the application and no action is needed.
- **Replacing the key** (suspected compromise, or a policy change): create the new key in Terraform and
  point the services at it. Secrets already stored stay wrapped by the old key, so the old key must remain
  readable: put its ARN in `signing_secrets_previous_key_arns` so the task roles may still decrypt with it.
  There is **no bulk re-encryption tool yet**: old secrets stay on the old key until each endpoint's
  secret is rotated by its owner (which re-encrypts under the new key). Do not schedule the old key for
  deletion until no endpoint still depends on it.
- Rotating an endpoint's own signing secret is a product feature (dual signing during the overlap) and
  needs no operator action.

## Database role passwords

The bootstrap task sets each role's password from the bootstrap secret.

1. Change the password in the Secrets Manager secrets (the bootstrap secret and the service secret that
   holds the connection URL).
2. Run the `bootstrap` task again; it is idempotent and applies the new passwords.
3. Force a new deployment of the affected services so they pick up the new URLs.

Between steps 2 and 3 connections made with the old password fail; do it in a quiet period. The RDS master
password is managed by RDS in Secrets Manager.

## Broker and cache credentials

Change them in the Amazon MQ user and the ElastiCache auth token as the services' secrets require, update
the secrets, then force new deployments. ElastiCache auth token rotation is AWS's two-step procedure
(set, then update clients); follow the AWS documentation before doing it.

## After any rotation

Confirm sign-in works, one test message is delivered, and the dashboard shows no new errors.
