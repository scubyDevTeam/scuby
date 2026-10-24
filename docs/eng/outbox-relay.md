# Outbox Relay — From a Committed Write to SQS

> Backend. Design accepted 2026-10-23 as part of decision [00 · #33](../product/00-product-map.md)
> (async work goes through SQS behind a transactional outbox). Sections 1–9 are the design to
> implement. The last section, *To review at implementation*, holds proposed adjustments that are
> **not decided** — settle each one in the PR that builds the relay, and fold the outcome into
> sections 1–9 or drop it.
>
> Context: [backend.md](backend.md) · Async work (what goes on the queue and who consumes it),
> [infra.md](infra.md) (SQS, the database).

## Why an outbox at all

A business write (a sighting saved, a claim opened) and the message that tells the worker to act
on it must not diverge. Writing to Postgres and then calling SQS leaves a gap: a crash between the
two loses the message, or a failed commit after the send delivers a message about a row that does
not exist. The outbox closes the gap by writing the message **as a row, in the same transaction as
the business write**; a relay then moves committed rows to SQS. Postgres is only the hand-off — the
queue is SQS.

## 1. Pattern

**Transactional outbox + claim with a lease + DELETE on publish.**

- No CDC / Debezium.
- **Never hold a transaction or a database connection open across an SQS call.** The pool is
  small and the EC2 is shared; AWS latency must never be able to pin connections.

## 2. Table

```sql
CREATE TABLE outbox_events (
  id            uuid PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  payload_json  jsonb NOT NULL,
  locked_until  timestamptz NULL,
  attempts      int NOT NULL DEFAULT 0
) WITH (fillfactor = 70);

CREATE INDEX ON outbox_events (created_at);
```

- **Do not index `locked_until` or `attempts`**, so the lease UPDATE is a HOT update.
- **No `published_at` column: published rows are DELETEd.** In steady state the table is nearly
  empty.
- The INSERT into the outbox goes in the **same transaction** as the business write.

## 3. Relay cycle

Each event lives through exactly three statements: INSERT → lease UPDATE → DELETE.

**a) Claim** — one statement, ~2 ms:

```sql
UPDATE outbox_events
   SET locked_until = now() + interval '30 seconds',
       attempts     = attempts + 1
 WHERE id IN (
   SELECT id FROM outbox_events
    WHERE (locked_until IS NULL OR locked_until < now())
      AND attempts < 10
    ORDER BY created_at
    LIMIT 100
    FOR UPDATE SKIP LOCKED)
RETURNING *;
```

**b) Send, outside the database.** Split into chunks of 10 and send with `SendMessageBatch` in
parallel. Collect **only** the ids in `response.successful()`. Failures — partial, or a whole
chunk — are not touched: their lease expires and they are retried on their own.

**c) Delete** the published rows:

```sql
DELETE FROM outbox_events WHERE id = ANY(:succeededIds);
```

**d) Loop.** If the batch came back full (100), repeat immediately; otherwise wait for the next
tick.

## 4. Scheduling

- `@Scheduled(fixedDelay = 500ms)`, with an inner loop while batches come back full.
- No `LISTEN/NOTIFY` for now — only if latency of a few milliseconds is ever needed.
- Running the relay on several instances is safe because of `SKIP LOCKED`. **No ShedLock, no
  leader election.**

## 5. Timeouts (mandatory)

- SQS client: `apiCallAttemptTimeout = 3 s`, `apiCallTimeout = 8 s`.
- These must always be **shorter than the 30 s lease**, so a row is never re-sent while a call
  for it is still in flight.

## 6. Connections

- A **dedicated DataSource / Hikari pool for the relay**, `maximumPoolSize = 1–2`, separate from
  the application pool. Count it in the database's `max_connections` budget.
- **No `@Transactional` on methods reached by self-invocation** (`this.claimBatch()`): Spring's
  proxy does not apply. Claim and delete are one statement each and run in autocommit; if either
  ever needs several statements, use an explicit `TransactionTemplate`.

## 7. Delivery semantics

- **At-least-once.** Duplicates happen (a crash between the SQS send and the DELETE, or retries).
  **Consumers must be idempotent**, de-duplicating by the event id. The id travels in the message
  (body or message attributes).
- **No ordering guarantee** (parallel chunks + SQS Standard). A flow that needs order uses SQS FIFO
  with `MessageGroupId`, `MessageDeduplicationId` = the event id, and does not parallelize that
  group.
- Respect SQS size limits per message and per batch; a message that can never pass ends up as a
  poison message (section 8).

## 8. Poison messages

- Rows with `attempts >= 10` are excluded from the claim, so they never block the queue.
- A job counts those rows and alerts (error tracker / New Relic) for manual review or re-enqueue.

## 9. Observability

- Metrics: pending rows in the outbox, age of the oldest event, rows with `attempts >= 10`,
  events published per second, SQS failures.
- Postgres: watch `n_dead_tup` for `outbox_events` (`pg_stat_user_tables`) and set
  `idle_in_transaction_session_timeout` (e.g. 60 s). Long transactions are what stop VACUUM from
  cleaning up.

---

## To review at implementation

Proposed during the 2026-10-23 design review. **None of these is decided.** Each is a question to
answer while building the relay; record the answer in sections 1–9.

| # | Proposal | Why it might matter |
|---|---|---|
| R1 | **Exponential backoff in the lease**: `locked_until = now() + least(30 s × 2^attempts, 15 min)` instead of a flat 30 s | With a flat lease, 10 attempts span only ~5 minutes. An SQS regional incident of that length would push every pending event to `attempts >= 10`. The minimum stays 30 s, above the 8 s call timeout |
| R2 | **Treat sender faults as permanent.** A failed batch entry with `senderFault = true` (e.g. message too large) goes straight to poison instead of being retried 10 times | Retrying a malformed message cannot succeed; it only burns attempts and delays the alert |
| R3 | **Move poison rows out** to an `outbox_dead_letters` table (INSERT + DELETE in one transaction) instead of leaving them with `attempts >= 10` | Keeps the hot table nearly empty and the claim's index scan from walking dead rows on every tick; re-enqueueing becomes one statement; the alert counts that table |
| R4 | **Thin events**: the payload carries the event id, type and entity ids — not state. Consumers re-read current state from the database | Makes out-of-order delivery on SQS Standard harmless (each consumer sees the real state), so FIFO stays unnecessary |
| R5 | **Where de-duplication can and cannot hold.** A `processed_events` table works for effects inside the database, but sending a push/SMS/email is external and cannot share the transaction. For notifications, record *after* a successful send (a rare duplicate beats a lost message); pass the event id as Resend's `Idempotency-Key` | Section 7 requires idempotent consumers; this is what that means for external side effects |
| R6 | **UUIDv7 ids** (time-ordered, generated in Java — Postgres 17 has no built-in v7) | Random v4 keys fragment the primary-key index; with v7 the claim could order by `id` and the `created_at` index could go |
| R7 | **Per-table autovacuum**: `ALTER TABLE outbox_events SET (autovacuum_vacuum_scale_factor = 0, autovacuum_vacuum_threshold = 1000)` | The table is deleted from constantly; default thresholds scale with table size, which here is near zero |
| R8 | **Optional wake-up after commit**: a `TransactionSynchronization.afterCommit` hook wakes the relay in-process; the 500 ms poll stays as the safety net | Lower latency without `LISTEN/NOTIFY` |
| R9 | **Fit with the rest of the backend**: the relay bean is a worker-role component ([backend.md](backend.md) · One deployable, two roles); alerts go to the error tracker chosen in [backend.md](backend.md) · Observability | Section 8 names the alert target generically |
