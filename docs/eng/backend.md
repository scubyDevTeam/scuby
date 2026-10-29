# Backend — Architecture

> Architecture doc. Decided 2026-10-23. Decision log rows:
> [00 · #30 (stack), #31 (infra), #32 (media), #33 (async)](../product/00-product-map.md). Covers
> the API server and its background work. Where it runs, how it is deployed and what AWS pieces
> exist: [infra.md](infra.md). The order of the work: [backend-plan.md](backend-plan.md). What the
> API answers: [api.md](api.md) and its OpenAPI document.

## The decision in one line

**One Java deployable with two roles.** A Spring Boot application that serves the HTTP API
(`api` role) and does the background work — queue consumers, the outbox relay, scheduled jobs —
(`worker` role). Today one process runs both; splitting them later is a configuration change, not
a rewrite.

**Why:** two engineers, ~10–15 h/week. Java is the backend engineers' strongest language, so it
is the fastest one to ship in. One deployable keeps a small EC2 enough; the role split keeps the
door open without paying for it now.

## Stack

| Concern | Choice |
|---|---|
| Language | **Java 25** (current LTS) |
| Framework | **Spring Boot 4.1.x**; move to each new minor as it ships. **Virtual threads on** (`spring.threads.virtual.enabled=true`) — the work is I/O-bound (Postgres, SQS, Twilio, Resend, Web Push) |
| Database | **PostgreSQL 17 + PostGIS**; `pgvector` when photo matching arrives ([O7](../open-items.md)) |
| Migrations | **Flyway** — the only way the schema changes |
| Data access | **jOOQ** (open-source edition), reads and writes — *Data access* below |
| Queue | **Amazon SQS** behind a transactional outbox — *Async work* below |
| Scheduled jobs | **db-scheduler** (state in Postgres, cluster-safe) — cron-style work only |
| Rate limiting | **Bucket4j** with its Postgres-backed store |
| Phone numbers | libphonenumber ([auth.md](auth.md)) |
| Observability | **OpenTelemetry → New Relic** (traces, metrics, logs from INFO over OTLP); **stdout (WARN and up) → CloudWatch Logs** as the crash record; **Sentry** for errors |
| Tests | JUnit 5, **Testcontainers** (one static container per JVM, started lazily and wired with a `DynamicPropertyRegistrar`, not a Spring bean, so closing a test context cannot stop it), **WireMock** for Twilio/Resend/Google, **ElasticMQ** for SQS |
| Container image | **Jib** — builds the ARM64 image without Docker or QEMU on any CI runner |
| Build | **Maven** with the wrapper committed (`backend/mvnw`); Java version pinned for jenv in `backend/.java-version` |

Pin exact versions at scaffold time; this table goes stale faster than the ecosystem.

### Rejected

| Decision | Rejected & why |
|---|---|
| Java + Spring | **Rails** (assumed by early docs; nobody on the backend is fastest in it). **TypeScript/Node** (could share the client's Zod schemas, but a third language for the backend engineers). **Supabase / BaaS** (conflicts with server-side OTP, backend-only flags and "server decides") |
| jOOQ for writes too | **Spring Data JDBC for writes + jOOQ for reads** — the writes here are not CRUD: guarded state transitions, `ON CONFLICT` replays, `SKIP LOCKED` claims. Two mapping layers would be two ways to do the same thing |
| SQS | **Postgres as the queue** (works at launch volume, but a pattern to migrate away from exactly when it hurts). **Redis pub/sub** (fire-and-forget: a message published while nobody listens — a deploy, a restart — is lost; no retries). **Redis Streams** (durable, but a broker to run on the instance's RAM) |

---

## One deployable, two roles

| Role | What runs |
|---|---|
| `api` | The HTTP server and controllers |
| `worker` | SQS consumers, the notification orchestrator and channel senders, the outbox relay, db-scheduler |

**Roles are properties; beans are conditional on them.** Two meta-annotations carry the condition,
so the property name is written once:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Component
@ConditionalOnProperty(name = "scuby.roles.worker", havingValue = "true", matchIfMissing = true)
public @interface WorkerComponent {}
```

`@ApiComponent` is the same on `scuby.roles.api`. `matchIfMissing = true` means a missing setting
(a test, a new environment) turns a role **on**, never silently off.

**Profiles bundle the settings for a role.** `application-worker.yml` sets `scuby.roles.api=false`
plus what that role needs — its Hikari pool size, and the web application type. A Spring profile
says *how* things are configured; a role says *which parts* run. They combine:
`SPRING_PROFILES_ACTIVE=prod,worker`.

Rules:
- **Worker code never depends on API code** (controllers, HTTP session) and vice versa. Both
  depend on the domain and data access. Enforced by an architecture test (ArchUnit) once the
  modules exist.
- **db-scheduler's scheduler is created by its starter**, not by our components: an `api`-only
  instance must turn it off with the starter's `enabled` property, or it will run jobs.
- **Annotating controllers does not stop the web server.** A worker-only instance either sets
  `spring.main.web-application-type=none` (no HTTP at all) or keeps HTTP for Actuator health on an
  internal port. Decided the day the roles are split, by what the health check needs.

**When to split:** when API latency rises during delivery bursts, or the two need to scale at
different rates. The split is a second instance of the same image with `scuby.roles.api=false`.

## Environments and profiles

| Environment | Profile | Where |
|---|---|---|
| Local | `local` | Laptop; database from Docker Compose or Testcontainers |
| Test | `test` | CI; Testcontainers |
| Staging | `staging` | The AWS EC2, Postgres in Docker on the same instance ([infra.md](infra.md)) |
| Production | `prod` | The AWS EC2 + RDS ([infra.md](infra.md)) |

Each is combined with the role profiles (`api`, `worker`) once they are split.

Two profiles switch telemetry on; the `staging` and `prod` groups pull in both:

- **`newrelic`** — the three OTLP exports (traces, metrics, logs) to New Relic. Off in `local` and
  `test`; on a laptop it is opt-in as `local,newrelic`. Needs the license key
  ([infra.md](infra.md) · Secrets); without it the application does not start.
- **`server`** — the console prints structured JSON (ECS) at WARN and up, the crash record that
  [infra.md](infra.md) · Logs ships to CloudWatch.

Trace sampling is `management.tracing.sampling.probability` (1.0 to start). The why is in ·
Observability below.

## Configuration

**Build once, configure at start-up.** The image carries no environment-specific values and no
secrets, so the same image moves from staging to production.

| What | Where |
|---|---|
| Non-secret config (timeouts, pool sizes, public URLs, feature defaults) | `application.yml` + `application-{profile}.yml` in the repo |
| Secrets (Twilio, Resend, VAPID keys, database password, Google client secret, Sentry DSN) | **AWS SSM Parameter Store**, read at start-up — layout and rules in [infra.md](infra.md) · Secrets |
| Local secrets | `application-local.yml` + a git-ignored `.env` |

Feature flags are not configuration: they live in the database and are evaluated per request
([feature-flags.md](feature-flags.md)).

---

## Data access

**jOOQ for reads and writes**, with generated classes from the schema Flyway produces.

- **Reads:** every query is jOOQ — DTO projections, dynamic filters, the feed, spatial queries.
- **Writes:** jOOQ DSL with explicit statements. A state transition is
  `UPDATE … SET status = :to WHERE id = :id AND status = :from`; zero rows updated is the
  `invalid_transition` (409) of [api.md](api.md) · Errors. The «Lo vi» replay key is an
  `INSERT … ON CONFLICT`. `UpdatableRecord` only where a write really is plain CRUD (the profile).
- **Transactions:** Spring's `@Transactional` over the jOOQ `DSLContext`. Mind self-invocation —
  a `this.` call skips the proxy; use `TransactionTemplate` there.
- **PostGIS:** jOOQ's spatial support is a commercial-edition feature, so the open-source edition
  gets a small hand-written layer: plain-SQL templates for the few functions used (`ST_DWithin`,
  `ST_Distance`, `ST_MakePoint`, …) and one custom `Binding` for `geography`, in one place.
- **Code generation** runs against a real Postgres migrated by Flyway (Testcontainers in the
  build), so generated code always matches the migrations.

## Async work

```
business write + outbox row (one transaction)
        │
        ▼
outbox relay ──▶ SQS `notifications` ──▶ notification orchestrator ──▶ channel senders
 (worker)          (+ DLQ)                 ladders, quiet hours,          push · email · SMS
                                           coalescing (comms.md)
```

- **SQS is the queue** for work that must happen exactly once from the user's point of view and
  may need retries: notification deliveries first. Each queue has a dead-letter queue.
- **The outbox** makes "the row is saved" and "the message will be sent" one atomic fact. Design:
  [outbox-relay.md](outbox-relay.md).
- **Orchestration is ours** (decision #17, [comms.md](comms.md)); providers are dumb pipes. The
  orchestrator decides channel, timing and coalescing; senders only send.
- **db-scheduler is for time-driven work only:** check-in schedules, expiry, purges, the
  poison-message count. A job that produces messages writes outbox rows like any other write.
- **Fan-out** (one domain event consumed by several independent systems — matching, metrics) is
  SNS → several SQS queues. Not built until a second real consumer exists.
- **Real-time** is not needed: chat polls or goes through Twilio ([comms.md](comms.md)).

## The API contract

Today the contract is written in the client — `web/src/contracts/api.ts` generates
[`openapi.json`](openapi.json) (decision #24, [api.md](api.md)). The backend implements that
document:

- Request/response classes are Java records matching the document.
- **An integration test validates every response the backend produces against `openapi.json`**
  (JSON Schema 2020-12 validator, since the document is OpenAPI 3.1). Not matching the contract
  turns CI red.
- Swagger UI may serve the committed document for exploration. The backend **never generates** a
  competing document from annotations.

The source of truth moves to a neutral `openapi.yaml` both sides generate from, in two stages
(decision #34, [api.md](api.md) · Where the contract lives); the document stays committed and the
backend still never generates a competing one.

## Testing

- **Integration tests are the default** for anything touching the database, a queue or a provider:
  Testcontainers singletons (Postgres with PostGIS — the project image, see [infra.md](infra.md)
  · Database), ElasticMQ, WireMock.
- **Contract conformance** as above.
- **Behaviour parity:** the scenarios in `web/src/mocks/backend.test.ts` describe what the emulated
  backend does; the real backend has a test for each one it implements.
- **Acceptance of the plug:** the client's Playwright suite runs green against a deployed backend
  ([api.md](api.md) · Plugging in the real backend).

## Observability

Decision [00 · #38](../product/00-product-map.md). Two sinks, split by log level so nothing is paid
for twice:

| Signal | Emitted as | Goes to | Why |
|---|---|---|---|
| Traces, metrics | OTLP (OpenTelemetry, Spring Boot's built-in support) | **New Relic** (US, `otlp.nr-data.net`), license key from SSM | 100 GB/month free; traces are the bulk of the volume |
| Logs, INFO and up | OTLP log records, with `trace_id`/`span_id` | **New Relic** | The day-to-day view: a log opens from its trace |
| Logs, WARN and up | **Structured JSON on stdout** (`logging.structured.format.console`) | **CloudWatch Logs** through Docker's `awslogs` driver ([infra.md](infra.md) · Logs) | The crash record: what is written before OpenTelemetry starts (a failed migration, a bad config) only reaches stdout; it sits beside the Lambdas' logs |

- **No agent, no sidecar.** OTLP is sent by the application; stdout is shipped by Docker itself.
  Both cost no RAM the instance does not have.
- **Vendor-neutral on purpose.** OTLP and JSON-on-stdout are standards: moving to another backend
  (Grafana Cloud, Loki, Honeycomb…) is an endpoint and a log-driver change, not code.
- **Budget guards.** Logs at INFO with no per-request access log (traces cover requests); trace
  sampling is a property (start at 100%, lower to 10–25% when volume demands); a New Relic usage
  alert at 50 and 80 GB/month and a CloudWatch alarm on incoming log bytes (dashboards and alerts
  are code — [infra.md](infra.md) · Observability as code).
- **Local and test** export nothing; stdout shows everything at INFO.
- **Sentry** for errors — the client already uses it, so one tool covers both and a trace crosses
  from the browser into the API.
- Health: Spring Boot Actuator.

## What the backend owns

Everything the emulated backend simplifies — uploads, reverse geocoding, rate-limit keys,
matching, the follow-up loop as scheduled jobs, deliveries, nearby alerts, Twilio Conversations —
is listed in [api.md](api.md) · What the emulated backend does — and does not. That table is the
backend's scope; this doc does not restate it.
