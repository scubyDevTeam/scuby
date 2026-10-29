# Backend Thin Slice — Design

> Design for the backend's first slice (phase S of [backend-plan.md](../../eng/backend-plan.md)):
> sign in, publish a lost case, view it, report a sighting — 13 endpoints of the contract. Decided
> 2026-10-29. The durable parts of this design land in their owning docs as part of the
> implementation (listed at the end); this file records the whole design in one place for the plans
> that implement it.

## Scope

| Group | Endpoints |
|---|---|
| Config and session | `GET /config`, `GET /session`, `POST /auth/email/start`, `POST /auth/email/verify`, `POST /auth/google`, `POST /auth/sign-out` |
| Phone | `POST /me/phone`, `POST /me/phone/verify` |
| Photos | `POST /uploads` |
| Lost cases | `POST /lost-cases`, `GET /cases/{code}` (lost only), `GET /feed`, `POST /cases/{code}/sightings` |

Behaviour is fixed by the contract (`docs/eng/openapi.json`, `docs/eng/api.md`), by the client's
emulated backend (`web/src/mocks/`, whose scenarios in `web/src/mocks/backend.test.ts` are the
acceptance tests to port) and by the product docs (`docs/eng/auth.md`,
`docs/product/04-lost-workflow.md`). This design decides **how** the backend implements them.

**Done when:** the client, built with `VITE_API_MOCK=false` against a backend running these
endpoints, passes its sign-in, publish-lost and lost-case e2e specs; every response validates
against the contract.

## How the code is written: AI agents write, humans review

Most code is written by AI agents from task plans; the two engineers review. Human review time is
the scarce resource, so **rules fail the build instead of living in conventions**, and agent
context stays local (one package per feature).

## Package structure

Package by feature, **flat** (no layer subpackages), with Java's package-private visibility as the
default encapsulation.

```
co.scuby
├── ScubyApplication
├── platform/            technical, domain-free: roles, web (error envelope, generic wrappers),
│                        db (GeoPoint, PostGIS helpers), security (Spring Security wiring that is
│                        not identity-specific), telemetry
├── db/generated/        jOOQ classes (generated, not committed)
├── identity/            accounts, sessions, the device cookie, email code, Google, phone OTP —
│                        and the session authentication filter
├── uploads/             upload slots, presigned URLs, photo references
├── pets/                the pet record shared by every vertical
└── cases/               lost cases, sightings, feed (the generic /cases/{code} surface)
```

- **Inside a feature:** controller (`@ApiComponent`), service (transactions, orchestration), queries
  (jOOQ reads/writes), `*Facts` records, `*Derivation` pure functions, contract records (`*Dtos`
  holder or loose records). Everything package-private unless another feature needs it.
- **Cross-feature surface:** a class used from another feature must carry **`@ModuleApi`** (a
  marker annotation in `platform`). The public surface is exactly what is declared, and greppable.
- **Dependency order (a DAG):** `platform` depends on nothing of ours → foundations `identity`,
  `uploads`, `pets` depend only on `platform` (and `db.generated`) → verticals (`cases`, later
  `adoption`, `help`, `notifications`, `chat`) depend on foundations and `platform`, **never on each
  other**.
- **Reads may join any table** (`db.generated` is shared) so a view is one query; **each table has
  one writing feature** (e.g. only `cases` inserts/updates `lost_case`).
- **Side effects across features go through the outbox** (decision #33): `cases` writes an event row
  in its transaction; it never calls `notifications`.
- **Asynchronous code** stays in its feature's package, marked `@WorkerComponent` — no `worker/`
  subpackage (a subpackage cannot see package-private classes of its parent).
- **Later, when the second vertical arrives:** `cases` keeps what every case shares (the code, the
  generic `/cases/{code}` endpoints, the common part of the state machine) and defines a
  `@ModuleApi` interface `CaseKind`; each vertical package implements it with its own rules and
  derivation; Spring injects the list of implementations into `cases`. Verticals depend on `cases`,
  never the reverse. Not built in this slice (lost only).

## Responses: facts → derivation → record

A viewer-dependent response (above all `GET /cases/{code}`, which answers more to the publisher) is
built in three steps:

1. **Access, then facts (shell, I/O).** Resolve who is looking (anonymous, device, account) and the
   access level (`PUBLIC`, `OWNER`) in one policy class. Load `*Facts` with jOOQ **according to the
   access**: private facts (claims, reporters' numbers, hidden pins, pending check-in, withheld
   detail) are not queried for `PUBLIC`, so they cannot leak.
2. **Derivation (pure core).** `XDerivation.derive(facts, viewer, now)` builds the view: the
   `viewer` block, allowed actions from the state machine, the shown status, the 200 m public
   location floor, `null` for every field the viewer may not see (the contract wants `null`, not
   absent). Time and the viewer are parameters — no clock, no security context, no I/O inside.
3. **Serialization.** The derived record is the response body.

Derivations are tested with table-driven unit tests (facts + viewer → expected view) without a
database. Every viewer-dependent endpoint also has a **leak test**: as a non-owner, every owner-only
field is `null`.

## DTOs

Hand-written Java records matching the contract, kept with their feature. Every response produced by
an integration test is validated against `docs/eng/openapi.json` (the existing
`ContractValidator`). Generation was evaluated and rejected: openapi-generator turns the contract's
union types into unusable classes (spike 2026-10-29). Generic wrappers (error envelope, paging) live
in `platform.web`.

## Identity

- **Spring Security 7** with a custom authentication filter owned by `identity`: it reads the
  session cookie, resolves the account and puts it in the security context. Route rules come from
  each feature's own `SecurityRules` bean (no central file every feature edits). CSRF, CORS and
  security headers from Spring Security. `401`/`403` from Spring Security's entry points go through
  the same error-envelope mapper as everything else.
- **Sessions** (decision #37: httpOnly cookie on the API's same-site subdomain): an **opaque**
  256-bit random token; the database stores only its SHA-256, with `expires_at = created + 12
  months`. **Reading a session never writes**: no `last_seen_at`, no sliding expiry. Writes happen
  only on sign-in, sign-out, account deletion and a periodic purge of expired rows. A bounded
  in-memory cache (≈10,000 entries, 60 s TTL) sits in front of the lookup behind a `SessionLookup`
  interface; sign-out evicts locally; size `0` disables it. Rejected: JWT sessions (cannot be
  revoked before they expire — sign-out, account deletion, a stolen phone); a short JWT + refresh
  token (more code and keys for a gain we do not need at one instance).
- **Connection hygiene:** the filter's lookup runs outside any transaction (autocommit) and returns
  its connection at once; transactions live in service methods, never across a whole request.
  Tested: after an authenticated request the pool has 0 active connections, and a session read
  issues no `INSERT`/`UPDATE`.
- **Device cookie** (decision #35): opaque, only its hash stored; the row is created once; renewing
  the cookie's lifetime is a `Set-Cookie` header, not a database write.
- **Google:** the client sends Google's **ID token** (`POST /auth/google {credential}`); the backend
  verifies it (signature against Google's keys, `aud` = our client ID, `iss`, expiry) with Spring
  Security's `NimbusJwtDecoder`, finds or creates the account, and issues our own session. No OAuth
  redirect flow, no client secret.
- **Email code and SMS OTP:** behind `EmailSender` and `SmsSender`. In `local`, `test` and `staging`
  the senders write the code to the log. For e2e runs, a **fixed code for addresses on a test
  domain** (configurable, e.g. `*@e2e.scuby.test`) can be enabled — **refused at start-up in
  `prod`**. Real providers come with the domain (email leaning SES — open item O21).

## Guardrails that fail the build

1. **Derivations are pure** (ArchUnit): classes named `*Derivation` may not depend on Spring beans
   (classes meta-annotated with `@Component`), `org.springframework..`, `org.jooq..`,
   `co.scuby.db.generated..`, `java.io..`, `java.net..`, `java.nio..`, `java.sql..`, and may not call
   `Instant.now()`, `Clock.systemUTC()`/`systemDefaultZone()`, `UUID.randomUUID()`,
   `Math.random()` or construct `SecureRandom`.
2. **Roles by annotation** (ArchUnit): no `@WorkerComponent` class depends on an `@ApiComponent`
   class and vice versa (replaces the package-based rule).
3. **The DAG** (ArchUnit): verticals do not depend on each other; foundations do not depend on
   verticals; `platform` depends on no feature.
4. **Declared public surface** (ArchUnit): any class used from another feature carries `@ModuleApi`.
5. **Mutation testing** (PIT) on `*Derivation` classes, as a build step with a minimum score —
   catches tests that pass without testing.
6. **Contract conformance** on every integration-tested response, and **leak tests** for
   viewer-dependent endpoints.
7. **Acceptance:** the emulated backend's scenarios for these endpoints, ported as backend
   integration tests.

## Parallel agents without shared-file collisions

- Flyway versions are **timestamps** (`V20261029_1430__lost_cases.sql`), never sequence numbers.
- Each feature contributes its own `SecurityRules` bean.
- The slice's dependencies (Spring Security, OAuth2 resource-server JOSE, Caffeine, PIT,
  libphonenumber, AWS SDK S3) are added once, up front.
- Agent instructions live in **`backend/CLAUDE.md`** (as `web/CLAUDE.md` does for the client): the
  package rules, the facts → derivation pattern, where guardrails live, what reviewers check.

## Human review focus

Automation covers shape, architecture and test strength. Humans review: the derivation test tables
(business rules), the access policy (who sees whose phone and location), migrations (data changes
are not undone by a revert), jOOQ queries (indexes, PostGIS) and anything exposing personal data.

## Where this lands (owning docs, updated by the implementation)

- `docs/eng/backend.md`: package structure and DAG, facts → derivation, guardrails, sessions'
  no-write rule and connection hygiene, DTOs by hand.
- `docs/eng/auth.md`: session storage (opaque, hashed, 12-month absolute expiry), Google ID-token
  verification, log senders and the fixed test-domain code.
- `backend/CLAUDE.md`: agent instructions.
- `docs/product/00-product-map.md`: one decision row covering the package structure and guardrails
  (with the rejected options: by layer, by feature with layer subpackages, hexagonal, Spring
  Modulith).
