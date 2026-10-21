# Security review (Phase 12)

A review of the platform as it stands at the end of Phase 12: the application, its configuration for AWS,
and the operating procedures. It lists what was checked, what was found, and what is still open. **Nothing
has been deployed**, so every statement about AWS is about the configuration, not about a running system.

## What was checked, and how

| Area                             | Method                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tenant isolation                 | Database-level tests as the runtime role (no context sees no rows; another tenant sees none) and HTTP cross-tenant tests per resource, run in CI |
| SSRF and outbound requests       | Tests of URL validation, the address deny list, DNS pinning and redirect refusal (Phases 4 and 6)                                                |
| Webhook signatures and secrets   | Signature tests; envelope encryption tests with a fake key service; the KMS encryption-context binding                                           |
| Authentication and authorization | Tests for token rotation, reuse detection, lockout, permission guards and the audit trail's append-only trigger                                  |
| Infrastructure configuration     | `terraform validate`, an offline plan, and the Trivy configuration scanner over `infra/terraform`; IAM policies and security groups read by hand |
| Dependencies                     | `pnpm audit --prod --audit-level=high` in CI                                                                                                     |
| Failure behavior                 | Chaos tests (the scenarios in `docs/resilience`) against the local stack                                                                         |

Not done: a penetration test, a review by someone who did not write the code, scanning of the built images
for vulnerabilities, and any test against AWS.

## Infrastructure scanner

Trivy first reported 8 findings on the Terraform. The configuration was changed to remove the ones it
could; the others are suppressed next to the resource with a reason, and are listed here. The scan is now
clean with those six suppressions.

| Check    | Resource                   | Decision                                                                                                                                                             |
| -------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AWS-0053 | Public load balancer       | Accepted. The console and the API are public by design; exposure is limited to TLS 1.3, the WAF and security groups that let only the load balancer reach tasks.     |
| AWS-0089 | Access-log bucket          | Accepted. The bucket holds access logs only and expires them; logging the log bucket adds a bucket to log the bucket. Account-level data-event logging is open (F6). |
| AWS-0132 | Access-log bucket key      | Accepted. Load balancer log delivery supports only S3-managed keys.                                                                                                  |
| AWS-0176 | RDS instance               | Open as F3: database IAM authentication is not used; roles use passwords from Secrets Manager over verified TLS.                                                     |
| AWS-0070 | Amazon MQ broker           | Accepted. Audit logging exists only for ActiveMQ; the RabbitMQ engine's general logs are on and administration is through IAM.                                       |
| AWS-0104 | Task egress to `0.0.0.0/0` | Accepted for the dispatcher as F7: it must reach any address a customer registers. The controls that matter are in the application.                                  |

## Findings

Severity is the author's judgment of the risk if the thing were deployed as it is. Status: **Fixed** in this
phase or earlier, **Accepted** with a reason, **Open** (should be done before production).

| #   | Finding                                                                                                                                                                                                                                         | Severity | Status                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- |
| F1  | After a KMS key is replaced, old signing secrets stay under the old key; there is no bulk re-encryption tool. The old key must stay readable (`signing_secrets_previous_key_arns`) and cannot be deleted until each endpoint secret is rotated. | Medium   | **Open.** Documented in [key rotation](operations/key-rotation.md).                                                     |
| F2  | The identity service's JWKS is fetched over HTTP inside the VPC (Cloud Map). An attacker on the private network who could impersonate identity could publish a key. Task security groups restrict who can reach identity.                       | Medium   | **Accepted** for a private network with restricted groups; **Open** to serve it over TLS.                               |
| F3  | The database is accessed with passwords, not IAM authentication. Passwords are per role, in Secrets Manager, over `verify-full` TLS.                                                                                                            | Low      | **Open**                                                                                                                |
| F4  | Generated passwords (database, broker, cache) are in the Terraform state.                                                                                                                                                                       | Medium   | **Accepted** with the state bucket private, encrypted and versioned ([Terraform README](../infra/terraform/README.md)). |
| F5  | Rotation of passwords and tokens is manual; only the KMS key material rotates by itself.                                                                                                                                                        | Low      | **Open.** Procedures in [key rotation](operations/key-rotation.md).                                                     |
| F6  | CloudTrail, GuardDuty, AWS Config and Security Hub are account-level services and are not defined here; access to the log bucket is not recorded without them.                                                                                  | Medium   | **Open.** Out of this repository's scope; required before production.                                                   |
| F7  | The dispatcher can reach any address (it delivers to customer URLs). The protection against reaching internal addresses is in the application (URL checks, DNS pinning, no redirects), not in the network.                                      | Medium   | **Accepted** as defense in the application; **Open** to add network-level egress filtering.                             |
| F8  | The images are not scanned for vulnerabilities in CI; only the dependency audit runs.                                                                                                                                                           | Medium   | **Open**                                                                                                                |
| F9  | No multi-factor authentication for console users.                                                                                                                                                                                               | Medium   | **Open**                                                                                                                |
| F10 | Registration answers `409` for an existing email, and anyone who knows an email can lock that account for 15 minutes.                                                                                                                           | Low      | **Accepted**, documented in [SECURITY.md](../SECURITY.md).                                                              |
| F11 | The defaults use a single-instance broker and one cache node, and the database is not Multi-AZ unless set, for cost. An availability limit, not a confidentiality one.                                                                          | Medium   | **Accepted** for a demonstration; **Open** for production (variables exist).                                            |
| F12 | The IAM policies, security groups and WAF rules have been read and planned but not exercised on AWS; a mistake that only AWS would reveal (a missing permission, a blocked path) is possible.                                                   | Medium   | **Open.** First deployment in a non-production account.                                                                 |
| F13 | The runbooks have not been run. See [operations](operations/README.md).                                                                                                                                                                         | Medium   | **Open**                                                                                                                |
| F14 | No security contact is defined for reporting vulnerabilities.                                                                                                                                                                                   | Low      | **Open**                                                                                                                |

## Fixed during the project (for the record)

- A signing secret that cannot be decrypted defers its delivery; it is never sent unsigned.
- The key service binds each secret to its endpoint with an encryption context, and task role policies
  carry a condition on the context's purpose.
- The RDS certificate bundle is pinned by checksum in the images; a changed download fails the build.
- Database roles: the runtime role cannot own tables or bypass row-level security (readiness checks it)
  and cannot modify the permission catalog; the audit table refuses updates and deletes by the runtime role.
- Services connect to the database with certificate verification, and the database is configured to refuse
  unencrypted connections (`rds.force_ssl`).
- Claims for delivery are serialized, which made the per-endpoint and per-tenant caps exact across workers
  (ADR-0037), removing a way for one tenant's burst to starve others.

## Before production

Close F6 (account-level logging and detection), F12 and F13 (deploy to a non-production account and
exercise the runbooks), F8 (image scanning), and decide F1, F2 and F9. The rest can follow.
