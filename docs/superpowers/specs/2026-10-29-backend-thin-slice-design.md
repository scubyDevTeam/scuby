# Backend Thin Slice — Design

> Design for the backend's first slice (phase S of [backend-plan.md](../../eng/backend-plan.md)):
> sign in, publish a lost case, view it, report a sighting — 15 endpoints of the contract. Decided
> 2026-10-29. The durable parts of this design land in their owning docs as part of the
> implementation (listed at the end); this file records the whole design in one place for the plans
> that implement it.

## Scope

| Group | Endpoints |
|---|---|
| Config and session | `GET /config`, `GET /session`, `POST /auth/email/start`, `POST /auth/email/verify`, `POST /auth/google`, `POST /auth/sign-out` |
| Phone and profile | `POST /me/phone`, `POST /me/phone/verify`, `GET /me/profile` |
| Photos | `POST /uploads` |
| Lost cases | `POST /lost-cases`, `GET /cases/{code}` (lost only), `GET /feed`, `POST /cases/{code}/sightings`, `GET /me/cases` |

The two reads `GET /me/profile` and `GET /me/cases` were added on 2026-10-29: the client's sign-in and
publish e2e specs open the profile page and «Mis casos», so the "done when" below cannot pass
without them; both read data the slice already creates.

Behaviour is fixed by the contract (`docs/eng/openapi.json`, `docs/eng/api.md`), by the client's
emulated backend (`web/src/mocks/`, whose scenarios in `web/src/mocks/backend.test.ts` are the
acceptance tests to port) and by the product docs (`docs/eng/auth.md`,
`docs/product/04-lost-workflow.md`). This design decides **how** the backend implements them.

**Done when:** the client, built with `VITE_API_MOCK=false` against a backend running these
endpoints, passes its sign-in, publish-lost and lost-case e2e specs; every response validates
against the contract. Expected failures, documented and out of this slice: the specs that sign in
with Google (`@AUTH-002`, `@PLOST-002`, `@PLOST-004` — Google in e2e needs a real credential) and
`@LINK-001` (needs `/me/pets`, reopening, editing and claims — the next phase).

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

- **Spring Security 7** with a custom authentication filter. The filter mechanism is domain-free and
  lives in `platform.security`; `identity` supplies a `RequestAuthenticator` (an interface
  `platform` defines) that reads the session cookie and resolves the account, and the filter puts
  it in the security context. Why not a filter owned by `identity`: `platform`'s security chain
  would then depend on a feature, breaking the DAG below. Route rules come from each feature's own
  `SecurityRules` bean (no central file every feature edits). CORS and security headers from Spring
  Security. **CSRF is an `Origin` / `Sec-Fetch-Site` check** on unsafe methods (refused unless the
  `Origin` is an allowed client origin; with no `Origin`, refused when `Sec-Fetch-Site:
  cross-site`), running before CORS, instead of Spring's CSRF token: the client sends no CSRF token
  (adding one is a contract change), and for an API on a same-site subdomain the origin check is the
  defence that works. Because a sibling subdomain can still *set* cookies for the parent domain
  ("cookie tossing"), the session cookie is `__Host-session` and a cookie name sent twice is treated
  as absent. `401`/`403` from Spring Security's entry points and filters go through the same
  error-envelope mapper as everything else.
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
  Tested: while the controller of an authenticated request runs, the pool has 0 active connections
  (sampled during the request — after it, every connection is back anyway), the lookup ran in
  autocommit, and a session read issues no `INSERT`/`UPDATE`.
- **Device cookie** (decision #35): opaque, only its hash stored; there is no device table; the device hash lives only on the rows that need it (`upload.owner_key`, `sighting.reporter_device_hash`); renewing
  the cookie's lifetime is a `Set-Cookie` header, not a database write.
- **Google:** the client sends Google's **ID token** (`POST /auth/google {credential}`); the backend
  verifies it (signature against Google's keys, `aud` = our client ID, `iss`, expiry) with Spring
  Security's `NimbusJwtDecoder`, finds or creates the account, and issues our own session. No OAuth
  redirect flow, no client secret.
- **Email code and SMS OTP:** behind `EmailSender` and `SmsSender`. In `local`, `test` and `staging`
  the senders write the code to the log. For e2e runs, a **fixed code for addresses on a test
  domain** (configurable, e.g. `*@e2e.scuby.test`) can be enabled — **refused at start-up in
  `prod`**. Bypassed addresses and numbers skip the resend cooldown and every send limit (e2e
  specs sign the same address in several times a minute). Real providers come with the domain
  (email leaning SES — open item O23).

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

## Behaviour decisions (where contract, client mock and product docs disagree)

**Precedence.** The contract fixes the wire shape (fields, types, codes). For behaviour, **the product
docs win** where the client's emulated backend simplified at the product's expense; the emulated
backend is the reference only where the docs are silent. A fix that needs a contract change is
proposed to the client side (list at the end of this section), never made unilaterally.

| Topic | Decision |
|---|---|
| Feed order and scope | **Nearest first, recency as tie-break** (`product/02` "proximity + recency"; `web/src/contracts/feed.ts` "nearest first"). With `lat`/`lng`: open cases within 25 km (configurable), ordered by distance band (≤ 2 km, ≤ 5 km, ≤ 10 km, ≤ 25 km) then newest first within a band; scope `local`. No case near, or no `lat`/`lng`: scope `national`, newest first. National capped at the 100 newest (the contract has no paging). Distance via PostGIS on `geography` |
| Phone step at publish | OTP when `publisher_phone_otp` is on **and** the number is new **or not verified** (stricter than the emulated backend, which skipped a stored-but-unverified number). The first `phone_step: otp` answer sends the code; repeating that call inside the 60 s cooldown answers `otp` again without resending. Flag off: publish directly (`{code}`), number stored E.164 and unverified (open item O24) |
| Sighting rate limits | Per reporter per case 5 per rolling 24 h; per reporter 20 per rolling 24 h; the 15-minute rule waived inside the earlier pin's correction window (as `product/04`). Reporter = account when signed in, else the device. **The client IP is a second key** (`product/04`, `api.md`): from `CloudFront-Viewer-Address` only when the request carries the origin secret header, else the socket address (local) |
| Public location floor | The server sends `last_seen.radius_m = max(radius, 200)` to non-owners; the owner gets the stored radius; the center is never moved. Internally the stored radius is used for every computation |
| `mine` on sightings | The session's account **or** the device matches the reporter |
| Photos | A photo in a publish/sighting body must have been uploaded by this caller (account or device) for that purpose and be processed, else `validation_failed` on that field. `pet` and `profile` slots need a session (`validation_failed` on `purpose` otherwise). Slots expire in 5 minutes; at most 20 slots per caller per 10 minutes. **Local and test** store bytes through a development-only PUT endpoint that marks the photo processed at once (as the emulated backend does); staging uses S3 + the ingest Lambda |
| Other verticals | Codes of found/adoption/help answer `not_found` in this slice (none exist yet) |
| `GET /feed` query parameters | Implemented from the Zod schema (`vertical`, `species`, `lat`, `lng`); their absence from `openapi.json` is reported |
| Notifications and check-ins | **Not in this slice** (no outbox events, no check-in scheduling): a notification needs its orchestrator, push, email and inbox (backend-plan L.1). **Product risk:** must ship before the first real user |
| `seen_at` in the future | Tolerate **5 minutes** of device clock drift; beyond that `seen_at_in_future` (`product/04` is corrected to say so) |
| Email code | 6 digits, stored hashed, 5-minute expiry, 3 attempts, 60 s cooldown, 10 per address per day; address normalised (trim, lower-case); always 204 |
| Google | Require `email_verified`; identity key = Google `sub`; link to an existing account by verified email |
| Test bypasses (never prod) | Fixed email code for a test domain (e.g. `*@e2e.scuby.test`); fixed SMS code for a reserved test number range (e.g. `+57 300 000 00xx`); bypassed addresses and numbers skip the cooldown and every send limit and always get a fresh code row; `publisher_phone_otp` off per test account. Enabling a bypass under the `prod` profile fails start-up |
| Place names | `PlaceNamer` interface; computed once at publish (and on location edit), stored on the case. Behind a new flag **`reverse_geocoding`, default off** → `place_name` is a generic localized label («Zona marcada en el mapa»). A **spike** compares Amazon Location (stored results ≈ $4 per 1,000), Nominatim and PostGIS with open barrio polygons on ~15 Colombian points (Laureles vs Belén, Chapinero, a small municipality, a rural point) before the flag is turned on — previews and posters show the **barrio** (`product/10`) |
| Feature flags | The flag system of decision #18 (tables, change history, registry, one evaluation function) is built in this slice: `publisher_phone_otp` and `reverse_geocoding` need it |
| Case codes | Case-insensitive lookup; the purged-code table exists (empty) so `gone` works |

**Queries and indexes.**
- **N+1 guard on every endpoint test:** a jOOQ execute listener counts statements per request and the test fails above a fixed ceiling (e.g. `GET /cases/{code}` ≤ 3 regardless of how many sightings).
- **Plan checks only where a query can degrade as a table grows:** the feed, a case's sightings, the rate-limit counts, the `active_case_exists` check. Those get an integration test with seeded volume (thousands of rows) asserting the expected plan (index used, no sequential scan on the large table). Primary-key/unique lookups, single-row writes and small static tables are exempt.
- **An index is earned, not assumed:** measure first; a proposed index carries, in its migration comment and the task report, the query it serves, the plan before and after, its write cost on that table and any overlap with existing indexes. **Every new index needs human approval** before the branch merges; the final report lists them.

**Proposed to the client side (contract/docs changes):** feed paging; `phone_step: unverified` (O24); feed parameters missing from `openapi.json`; the 5-minute tolerance in `product/04`; nearest-first wording made consistent across contract and docs; **the feed point** — the client sends no `lat`/`lng` today, so every visitor gets the national feed until it sends the device position (or the country's `default_center` from `/config`); the server's nearest-first branch is built and tested, and its spatial index waits for that change; the device cookie renamed `__Host-device` (cookie tossing).

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
