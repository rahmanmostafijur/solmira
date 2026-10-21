# Delivery backlog

Alarm: `<name>-delivery-backlog-age` (the oldest due delivery has waited too long). Not yet run on AWS.

**Meaning for customers.** Webhooks are arriving later than they should. Nothing is lost: every delivery
is a row in PostgreSQL until it succeeds or exhausts its attempts.

## Find where it is stuck

Look at the dashboard in this order.

1. **Dispatcher tasks running** below the desired count, or restarting: see the service log
   `/solmira/<environment>/dispatcher` for the reason (database unreachable, decrypt failures, out of
   memory).
2. **Secret decrypt failures rising** (alarm `<name>-secret-decrypt-failures`): the dispatcher cannot
   decrypt signing secrets, so it defers those deliveries by 30 seconds instead of sending them unsigned.
   Check that the task role can use the secrets key and that the key was not disabled or replaced
   ([Key and credential rotation](key-rotation.md)).
3. **Attempts by result** shows mostly timeouts or 5xx: the receivers are failing, not the platform.
   Each endpoint has its own concurrency cap, so a failing receiver does not slow the others.
4. **Backlog size high but all workers busy** (CPU high, claims returning full batches): load exceeds
   capacity. The dispatcher scales out on `OldestDueAge` by itself up to its maximum; raise
   `services.dispatcher.max_count` if it is at the limit. Measured throughput on a development machine
   is in [docs/performance](../performance); it is not a capacity figure for AWS.
5. **Database**: CPU or connections saturated on the RDS instance (the claim query is the heaviest
   statement). Scale the instance class; do not add workers against a saturated database.

## What not to do

- Do not delete rows from the deliveries table to clear a backlog; replay is available per endpoint and
  per time range from the console and the API once the cause is fixed.
- Do not raise `dispatcher_per_endpoint_cap` to go faster: it protects receivers, and it is what keeps
  one tenant's burst from starving the others.

## Done when

`OldestDueAge` is back near zero and the alarm returns to OK. If an outage lasted long enough that
customers want deliveries repeated, they can replay a time range per endpoint.
