# ADR-0040: Record the delivery state before the attempt history

- **Status:** Accepted (amends ADR-0031)
- **Date:** 2026-10-22

## Context

ADR-0031 ordered the effects of an attempt as: send, write the attempt to the history (DynamoDB),
then update the delivery in PostgreSQL. A history write is tried up to three times with growing
delays before the worker gives up on it, so the delivery stayed `in_progress` for as long as the
history store took, even though the receiver had already answered.

The console showed "1 sending" for a message whose receiver had answered `200`. Two things combined:
this lag, and a console that did not reload when its realtime feed first connected (an event sent
before the connection joined was never replayed). The console is fixed separately; this record is
about the lag.

The order also decides what a worker crash costs. A crash after the send and before the state is
recorded sends the same attempt again (at-least-once). Every millisecond between the send and the
state commit is a millisecond in which a crash causes a repeat send.

## Decision

Send, record the outcome in PostgreSQL (state, endpoint health and the `delivery.attempted` event in
one transaction), then write the history. The history is written only when the outcome was applied,
so a stale worker whose result was refused writes nothing.

## Alternatives considered

- **Keep the order, without history retries.** Shortens the lag, but a slow history store still
  delays the state, and a transient error loses the record anyway.
- **Write both in parallel.** The state can be committed while the history write fails, as with the
  chosen order, and the code is harder to reason about. No gain.
- **Write the history from the `delivery.attempted` event in a consumer.** The event carries no
  response body (on purpose, ADR-0035), so a consumer could not write a complete record.

## Tradeoffs

A worker that crashes between the state commit and the history write leaves an attempt that the
state counts and the history does not show. The inspector already degrades when history is missing
(ADR-0034), and the window is a few milliseconds instead of the whole history write.

## Consequences

- The delivery is `succeeded` (or `pending` for a retry, `failed` at the end) as soon as PostgreSQL
  commits, which is also when the realtime event exists.
- The duplicate-send window after a crash is shorter.
- `apps/dispatcher/test/dispatch-history.integration.test.ts` proves that the state is recorded while
  the history write is still in flight.

## Failure, scaling, security and operational implications

No change to tenant isolation, signing or stored data. A history outage still never blocks delivery;
the alarms on the history table (throttling, errors) keep their meaning.
