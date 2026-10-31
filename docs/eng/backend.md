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
| Rate limiting | Counts over the rows themselves (rolling windows with SQL, indexed where measured) — the limits in this slice key on rows that exist anyway (sends, sightings, uploads). **Bucket4j** with its Postgres store if a limit ever needs tokens without rows |
| Phone numbers | libphonenumber ([auth.md](auth.md)) |
| Observability | **OpenTelemetry → New Relic** (traces, metrics, logs over OTLP); **Sentry** for errors |
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

## Code structure

*Decided 2026-10-29 — decision #40 ([00](../product/00-product-map.md)).* Agent-facing rules:
[`backend/CLAUDE.md`](../../backend/CLAUDE.md).

**Package by feature, flat, package-private by default.** `co.scuby.platform` is technical and
domain-free (roles, web envelope, PostGIS helpers, security wiring, flags, time, cache, config, crypto, module annotations); foundations
`identity`, `uploads`, `pets` depend only on `platform`; verticals (`cases` today) depend on
foundations and `platform`, never on each other. A class used from another feature carries
`@ModuleApi`; everything else stays package-private. Reads may join any table; each table has one
writing feature; cross-feature side effects go through the outbox. Background code stays in its
feature, marked `@WorkerComponent`. When a second vertical arrives, `cases` keeps what every case
shares and defines a `@ModuleApi` `CaseKind` each vertical implements.

**Viewer-dependent responses: access → facts → derivation → record.** One policy decides the
access (`PUBLIC`, `OWNER`); facts are loaded according to it, so private facts are never queried
for the public; a pure `*Derivation` (time and viewer as parameters) builds the response; the
record is serialised. Request/response records are written by hand next to their feature
(generation was rejected: openapi-generator turns the contract's unions into unusable classes).

**Guardrails that fail the build:** ArchUnit (derivation purity — no Spring, jOOQ, I/O, clock or
randomness; roles by annotation, including that every `@RestController` is an `@ApiComponent` and every
`@Scheduled`/`@SqsListener` method sits in a `@WorkerComponent`; the DAG; the declared surface), PIT
mutation testing on derivations (≥ 80 %), contract conformance of every response an integration test
produces, contract coverage (every controller route is in `openapi.json`; every implemented session
route refuses an anonymous caller with `401`), a test client whose `raw()` refuses a documented
contract path (`unchecked(…, reason)` is the explicit escape), leak tests on viewer-dependent
endpoints, statement-count ceilings per request (an N+1 fails the test), plan checks on
growth-sensitive queries only, a check that every table is either reset between tests or declared
reference data, and a test on the migration file names. **Enforced by review, not the build:**
indexes only with a measured plan and human approval, one writing feature per table, cross-feature
side effects through the outbox, and viewer logic staying inside `*Derivation` classes.

**Migrations** (decision #44). Flyway versions are timestamps (`V20261029_1430__what.sql`; the
original `V1` and `V2` predate the rule). `spring.flyway.out-of-order` is on, so a migration written
earlier than one already applied still runs when its branch merges later; the cost is that
migrations from parallel branches must not depend on each other's order. `MigrationNamesTest`
enforces the file-name pattern and the property.

**No network call inside a transaction** (decision #45). The Google token is verified before the
sign-in transaction opens (a slow JWKS fetch would otherwise hold a pooled connection and the locks
for its whole length). Email and SMS codes are sent after the transaction that stores them commits
(email: stored in one transaction, then delivered; SMS: registered to run after commit, so a publish's
outer transaction is waited for too). A send that fails after the commit leaves an unused code and a
`server_error`; the person asks for another.

## Security

One Spring Security filter chain, stateless (`platform.security`): no HTTP session, form login,
basic auth or logout filter. Features declare their own route rules (`SecurityRules` beans). The
authentication filter is domain-free and lives in `platform`; `identity` supplies who is signed in
through a `RequestAuthenticator` (so `platform` depends on no feature). `401`/`403`, and a `500`
when the authenticator fails (the database is down), come in the contract's envelope through the
same mapper as every other error.

**CSRF without a token** (the client sends none): an unsafe request (`POST`/`PUT`/`PATCH`/`DELETE`)
whose `Origin` is not an allowed client origin, or that has no `Origin` but `Sec-Fetch-Site:
cross-site`, is `forbidden`. The check runs before CORS, so the refusal comes in the envelope; a
cross-origin `GET` from a non-allowed origin still gets CORS's plain-text `403`. `SameSite=Lax`
cookies are the second layer. Rejected: Spring's token CSRF (needs a contract change for no gain
here); `SameSite` alone (a sibling subdomain is same-site). **CORS** allows only the client's
origins (`scuby.web.allowed-origins`), with credentials.

**Cookie tossing** (a sibling subdomain setting cookies for the parent domain): how the session cookie resists it, and why the `device` cookie cannot yet, is in [auth.md](auth.md) · Known limitations and risks.

**Caching:** every response carries `Cache-Control: no-cache, no-store, max-age=0, must-revalidate`
(Spring Security's default, kept on purpose): answers are per viewer, and a CDN must never store
one. An endpoint that wants caching sets it explicitly and says why.

**Deployed profiles are configured, never defaulted:** outside `local` and `test`, start-up is
refused without the allowed origins, the IP-hash key, the code-hash key and the Google client ID (each
key non-blank, at least 32 characters and not the shipped default); a deployed profile combined with
`local` or `test` (`staging,local`) is still deployed;
under `prod` also without the origin secret (under `staging` a missing one is a start-up warning:
every per-IP limit would key on CloudFront's address). A start-up test keeps every deployed profile
startable with exactly those settings. Infra must also put `logServerErrorDetail=false` on the JDBC URL of
deployed profiles: otherwise pgjdbc copies the failing row (which can hold an email, a phone or a code
hash) into exception messages, and the API logs those. The URL comes from infra; nothing in this repo sets it.

**Client IP** (a rate-limit key): `CloudFront-Viewer-Address` only when the request carries the
origin secret header, else the socket address. IPs are stored only as an HMAC.

**Device cookie** (decision #35): only its SHA-256 is used; it is set when missing and renewed on
unsafe requests by a `Set-Cookie` header. There is no `device` table: the hash is stored on the rows
that need it, so reads never write. A table arrives with the first consumer of device-level data.

## Sessions

An **opaque** 256-bit token in the `__Host-session` cookie (decision #37); the database stores only
its SHA-256, with `expires_at` = sign-in + 12 months (absolute); the cookie's `Max-Age` is computed
from that `expires_at`, so both end together. **Reading a session never writes** — no
`last_seen_at`, no sliding expiry; writes happen on sign-in, sign-out, account deletion and a daily
purge. A bounded in-process cache (10,000 entries, 60 s) sits in front of the lookup behind
`SessionLookup`; sign-out evicts locally; size `0` disables it. The lifetime is decision #43. **Connection hygiene:** the lookup
runs outside any transaction and returns its connection at once; transactions live in service
methods, never across a request — a test asserts the lookup ran in autocommit, the pool had 0 active
connections when the controller started (sampled during the request, not after it), no servlet
session was created, and a session read issues no `INSERT`/`UPDATE`. Rejected: JWT sessions (cannot be revoked
before they expire — sign-out, account deletion, a stolen phone); a short JWT plus refresh token
(more code and keys for nothing at one instance).

## Uploads and media

`POST /uploads` records who took a slot for which photo and purpose (account when signed in, else
device) and answers where to PUT the bytes. A publish or sighting attaches only photos its caller
took a slot for, for that purpose, within 24 h, and whose bytes are processed. Bytes go through a
`MediaStore`: **S3** in staging and production (a presigned PUT into `incoming/` signed with the
photo's SHA-256; "processed" = the ingest Lambda wrote `media/{sha}.jpg` — [infra.md](infra.md) ·
Media), a **development directory** in `local` and `test` (a dev-only `PUT/GET /dev-media/{sha}.jpg`
that checks the hash and counts as processed at once; refused under `prod`). At most 20 slots per
caller per 10 minutes (count then insert without a lock: concurrent requests can exceed it by the
number in flight — accepted, a slot is only a row).

S3 calls never run inside a database transaction: the attach check (`PhotoAttachments`, a HeadObject
per photo in S3 mode) runs before the publish or sighting opens its transaction, and refuses to run
inside one. The instance role needs `s3:PutObject` on `incoming/*` (through the presign),
`s3:GetObject` on `media/*` and `s3:ListBucket` on the bucket with prefix `media/` — without
ListBucket, HeadObject on a missing key answers 403 instead of 404 and every first upload fails.
The bucket's CORS allows `PUT` from the web origins with the headers `content-type`,
`content-length` and `x-amz-checksum-sha256`.

**Handoff to the infrastructure doc.** [infra.md](infra.md) must pick up, for staging and for
production (production refuses to start without them): the environment variables
`SCUBY_MEDIA_BUCKET`, `SCUBY_MEDIA_REGION` and `SCUBY_MEDIA_PUBLIC_BASE_URL`; the instance-role
permissions above; and the bucket's CORS rule above. The presign path has not been run against a
real bucket yet.

**Known limitation.** "Uploaded by this caller" means "took a slot for this hash". Every public
photo URL contains its hash, so anyone can take a slot for a photo they have seen (the answer is
`upload: null`) and attach it to their own case or sighting. Enforcing a fresh upload (refusing
`upload: null` slots for `pet`, `claim` and `evidence`) is an open question for when it matters.

## Place names

`place_name` is computed once at publish by a `PlaceNamer` and stored on the case. Behind the flag
`reverse_geocoding` (off): while off, or when the namer has no answer, nothing is stored and the
response carries a generic label in the request's language («Zona marcada en el mapa»). No provider
is wired yet; the comparison is in `docs/superpowers/specs/2026-10-30-place-names-spike.md`.

## Rate limits on rows

A rate limit is a count over the rows the action writes anyway — one indexed query per key, over a
rolling window — never a separate counter table. Where a limit must hold under parallel requests
(«Lo vi»), the count and the insert run in one transaction behind transaction-scoped advisory locks
on each key, always taken in the same order (reporter, then IP) so two requests cannot wait on
each other. The numbers live with their flows: «Lo vi» in [04](../product/04-lost-workflow.md) ·
Validation, SMS in [auth.md](auth.md) · OTP mechanics, upload slots above.

## Migrations and indexes: partial indexes need literals

A query served by a partial index (`… WHERE status = 'active'`) writes that predicate as a literal
(`DSL.inline("active")`), never a bind value: with `$1` Postgres cannot prove the index predicate
under a generic prepared plan and falls back to a sequential scan. Plan checks run on inlined SQL,
so they would not catch it.

## Testing

- **Integration tests are the default** for anything touching the database, a queue or a provider:
  Testcontainers singletons (Postgres with PostGIS — the project image, see [infra.md](infra.md)
  · Database), ElasticMQ, WireMock.
- **Contract conformance** as above.
- **Statement ceilings and plan checks** (*Code structure*): every endpoint test counts SQL
  statements per request; growth-sensitive queries get a plan check against seeded volume.
- **Behaviour parity:** the scenarios in `web/src/mocks/backend.test.ts` describe what the emulated
  backend does; the real backend has a test for each one it implements.
- **Acceptance of the plug:** the client's Playwright suite runs green against a deployed backend
  ([api.md](api.md) · Plugging in the real backend).

## Observability

- **OpenTelemetry** (Spring Boot's built-in support) exports traces, metrics and logs over OTLP to
  **New Relic** (free tier). No proprietary agent and no log-shipping sidecar: both cost RAM the
  instance does not have.
- **Sentry** for errors — the client already uses it, so one tool covers both and a trace crosses
  from the browser into the API.
- Health: Spring Boot Actuator.

## What the backend owns

Everything the emulated backend simplifies — uploads, reverse geocoding, rate-limit keys,
matching, the follow-up loop as scheduled jobs, deliveries, nearby alerts, Twilio Conversations —
is listed in [api.md](api.md) · What the emulated backend does — and does not. That table is the
backend's scope; this doc does not restate it.
