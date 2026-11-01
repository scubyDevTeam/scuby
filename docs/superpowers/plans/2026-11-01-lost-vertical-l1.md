# Lost Vertical L1 — Owner Actions, Pins, «Lo tengo», My Pets and Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 13 endpoints of the lost vertical's second backend slice — edit (`PATCH /lost-cases/{code}`, `PATCH /cases/{code}`), reunite, cancel, reopen, owner moderation of a pin, the reporter's correction and delete of their own pin, «Lo tengo» (`POST /cases/{code}/recovery-claims`) and the owner's answer, `GET /me/pets`, `PATCH /me/profile` — plus the owner-only claim badge on `GET /cases/{code}`, `GET /feed` and `GET /me/cases`, the client contract change that badge needs, and the owning docs.

**Architecture:** Everything lives in the existing flat feature packages (`cases`, `pets`, `identity`, `uploads`, `platform`). Every state change is **one conditional SQL statement** (`UPDATE … WHERE <guard> RETURNING`, `INSERT … SELECT … ON CONFLICT … WHERE`), preceded by a read that classifies errors in the decided order; no application locks. Rules are pure `*Derivation` classes (table-tested, PIT ≥ 80 %): `LostLifecycleDerivation`, `ClaimDerivation`, `LostEditDerivation`, `MyPetsDerivation`, `ProfileTextDerivation`, and the `mine` rule in `LostCaseDerivation` (the caller's person, or an anonymous pin from the caller's device). Owner transitions and the reporter's delete are idempotent: a repeat of an action already done answers its success with no write. PATCH bodies use a three-state `Patch<T>` (absent / null / value) deserialized through Jackson's absent- and null-value hooks.

**Tech Stack:** Java 25, Spring Boot 4.1.2 (Jackson 3, `tools.jackson.*`; annotations stay `com.fasterxml.jackson.annotation.*`), jOOQ 3.21 OSS (codegen from the migrations at build time, in Docker), Flyway, PostgreSQL 17 + PostGIS, Testcontainers, ArchUnit, PIT. Client side (Task 8 only): Node 24, pnpm 10.27.0, Zod mini, Vitest, Playwright.

**Design (binding):** `docs/superpowers/specs/2026-11-01-lost-vertical-l1-design.md` (cited below as "the spec", with its section numbers). Precedence: the contract (`docs/eng/openapi.json`, generated from `web/src/contracts`) fixes the wire shape; the spec and the product docs fix behaviour.

## Global Constraints

- **Prerequisite:** branch `be/lost-l1` contains commit `67823de` (the spec). Before Task 1 the full build is green (`[mvn] verify`, below). If it is not, stop and report; do not start Task 1 on a red baseline.
- **Where:** work and write ONLY inside the worktree `W` = `/Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1` (branch `be/lost-l1`); `B` = `W/backend`. Expand `W`/`B` to absolute paths in every write and every command. **Never touch** `/Users/alejandrosuazabuiles/Desktop/scuby-monorepo` (the main checkout), any other directory under `/Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/`, or `~/scuby-b1-run`.
- **`web/` may be edited ONLY in Task 8** (the contract change). Every other task only reads or runs it. `docs/eng/openapi.json` is never edited by hand: Task 8 regenerates it with `pnpm openapi`.
- **Never edit an existing migration** (`main` is shared and other branches may already have run them). Every schema change is a new file `B/src/main/resources/db/migration/V<yyyyMMdd>_<HHmm>__lower_snake_name.sql` (`MigrationNamesTest` enforces the pattern; `spring.flyway.out-of-order` is on, so a migration must not depend on another branch's migration, decision #44). Each opens with a comment: what it is for and which doc owns it. Inside PL/pgSQL qualify tables with `scuby.`; PostGIS objects are `public.*`.
- **Shell:** zsh tool shell; scripts run with `bash script.sh` or `python3 -I script.py`. Every Maven command is
  `cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1/backend && export JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home PATH=/opt/homebrew/opt/openjdk@25/bin:$PATH && ./mvnw ...` — written below as `[mvn] ...`. `bash B/build.sh` builds the same thing with Maven in a container (`--verify` runs the suite); the e2e harness uses it.
- **Docker is required for every Maven build** (jOOQ codegen and the tests start Postgres) and the image `scuby/postgres:17` must exist (`docker image inspect scuby/postgres:17`, else `docker build -t scuby/postgres:17 /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1/infra/docker/postgres`). A migration change regenerates `co.scuby.db.generated.*` on the next build.
- **No new dependencies;** `pom.xml` is not edited. No telemetry.
- **Packages (ArchUnit fails the build):** flat, package-private by default; a class another feature uses is `public` + `@ModuleApi`. `platform` depends on nothing of ours; foundations `identity`, `uploads`, `pets` only on `platform`; `cases` on foundations + `platform`. `identity` may NOT call `uploads`: the profile photo check goes through the new `platform.media.ProfilePhotos` interface. Every `@RestController` is `@ApiComponent`; nothing here is a `@WorkerComponent`. A `*Derivation` class uses no Spring, jOOQ, generated tables, `java.io`/`java.net`/`java.nio`/`java.sql`, clock or randomness (so a URL encoder lives outside derivations: `WhatsappLinks`).
- **One writer per table (review-enforced):** `cases` writes `lost_case`, `sighting`, `recovery_claim`; `pets` writes `pet` (new `Pets.updateLook`); `identity` writes `person` (new `People.updateProfile`). Reads may join any table.
- **No application locks (decision #59, `B/CLAUDE.md` rule 11):** `READ COMMITTED`, one atomic conditional statement per invariant; no `FOR UPDATE`, no advisory lock. A pre-read classifies the errors; the write repeats the guard; zero rows after a passing pre-read is the race loser and answers what a re-read classifies. A unique violation from the one-active-case-per-pet index is caught by constraint name (`UniqueViolation.on`) and answered `active_case_exists`, never a `500`.
- **No pooled connection is held during a network call (`B/CLAUDE.md` rule 7):** `PhotoAttachments.requireAttachable` (S3 HeadObject in staging; `Propagation.NEVER`) runs before any `TransactionTemplate`; services here are never `@Transactional`; the place namer is never called by the edit.
- **Partial indexes need literals:** every status literal in jOOQ is `DSL.inline("…")` (`lost_case.status = 'active'`, `sighting.status IN ('visible','hidden_by_owner')`, `recovery_claim.status = 'open'`, `responsibility_link.role = 'owner'`); `active_to IS NULL` is `isNull()`.
- **Time:** `now` is read once per request from the `Clock` bean and passed into SQL as a bind value (`instant.atOffset(ZoneOffset.UTC)`); never `now()` in application SQL; derivations take `now` as a parameter. Constants have one home each (spec §3): `LostLifecycleDerivation.REOPEN_WINDOW` (30 d, inclusive), `LostCaseDerivation.EDIT_WINDOW` (15 min, exclusive), `ClaimDerivation.STALE_AFTER` (7 d; stale iff the claim is open and `lastActiveAt + 7 d` is before now; `recovery_claim.last_active_at` is set at insert and by a repeat «Lo tengo»), `ClaimDerivation.PREFILL_WINDOW` (24 h, exclusive), `LostCaseQueries.MAX_CLAIMS_SHOWN` (50); the 5-minute edit drift is `PublishLostService.CLOCK_DRIFT`.
- **Error order of owner endpoints (spec §3):** session (`unauthorized`) → the case exists (`not_found`; a malformed code or id is `not_found`) → the caller is its owner, `lost_case.created_by` (`forbidden`) → the body (`validation_failed`) → the status (`invalid_transition`, then `active_case_exists`). What Jackson raises while reading the body (malformed JSON, a wrong JSON type, an absent `@JsonProperty(required = true)` field) answers `validation_failed` before any lookup. Controllers bind the body **without `@Valid`**; the service validates it after the owner check. Enum-valued body fields (`resolution_attribution`, `resolution`, a claim answer's `status`) bind as `String` so a wrong value is a body error after the owner check, not a Jackson error before it.
- **Indexes (`B/CLAUDE.md` · Migrations and indexes):** integrity indexes are justified by the rule they protect; performance indexes only by growth, with the three growth answers, the query, the plan before/after, the write cost and the overlaps in the migration comment, and only after a failing `PlanAssert` check (seed thousands of rows, `ANALYZE`, assert by index name with `PlanAssert.assertUsesIndex` and `PlanAssert.assertNoSeqScan`). **Every new index, of either kind, is appended for human approval** to `/private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/indexes-for-approval.md` (outside the repo, never committed) and listed in the task report.
- **Tests (the definition of done is well-designed, passing tests that prove the behaviour):**
  - Every integration test is `@IntegrationTest` (`TestDb.reset()` runs before each test by `ResetBeforeEach`). Contract routes go through the checked `ApiClient` methods (`get`, `post`, `put`, `call`, and `patch`/`delete` added in Task 4): every response is validated against `openapi.json` and the request's SQL statements (`StatementRecorder`, counted per request on the calling thread) against `StatementCeilings`. `ApiClient.raw` refuses a contract route; `unchecked(…, reason)` is the only escape, for an answer the contract cannot describe (none is needed in this plan).
  - `ContractCoverageTest`: every controller route is in the contract, and every implemented `session` route answers an anonymous caller `401`. A session route needs its `CasesSecurityRules` line in the same task.
  - A new writable table goes into `TestDb.MUTABLE_TABLES` (`HarnessSelfTest` fails otherwise).
  - Assertions are specific: status code, `error.code`, `error.fields` keys, `error.details`, field values, and the database state after (including "nothing was written" on every refusal).
  - Each error code of an endpoint has a test, and a `…PrecedenceTest` pins the first code when two rules fail at once (spec §7.5).
  - Viewer-dependent fields get a leak test (spec §7.1): anonymous, signed-in stranger and the claimant get `null`/`[]`; the owner gets the data.
  - Races (spec §7.2) are deterministic: an uncommitted row held from another connection (`support.Contention`, Task 4) or a `CyclicBarrier`; every wait has a timeout (`await(10, SECONDS)`, `Future.get(30, SECONDS)`); invariants are asserted, never lock order; never a `500`.
  - Statement ceilings are measured on a session-cache miss (clear every `ClearableCache` except `FeatureFlags` first) and pinned exactly by the endpoint tests; a ceiling never grows with row counts (seed several rows to prove it). If a measured count is LOWER than the plan says, lower both the ceiling and the pin and note it in the report; if it is HIGHER, that is a bug to fix, not a ceiling to raise.
  - Derivations: table-driven `*DerivationTest` (JUnit `@ParameterizedTest` + `@CsvSource`), PIT ≥ 80 % (`[mvn] verify` enforces it).
- **Commits:** prefixes `feat:` / `test:` / `doc:` / `fix:`, one kind per commit where possible. **Never push**, never open a PR, never rewrite history, never `git add -A` (stage paths explicitly). **Never stage `.superpowers/`.**
- **Stuck rule:** a step that still fails after 3 honest attempts at a fix → stop that task, record the command, its output and the three attempts in the report, and continue with the next task whose *Consumes* are satisfied.
- **Report:** one file per task, `W/.superpowers/sdd/l1-task-N-report.md` (N = task number), inside the worktree but git-ignored (`W/.superpowers/.gitignore` is `*`; check with `git -C W check-ignore -v .superpowers/sdd/l1-task-1-report.md`). Each report: what was done, deviations from this plan and why, measured statement counts, plans before/after for each plan check, PIT scores (Tasks 2, 3, 14), indexes for approval, items for human review. Never stage it.
- **Copy and identifiers:** Spanish strings are UI copy (the WhatsApp text is Spanish for every locale, spec assumption 13); domain identifiers are English snake_case. Country-scoped values go through `supported_countries` (`PhoneNumbers.requireMobile`), never hard-coded. Docs: one home per fact; decision log next free number **#71**; open items next free **O34**. Docs committed to the repo are self-contained: no "Task N", no chat references.

## Behaviour this plan applies (from the spec; do not re-decide)

| Topic | Rule |
|---|---|
| Owner | `lost_case.created_by` (`CaseAccessPolicy.isOwner`). A device never makes anyone the owner |
| Reunite / cancel | Only from `active`. One `UPDATE … WHERE code AND created_by AND status = 'active'`. Reunite writes `resolution = 'reunited_home'` + the attribution (not checked against evidence); cancel writes `false_alarm`/`duplicate`, no attribution; both `resolved_at = now`. Claims, pet and link untouched. `200 {id: code}`. **Idempotent:** reunite on a `reunited` case and cancel on a `cancelled` case answer the same `200 {id: code}` with no write (the first call's resolution and attribution stay); any other status is `invalid_transition` (cancel on `reunited`, reunite on `cancelled`, either on `expired`). Zero rows after a passing pre-read → one re-read tells "already in the target state" (200) from "another state" (`409`) |
| Reopen | Only `expired` with `resolved_at >= now − 30 d` (inclusive). Clears `resolution`, `resolution_attribution`, `resolved_at`; keeps sightings, claims and `published_at`; never re-broadcasts. Another active case for the pet → `409 active_case_exists {case_code}` (after `invalid_transition`). A purged code is `not_found`. **Idempotent:** reopen on this case while it is `active` (a retry, or a claim's reactivation won the race) answers `200 {id: code}` with no write; on `reunited`/`cancelled` it stays `invalid_transition` |
| Edit | Active only (`{}` on active = `204` no write; on any other status `409`). Pet photos/marks written through `Pets.updateLook` (the pet is shared: old cases show it). A moved point re-snaps `last_seen_public_lat/lng` with `LocationPrecisionDerivation.publicCenter` and sets `place_name = NULL`; the place namer is never called. `last_seen_at` ≤ now + 5 min. Existing sightings are not revalidated. Photos already on the pet need no upload; new ones go through `PhotoAttachments` (purpose `pet`) before the transaction. An open claim never blocks |
| `PATCH /cases/{code}` | No table exists for the other verticals: every code `404`, no query |
| Moderation | Owner; the pin must be `visible` or `hidden_by_owner` on this case, else `404`. `hidden`/`highlighted` independent and idempotent; `{}` no write; any case status. `200 {id: sighting id}` |
| "Mine" | A pin is mine when `reporter_person_id = me` (the session's person), **or** when it has no person (`reporter_person_id IS NULL`) and `reporter_device_hash = device`. Another person's pin is never mine, whatever device sent it; an anonymous pin from my browser stays mine after I sign in. Used by `mine`, `editable_until`, correction, delete, and the claim's `from_sighting_id` link |
| Correction | Pin on this case and not moderated/deleted, else `404` → mine, `visible` and `now < created_at + 15 min`, else `403` → case `active`, else `409` → body fields → `seen_at_in_future` → `seen_at_before_case` → `sighting_too_far` (from the snapped center). Photos, contact and the window do not move. `204` |
| Delete | As correction without the case-status check (allowed on a closed case inside the window). `status = 'deleted_by_reporter'`, never a hard delete; the `client_id` stays taken (a replay answers the deleted row's id). `204`. **Idempotent:** the reporter's delete of their own pin that is already `deleted_by_reporter` answers `204` again with no write (any time); someone else's deleted pin stays `not_found` |
| «Lo tengo» | Session required (contract change, Task 8). Order: `not_found`/`gone` (purged) → `forbidden` (the owner) → body (`phone` required and a supported mobile; `photo_urls` ≤ 5 and uploaded by the caller for purpose `claim`) → status (`active` → write; `expired` within 30 d → reactivate then write in one transaction; otherwise `409 invalid_transition`; the pet has another active case → `409 active_case_exists`). `from_sighting_id` is a link, never a refusal: when it names a `visible` pin on this case that is mine ("Mine" above) and was created within 24 h exclusive, the claim stores it and copies its point (never its photos); otherwise (another case, older, not mine, not visible, unknown, not a UUID) the claim is stored **without** the link and without a point. One open claim per person per case: the write is ONE `INSERT … SELECT … ON CONFLICT (case_code, claimant_person_id) WHERE status = 'open' DO UPDATE`; a repeat while the person's claim is open (stale included) **refreshes** it — `phone`, `photo_urls`, the point and `from_sighting_id` take the repeat's values and `last_active_at = now` — and answers the same id, `201` (the contract's only success status for this route). The write runs only while the case is active, so a repeat on a case that is not active (and cannot be reactivated without conflict) answers its refusal (`invalid_transition` or `active_case_exists`), never the old claim. No rate limit, no notification, no check-in, no outbox row. `201 {id, whatsapp_url}`; the URL only under the public-contact rule (`expose_whatsapp AND phone_has_whatsapp AND contact_phone_verified AND NOT in_app_only`, case active): `https://wa.me/<digits>?text=` + «Hola, vi tu aviso de {nombre} en Scuby ({código}) y creo que lo tengo.» |
| Answer | Owner; claim on this case else `404`; `status` `confirmed`/`dismissed`; revisable, idempotent (same answer = no write), any case status, a stale claim can be answered; never closes the case. `200 {id: claim id}` |
| Badge | `open_claim_count` / `possible_find` count `status = 'open'` claims active within 7 days (`last_active_at >= now − 7 d`), on an active case, **owner only** (non-owner `null`; owner of a closed case `0`/`false`). `GET /me/cases` keeps a non-null int. Owner's `claims[]` = newest 50 with wire status (`stale` derived) |
| `/me/pets` | Active owner links of the caller; nameless pets with `name: ""`; `active_case_code` = the caller's active case; `reopenable_case_code` = latest of the caller's cases expired within 30 d, only when there is no active one; order: latest `greatest(published_at, resolved_at)` of the caller's cases desc nulls last, then `pet.created_at` desc, then id. One query |
| Profile | PATCH semantics; `display_name` trimmed, 1..80 code points, sending it sets `display_name_chosen = true`; `bio` ≤ 280, no links (`http://`, `https://`, `www.`, `wa.me`, `tel:`, `mailto:`, any `word.tld` token); `city` ≤ 80 (new CHECK); `notification_prefs` all four; `photo_url` = the current one as is, or a `profile` upload of the caller, or `null`. Response = `ProfileView.of` as `GET /me/profile` |

---

## File map

```
backend/src/main/resources/db/migration/
  V20261101_1000__lost_case_resolution.sql            (Task 1)
  V20261101_1010__sighting_deleted_by_reporter.sql     (Task 1)
  V20261101_1020__recovery_claims.sql                  (Task 1)
  V20261101_1030__recovery_claim_by_case_index.sql     (Task 1, after its plan check fails)
  V20261101_1040__responsibility_link_by_person_index.sql (Task 1, after its plan check fails)
  V20261101_1050__person_city_length.sql               (Task 1)
backend/src/main/java/co/scuby/
  platform/web/   Patch, PatchDeserializer (Task 3); BodyValidation (Task 7); ApiErrorHandler.wirePath visibility (Task 7)
  platform/db/    UniqueViolation (Task 4)
  platform/media/ ProfilePhotos (Task 13)
  uploads/        ProfilePhotoCheck (Task 13)
  pets/           Pets.LookChange + Pets.updateLook (Task 5)
  identity/       ProfileUpdateRequest, ProfileTextDerivation (Task 3); ProfileUpdates, People.updateProfile/ProfileChange,
                  ProfileController PATCH (Task 13)
  cases/          LostLifecycleDerivation, ClaimDerivation (Task 2)
                  EditLostRequest, LostEditDerivation, MyPetRow, MyPetView, MyPetsDerivation (Task 3)
                  CreatedView, CaseErrors, OwnerAccess, LifecycleQueries, CaseLifecycleRequests,
                  CaseLifecycleService, CaseLifecycleController; CaseAccessPolicy.isOwner; CasesSecurityRules (Task 4)
                  EditLostService, EditLostController, EditCaseController (Task 5)
                  ModerateSightingRequest, SightingModerationService, SightingModerationController;
                  LostCaseQueries owner visibility (Task 6)
                  SightingCorrectionRequest; SightingQueries/SightingService/SightingController correction+delete;
                  LostCaseDerivation.mine/editable (Task 7)
                  RecoveryClaimRequest, ClaimCreatedView, WhatsappLinks, RecoveryClaimQueries, RecoveryClaimService,
                  RecoveryClaimController (Task 9)
                  ClaimAnswerRequest; answer; LostCaseFacts/LostCaseQueries/CaseReads/LostCaseView/LostCaseDerivation claims (Task 10)
                  FeedRow/FeedView/FeedQueries/FeedReads/FeedController/FeedDerivation possible_find;
                  MyCaseRow/MyCasesQueries/MyCasesController/MyCasesDerivation open_claim_count (Task 11)
                  MyPetsQueries, MyPetsController (Task 12)
backend/src/test/java/co/scuby/
  support/   ApiClient.patch/delete, Contention, CaseFixtures (+petOf, close, lostCaseForPet) (Task 4); Photos (Task 5);
             CaseFixtures.claim (Task 9); CaseFixtures.ownedPet/unlink (Task 12); StatementCeilings (Tasks 4–13); TestDb (Task 1)
  contract/  ContractCoverageTest path variables (Task 4)
  cases/     L1SchemaTest, RecoveryClaimPlanTest, MyPetsPlanTest, SeedVolume (Task 1); *DerivationTest (Tasks 2, 3, 7, 10, 11);
             CaseLifecycle*Test (4); EditLost*Test (5); SightingModerationTest (6); SightingCorrectionTest,
             SightingDeleteTest, OwnPinPrecedenceTest (7); RecoveryClaim*Test, WhatsappLinksTest (9);
             ClaimAnswerTest, ClaimLeakTest (10); FeedBadgeTest, ClaimCountPlanTest (11); MyPetsEndpointTest (12)
  identity/  ProfileTextDerivationTest (3), ProfileUpdateTest (13)
  platform/  web/PatchTest (3), web/BodyValidationTest (7), db/UniqueViolationTest (4)
  pets/      PetsLookTest (5)
web/ (Task 8 only): src/contracts/case.ts, feed.ts, endpoints/helpers.ts, endpoints/lost.ts, src/domain/lost/actions.ts,
  src/mocks/serialize.ts, src/mocks/api/reads.ts, src/mocks/api/helpers.ts, src/mocks/fixtures.ts, src/mocks/backend.test.ts,
  src/features/lost/LostCasePage.test.tsx, e2e/lost-case.spec.ts, e2e/helper-actions.spec.ts; regenerated docs/eng/openapi.json
docs/ (Task 14): product/00-product-map.md, product/01-actors-and-entities.md, product/02-flows.md, product/04-lost-workflow.md,
  open-items.md, eng/api.md, eng/auth.md, eng/backend.md, handoffs/<date>-backend-lost-l1-fe.md; backend/e2e/seed.sql
```

**Task order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14. Task 8 (the contract change) comes **before** the claim tasks on purpose: `ApiClient` validates every response's status against the statuses `openapi.json` lists for its route, and `claimRecovery`'s `401`/`403`/`410` are not listed until Task 8 regenerates the contract (nor is the nullable badge, which Tasks 10–11 answer), so Tasks 9–11 cannot pass before it. (Reopen's `409 active_case_exists` already validates before Task 8: `409` is listed and the validator checks only the status and the generic `Error` schema; Task 8 adds the code to the list for the client.) Tasks 12 and 13 depend only on Tasks 1–4 (and 3 for 13) and may run before 9–11 if a claim task is stuck.

---
### Task 1: Schema — resolution columns, `deleted_by_reporter`, `recovery_claim`, `person.city`, and the two performance indexes

The data model of spec §2, all as new migrations. The integrity rules are proven in the database itself by `L1SchemaTest` (each refusal names its constraint, so a dropped or renamed CHECK fails). The two performance indexes are written only after their plan checks fail (RED), with the growth answers in their comments.

**Files:**
- Create: `B/src/main/resources/db/migration/V20261101_1000__lost_case_resolution.sql`, `V20261101_1010__sighting_deleted_by_reporter.sql`, `V20261101_1020__recovery_claims.sql`, `V20261101_1030__recovery_claim_by_case_index.sql`, `V20261101_1040__responsibility_link_by_person_index.sql`, `V20261101_1050__person_city_length.sql`
- Modify: `B/src/test/java/co/scuby/support/TestDb.java` (add `"recovery_claim"` to `MUTABLE_TABLES`)
- Modify: `B/src/test/java/co/scuby/cases/SeedVolume.java` (add `claims`, `petsOwnedBy`)
- Test: `B/src/test/java/co/scuby/cases/L1SchemaTest.java`, `B/src/test/java/co/scuby/cases/RecoveryClaimPlanTest.java`, `B/src/test/java/co/scuby/cases/MyPetsPlanTest.java`

**Interfaces:**
- Consumes: `CaseFixtures.luna(UUID)`, `CaseFixtures.sighting(...)`, `Accounts.person(String)`, `SeedVolume.casesAndSightings(DSLContext, int, int)`, `PlanAssert.assertUsesIndex/assertNoSeqScan(DSLContext, Query, String)`, `MutableClock.START`.
- Produces (jOOQ codegen, used by every later task):
  - `LOST_CASE.RESOLUTION` (`Field<String>`), `LOST_CASE.RESOLUTION_ATTRIBUTION` (`Field<String>`).
  - `RECOVERY_CLAIM` with `ID (UUID)`, `CASE_CODE (String)`, `CLAIMANT_PERSON_ID (UUID)`, `PHONE (String)`, `PHOTO_URLS (String[])`, `LAT (Double)`, `LNG (Double)`, `FROM_SIGHTING_ID (UUID)`, `STATUS (String)`, `CREATED_AT (OffsetDateTime)`, `LAST_ACTIVE_AT (OffsetDateTime)`, `ANSWERED_AT (OffsetDateTime)`.
  - Constraint names: `lost_case_resolution_fits_status`, `lost_case_attribution_only_reunited`, `lost_case_active_is_unresolved`, `sighting_status_check`, `recovery_claim_one_open_per_claimant`, `recovery_claim_point_both_or_none`, `recovery_claim_answered_when_not_open`, `person_city_length`.
  - Indexes: `recovery_claim_by_case_recent_idx`, `responsibility_link_by_person_active_idx`.
  - `SeedVolume.claims(DSLContext db, int cases, int claims, String heavyCase, int heavyClaims)`, `SeedVolume.petsOwnedBy(DSLContext db, int people, int pets)`.
  - Seed ids: claimant persons `00000000-0000-0000-0003-<12 digits>`; pet owners `00000000-0000-0000-0004-<12 digits>`; their pets `00000000-0000-0000-0005-<12 digits>`.

- [ ] **Step 1: Baseline**

Run: `[mvn] verify 2>&1 | tail -20`
Expected: `BUILD SUCCESS`. Record the test count and the PIT line (`>> Generated N mutations Killed M (P%)`) in `W/.superpowers/sdd/l1-task-1-report.md`. If it fails, stop (Global Constraints · Prerequisite).

- [ ] **Step 2: Write the failing schema test**

`B/src/test/java/co/scuby/cases/L1SchemaTest.java`:

```java
package co.scuby.cases;

import co.scuby.support.Accounts;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The L1 schema rules hold in the database whatever the code does (spec 2026-11-01-lost-vertical-l1-design §2).
 * Raw SQL on purpose: the rule under test is the constraint, not a query builder. Every refusal names its
 * constraint, so a dropped or renamed CHECK fails here.
 */
@IntegrationTest
class L1SchemaTest {

    @Autowired DSLContext db;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;

    UUID owner;
    UUID claimant;
    UUID sighting;

    @BeforeEach
    void setUp() {
        owner = accounts.person("carolina@correo.co");
        claimant = accounts.person("andres@correo.co");
        cases.luna(owner);
        sighting = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, MutableClock.START, MutableClock.START, claimant,
                "c".repeat(64), null, "visible");
    }

    private void setCase(String assignments) {
        db.execute("UPDATE scuby.lost_case SET " + assignments + " WHERE code = '7K3PQ'");
    }

    private Object caseColumn(String column) {
        return db.fetchValue("SELECT " + column + " FROM scuby.lost_case WHERE code = '7K3PQ'");
    }

    // --- lost_case (spec §2.1) ---

    @Test
    void aReunitedCaseTakesReunitedHomeAndAnAttribution() {
        setCase("status = 'reunited', resolved_at = now(), resolution = 'reunited_home', resolution_attribution = 'offline'");
        assertThat(caseColumn("resolution")).isEqualTo("reunited_home");
        assertThat(caseColumn("resolution_attribution")).isEqualTo("offline");
    }

    @ParameterizedTest
    @CsvSource({"false_alarm", "duplicate"})
    void aCancelledCaseTakesFalseAlarmOrDuplicate(String resolution) {
        setCase("status = 'cancelled', resolved_at = now(), resolution = '" + resolution + "'");
        assertThat(caseColumn("resolution")).isEqualTo(resolution);
    }

    @ParameterizedTest(name = "{0} + {1}")
    @CsvSource({
            "reunited,  false_alarm",
            "reunited,  duplicate",
            "cancelled, reunited_home",
            "expired,   no_response",
            "expired,   reunited_home",
            "reunited,  found_deceased",
    })
    void aResolutionThatDoesNotFitTheStatusIsRefused(String status, String resolution) {
        assertThatThrownBy(() -> setCase("status = '" + status + "', resolved_at = now(), resolution = '" + resolution + "'"))
                .hasStackTraceContaining("lost_case_resolution_fits_status");
        assertThat(caseColumn("status")).isEqualTo("active");
    }

    @Test
    void anAttributionOnlyGoesWithAReunion() {
        assertThatThrownBy(() -> setCase("status = 'cancelled', resolved_at = now(), resolution = 'duplicate', resolution_attribution = 'offline'"))
                .hasStackTraceContaining("lost_case_attribution_only_reunited");
        assertThatThrownBy(() -> setCase("resolution_attribution = 'unknown'"))
                .hasStackTraceContaining("lost_case_attribution_only_reunited");
    }

    @Test
    void anUnknownAttributionValueIsRefused() {
        assertThatThrownBy(() -> setCase("status = 'reunited', resolved_at = now(), resolution = 'reunited_home', resolution_attribution = 'luck'"))
                .hasStackTraceContaining("lost_case_resolution_attribution_check");
    }

    @Test
    void anActiveCaseCarriesNoResolvedAt() {
        assertThatThrownBy(() -> setCase("resolved_at = now()")).hasStackTraceContaining("lost_case_active_is_unresolved");
    }

    @Test
    void aClosedRowWithoutResolutionStaysValidForRowsWrittenBeforeTheMigration() {
        setCase("status = 'expired', resolved_at = now()");
        assertThat(caseColumn("resolution")).isNull();
    }

    // --- sighting (spec §2.2) ---

    @Test
    void aSightingMayBeDeletedByItsReporterButNotGivenAnUnknownStatus() {
        db.execute("UPDATE scuby.sighting SET status = 'deleted_by_reporter' WHERE id = ?", sighting);
        assertThat(db.fetchValue("SELECT status FROM scuby.sighting WHERE id = ?", sighting)).isEqualTo("deleted_by_reporter");
        assertThatThrownBy(() -> db.execute("UPDATE scuby.sighting SET status = 'erased' WHERE id = ?", sighting))
                .hasStackTraceContaining("sighting_status_check");
    }

    // --- recovery_claim (spec §2.3) ---

    private void claim(UUID person, String status, String answeredAt) {
        db.execute("INSERT INTO scuby.recovery_claim (id, case_code, claimant_person_id, phone, status, created_at, last_active_at, answered_at) "
                + "VALUES (gen_random_uuid(), '7K3PQ', ?, '+573001112233', ?, now(), now(), " + answeredAt + ")", person, status);
    }

    @Test
    void aClaimAlwaysCarriesWhenItWasLastActive() {
        assertThatThrownBy(() -> db.execute("INSERT INTO scuby.recovery_claim (id, case_code, claimant_person_id, phone, status, created_at) "
                + "VALUES (gen_random_uuid(), '7K3PQ', ?, '+573001112233', 'open', now())", claimant))
                .hasStackTraceContaining("null value in column \"last_active_at\"");
        assertThat(db.fetchCount(co.scuby.db.generated.Tables.RECOVERY_CLAIM)).isZero();
    }

    @Test
    void onePersonHasAtMostOneOpenClaimPerCase() {
        claim(claimant, "open", "NULL");
        assertThatThrownBy(() -> claim(claimant, "open", "NULL")).hasStackTraceContaining("recovery_claim_one_open_per_claimant");
        claim(owner, "open", "NULL");                                  // another person: allowed (the owner check is the service's)
        assertThat(db.fetchCount(co.scuby.db.generated.Tables.RECOVERY_CLAIM)).isEqualTo(2);
    }

    @Test
    void anAnsweredClaimFreesTheSlotForANewOpenOne() {
        claim(claimant, "dismissed", "now()");
        claim(claimant, "confirmed", "now()");
        claim(claimant, "open", "NULL");
        assertThat(db.fetchCount(co.scuby.db.generated.Tables.RECOVERY_CLAIM)).isEqualTo(3);
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(delimiter = '|', quoteCharacter = '"', value = {   // '"' so the SQL single quotes stay literal
            "open with answered_at      | status, answered_at | 'open', now()                   | recovery_claim_answered_when_not_open",
            "confirmed without answer   | status, answered_at | 'confirmed', NULL               | recovery_claim_answered_when_not_open",
            "stale is never stored      | status, answered_at | 'stale', now()                  | recovery_claim_status_check",
            "lat without lng            | lat                 | 6.25                            | recovery_claim_point_both_or_none",
            "lat out of range           | lat, lng            | 91, 0                           | recovery_claim_lat_check",
            "six photos                 | photo_urls          | '{a,b,c,d,e,f}'                 | recovery_claim_photo_urls_check",
            "not E.164                  | phone               | '3001112233'                    | recovery_claim_phone_check",
    })
    void aClaimRowThatBreaksARuleIsRefused(String label, String columns, String values, String constraint) {
        String sql = "INSERT INTO scuby.recovery_claim (id, case_code, claimant_person_id, created_at, last_active_at, "
                + (columns.contains("phone") ? "" : "phone, ") + (columns.contains("status") ? "" : "status, ") + columns + ") "
                + "VALUES (gen_random_uuid(), '7K3PQ', ?, now(), now(), "
                + (columns.contains("phone") ? "" : "'+573001112233', ") + (columns.contains("status") ? "" : "'open', ") + values + ")";
        assertThatThrownBy(() -> db.execute(sql, claimant)).as(label).hasStackTraceContaining(constraint);
        assertThat(db.fetchCount(co.scuby.db.generated.Tables.RECOVERY_CLAIM)).isZero();
    }

    @Test
    void aClaimMustBeOnAnExistingCaseAndMayPointAtASighting() {
        assertThatThrownBy(() -> db.execute("INSERT INTO scuby.recovery_claim (id, case_code, claimant_person_id, phone, status, created_at, last_active_at) "
                + "VALUES (gen_random_uuid(), 'ZZZZZ', ?, '+573001112233', 'open', now(), now())", claimant))
                .hasStackTraceContaining("recovery_claim_case_code_fkey");
        db.execute("INSERT INTO scuby.recovery_claim (id, case_code, claimant_person_id, phone, lat, lng, from_sighting_id, status, created_at, last_active_at) "
                + "VALUES (gen_random_uuid(), '7K3PQ', ?, '+573001112233', 6.25, -75.59, ?, 'open', now(), now())", claimant, sighting);
        assertThat(db.fetchValue("SELECT from_sighting_id FROM scuby.recovery_claim")).isEqualTo(sighting);
        assertThat(db.fetchValue("SELECT photo_urls::text FROM scuby.recovery_claim")).isEqualTo("{}");
    }

    // --- person.city (spec §2.5) ---

    @Test
    void aCityIsAtMost80CharactersCountedLikePostgres() {
        db.execute("UPDATE scuby.person SET city = ? WHERE id = ?", "🐶".repeat(80), owner);   // 80 characters, 160 UTF-16 units
        assertThat(db.fetchValue("SELECT length(city) FROM scuby.person WHERE id = ?", owner)).isEqualTo(80);
        assertThatThrownBy(() -> db.execute("UPDATE scuby.person SET city = ? WHERE id = ?", "a".repeat(81), owner))
                .hasStackTraceContaining("person_city_length");
    }
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `[mvn] test -Dtest=L1SchemaTest 2>&1 | tail -30`
Expected: FAIL — errors such as `column "resolution" of relation "lost_case" does not exist`, `relation "scuby.recovery_claim" does not exist` and `cannot find symbol … RECOVERY_CLAIM` (the generated table does not exist yet). A compile error on `Tables.RECOVERY_CLAIM` is the expected RED here.

- [ ] **Step 4: Write the four integrity migrations**

`B/src/main/resources/db/migration/V20261101_1000__lost_case_resolution.sql`:

```sql
-- How a lost case left `active`, and who helped (docs/product/04-lost-workflow.md · resolution values; L1 design
-- docs/superpowers/specs/2026-11-01-lost-vertical-l1-design.md §2.1). Written only by the cases feature.
-- L1 writes reunited_home (reunite), false_alarm and duplicate (cancel). The L2 migration that brings no_response
-- (expiry), and found_deceased / gave_up if the client takes that proposal (open item O35), replaces
-- lost_case_resolution_fits_status. resolution may be NULL on a closed row so rows written before this migration stay
-- valid; every L1 close sets it. resolved_at is when the case left `active`; the 30-day reopen window counts from it.
-- An active case carries no resolution data: reopen and claim reactivation clear all three columns.
ALTER TABLE lost_case
  ADD COLUMN resolution             text,
  ADD COLUMN resolution_attribution text CHECK (resolution_attribution IN
             ('platform_sighting', 'platform_claim', 'platform_share', 'offline', 'unknown')),
  ADD CONSTRAINT lost_case_resolution_fits_status CHECK (resolution IS NULL
       OR (status = 'reunited'  AND resolution = 'reunited_home')
       OR (status = 'cancelled' AND resolution IN ('false_alarm', 'duplicate'))),
  ADD CONSTRAINT lost_case_attribution_only_reunited CHECK (resolution_attribution IS NULL OR status = 'reunited'),
  ADD CONSTRAINT lost_case_active_is_unresolved CHECK (status <> 'active' OR (resolution IS NULL AND resolved_at IS NULL));
```

`B/src/main/resources/db/migration/V20261101_1010__sighting_deleted_by_reporter.sql`:

```sql
-- A reporter deletes their own pin inside its 15-minute window as a status, never a hard delete
-- (docs/product/04-lost-workflow.md · sighting; L1 design §2.2). The row stays, so its (case_code, client_id) replay key
-- stays taken (a replayed «Lo vi» answers the deleted row's id), sightings_count stays a count of visible rows, and a
-- claim's from_sighting_id never dangles. deleted_by_reporter is invisible to everyone, the owner included.
-- sighting_by_case_recent_idx is unchanged (status is INCLUDEd and filtered inside the index entry).
ALTER TABLE sighting DROP CONSTRAINT sighting_status_check,
  ADD CONSTRAINT sighting_status_check
      CHECK (status IN ('visible', 'hidden_by_owner', 'removed_by_moderation', 'deleted_by_reporter'));
```

`B/src/main/resources/db/migration/V20261101_1020__recovery_claims.sql`:

```sql
-- «Lo tengo»: someone says they have the lost animal (docs/product/04-lost-workflow.md · recovery_claim; L1 design §2.3).
-- Written only by the cases feature. Keyed by case_code like sighting (the product doc's case_id is the code).
-- The claimant is always a person: «Lo tengo» needs a session. No device column, no note column (the contract's claim
-- request has no note; a later contract change adds it with its own migration).
-- lat/lng: the point, filled only from from_sighting_id (the request carries no point). Photos are stored, not exposed
-- (open item O36). last_active_at: when the claimant last said «Lo tengo» on this claim (set at insert; a repeat while
-- the claim is open refreshes it). `stale` is not stored: a claim is stale when status = 'open' and last_active_at + 7 days
-- is in the past (ClaimDerivation.STALE_AFTER). No ON DELETE action on the foreign keys: the purge and account deletion
-- (L2) decide.
CREATE TABLE recovery_claim (
  id                  uuid PRIMARY KEY,
  case_code           text NOT NULL REFERENCES lost_case (code),
  claimant_person_id  uuid NOT NULL REFERENCES person (id),
  phone               text NOT NULL CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  photo_urls          text[] NOT NULL DEFAULT '{}' CHECK (cardinality(photo_urls) <= 5),
  lat                 double precision CHECK (lat BETWEEN -90 AND 90),
  lng                 double precision CHECK (lng BETWEEN -180 AND 180),
  from_sighting_id    uuid REFERENCES sighting (id),
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed', 'dismissed')),
  created_at          timestamptz NOT NULL,
  last_active_at      timestamptz NOT NULL,
  answered_at         timestamptz,
  CONSTRAINT recovery_claim_point_both_or_none CHECK ((lat IS NULL) = (lng IS NULL)),
  CONSTRAINT recovery_claim_answered_when_not_open CHECK ((status = 'open') = (answered_at IS NULL))
);

-- Integrity index (justified by its rule, not by growth): one open claim per claimant per case. It settles the
-- double-tap race: the claim is one INSERT … SELECT … ON CONFLICT (case_code, claimant_person_id) WHERE status = 'open'
-- DO UPDATE (the repeat refreshes phone, photos, point, link and last_active_at of the open row and returns its id).
-- "Open" is the stored status, so a stale claim still holds the slot (a repeat makes it fresh again). Write cost: one
-- entry per open claim; it leaves the index when the owner answers.
-- Overlap: recovery_claim_by_case_recent_idx (V20261101_1030) shares the case_code prefix but is not unique and covers
-- every status. Needs human approval before merge.
CREATE UNIQUE INDEX recovery_claim_one_open_per_claimant
  ON recovery_claim (case_code, claimant_person_id) WHERE status = 'open';
```

`B/src/main/resources/db/migration/V20261101_1050__person_city_length.sql`:

```sql
-- person.city is free text of at most 80 characters until a cities table exists (docs/eng/auth.md · Profile; open item
-- O34; L1 design §2.5). PATCH /me/profile is the first writer of city, so no existing row can violate it. The request
-- check mirrors it with @CodePoints semantics (Postgres length() counts characters, not UTF-16 units).
ALTER TABLE person ADD CONSTRAINT person_city_length CHECK (length(city) <= 80);
```

- [ ] **Step 5: Reset the new table between tests**

In `B/src/test/java/co/scuby/support/TestDb.java`, replace

```java
            "sighting",
            "responsibility_link"
    );
```

with

```java
            "sighting",
            "responsibility_link",
            "recovery_claim"
    );
```

- [ ] **Step 6: Run the schema test and the harness checks**

Run: `[mvn] test -Dtest='L1SchemaTest,HarnessSelfTest,MigrationNamesTest,MigrationsTest' 2>&1 | tail -20`
Expected: PASS, `Tests run: …, Failures: 0, Errors: 0`. If a CHECK name differs from the one asserted (Postgres names an unnamed column CHECK `<table>_<column>_check`), fix the test only when the migration is right; never rename a constraint to satisfy a test.

- [ ] **Step 7: Commit**

```bash
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 add \
  backend/src/main/resources/db/migration/V20261101_1000__lost_case_resolution.sql \
  backend/src/main/resources/db/migration/V20261101_1010__sighting_deleted_by_reporter.sql \
  backend/src/main/resources/db/migration/V20261101_1020__recovery_claims.sql \
  backend/src/main/resources/db/migration/V20261101_1050__person_city_length.sql \
  backend/src/test/java/co/scuby/support/TestDb.java backend/src/test/java/co/scuby/cases/L1SchemaTest.java
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 commit -m "feat: L1 schema — lost_case resolution, sighting deleted_by_reporter, recovery_claim, person.city length"
```

- [ ] **Step 8: Write the failing plan checks**

Add to `B/src/test/java/co/scuby/cases/SeedVolume.java`, inside the class after `casesAndSightings`:

```java
    /**
     * Recovery claims for plan checks. 2,000 claimant persons (…0003-…). {@code claims} rows spread over the first
     * {@code cases} seeded cases (claim g → case 1 + g % cases, claimant 1 + (g / cases) % 1000, so a (case, claimant)
     * pair repeats only past 1,000 claims per case), a third of them open; plus {@code heavyClaims} rows on
     * {@code heavyCase} by claimants 1001–2000, the first 500 open. Then ANALYZE.
     */
    static void claims(DSLContext db, int cases, int claims, String heavyCase, int heavyClaims) {
        db.execute("""
                INSERT INTO scuby.person (id, display_name, email, created_at)
                SELECT ('00000000-0000-0000-0003-' || lpad(g::text, 12, '0'))::uuid, 'C' || g, 'c' || g || '@seed.co', now()
                FROM generate_series(1, 2000) g ON CONFLICT DO NOTHING""");
        db.execute("""
                INSERT INTO scuby.recovery_claim (id, case_code, claimant_person_id, phone, status, created_at, last_active_at, answered_at)
                SELECT gen_random_uuid(), 'C' || upper(lpad(to_hex(1 + g % ?), 4, '0')),
                       ('00000000-0000-0000-0003-' || lpad((1 + (g / ?) % 1000)::text, 12, '0'))::uuid, '+573001112233',
                       CASE WHEN g % 3 = 0 THEN 'open' ELSE 'dismissed' END,
                       timestamptz '2026-06-01' + g * interval '1 minute',
                       timestamptz '2026-06-01' + g * interval '1 minute',
                       CASE WHEN g % 3 = 0 THEN NULL ELSE timestamptz '2026-06-01' + g * interval '1 minute' + interval '1 hour' END
                FROM generate_series(1, ?) g""", cases, cases, claims);
        db.execute("""
                INSERT INTO scuby.recovery_claim (id, case_code, claimant_person_id, phone, status, created_at, last_active_at, answered_at)
                SELECT gen_random_uuid(), ?, ('00000000-0000-0000-0003-' || lpad((1001 + g % 1000)::text, 12, '0'))::uuid,
                       '+573001112233', CASE WHEN g <= 500 THEN 'open' ELSE 'confirmed' END,
                       timestamptz '2026-09-01' + g * interval '1 minute',
                       timestamptz '2026-09-01' + g * interval '1 minute',
                       CASE WHEN g <= 500 THEN NULL ELSE timestamptz '2026-09-01' + g * interval '1 minute' + interval '1 hour' END
                FROM generate_series(1, ?) g""", heavyCase, heavyClaims);
        db.execute("ANALYZE scuby.person");
        db.execute("ANALYZE scuby.recovery_claim");
    }

    /**
     * {@code people} owners (…0004-…) and {@code pets} pets (…0005-…), pet g owned by person 1 + g % people; one link in
     * 20 has ended (active_to set). No cases. Then ANALYZE.
     */
    static void petsOwnedBy(DSLContext db, int people, int pets) {
        db.execute("""
                INSERT INTO scuby.person (id, display_name, email, created_at)
                SELECT ('00000000-0000-0000-0004-' || lpad(g::text, 12, '0'))::uuid, 'O' || g, 'o' || g || '@seed.co', now()
                FROM generate_series(1, ?) g""", people);
        db.execute("""
                INSERT INTO scuby.pet (id, name, species, custody_state, created_at)
                SELECT ('00000000-0000-0000-0005-' || lpad(g::text, 12, '0'))::uuid, 'P' || g, 'dog', 'claimed',
                       timestamptz '2026-01-01' + g * interval '1 hour'
                FROM generate_series(1, ?) g""", pets);
        db.execute("""
                INSERT INTO scuby.responsibility_link (id, person_id, pet_id, role, active_from, active_to)
                SELECT gen_random_uuid(), ('00000000-0000-0000-0004-' || lpad((1 + g % ?)::text, 12, '0'))::uuid,
                       ('00000000-0000-0000-0005-' || lpad(g::text, 12, '0'))::uuid, 'owner', timestamptz '2026-01-01',
                       CASE WHEN g % 20 = 0 THEN timestamptz '2026-06-01' END
                FROM generate_series(1, ?) g""", people, pets);
        db.execute("ANALYZE scuby.person");
        db.execute("ANALYZE scuby.pet");
        db.execute("ANALYZE scuby.responsibility_link");
    }
```

`B/src/test/java/co/scuby/cases/RecoveryClaimPlanTest.java`:

```java
package co.scuby.cases;

import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.PlanAssert;
import org.jooq.DSLContext;
import org.jooq.Select;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.ZoneOffset;

import static co.scuby.db.generated.Tables.RECOVERY_CLAIM;

/**
 * The owner's claim list (spec §4.13): newest 50 of every status plus the open non-stale count, on every owner view of
 * a case. 2,000 cases share 60,000 claims (30 each) and C000A has 2,000 more. It must be read through
 * (case_code, created_at DESC), never by scanning every claim of every case. The partial unique index
 * recovery_claim_one_open_per_claimant cannot serve it: the list reads every status.
 */
@IntegrationTest
class RecoveryClaimPlanTest {

    @Autowired DSLContext db;

    @BeforeEach
    void setUp() {
        SeedVolume.casesAndSightings(db, 2_000, 0);
        SeedVolume.claims(db, 2_000, 60_000, "C000A", 2_000);
    }

    @Test
    void anOwnersClaimListIsReadThroughTheCaseRecentIndex() {
        for (String code : new String[] {"C000A", "C0001"}) {
            var q = ownerClaimList(code);
            PlanAssert.assertUsesIndex(db, q, "recovery_claim_by_case_recent_idx");
            PlanAssert.assertNoSeqScan(db, q, "recovery_claim");
        }
    }

    /** The query exactly as spec §4.13 writes it. Task 10 replaces this method with LostCaseQueries.claimsQuery. */
    private Select<?> ownerClaimList(String code) {
        var cutoff = MutableClock.START.minus(Duration.ofDays(7)).atOffset(ZoneOffset.UTC);
        return db.select(RECOVERY_CLAIM.ID, RECOVERY_CLAIM.PHONE, RECOVERY_CLAIM.CREATED_AT, RECOVERY_CLAIM.STATUS,
                         DSL.count().filterWhere(RECOVERY_CLAIM.STATUS.eq(DSL.inline("open"))
                                 .and(RECOVERY_CLAIM.LAST_ACTIVE_AT.ge(cutoff))).over().as("open_non_stale"))
                 .from(RECOVERY_CLAIM)
                 .where(RECOVERY_CLAIM.CASE_CODE.eq(code))
                 .orderBy(RECOVERY_CLAIM.CREATED_AT.desc(), RECOVERY_CLAIM.ID.desc())
                 .limit(50);
    }
}
```

`B/src/test/java/co/scuby/cases/MyPetsPlanTest.java`:

```java
package co.scuby.cases;

import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.PlanAssert;
import org.jooq.DSLContext;
import org.jooq.Select;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.ZoneOffset;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.RESPONSIBILITY_LINK;

/**
 * GET /me/pets (spec §4.11) runs on every publish pet picker and every «Mis mascotas» view. 20,000 pets of 1,000 owners:
 * a person's links must be found by person, not by scanning every link (responsibility_link_one_active_owner leads with
 * pet_id and cannot serve a lookup by person).
 */
@IntegrationTest
class MyPetsPlanTest {

    static final UUID OWNER_7 = UUID.fromString("00000000-0000-0000-0004-000000000007");

    @Autowired DSLContext db;

    @BeforeEach
    void setUp() {
        SeedVolume.petsOwnedBy(db, 1_000, 20_000);
    }

    @Test
    void aPersonsPetsAreFoundThroughTheActiveByPersonIndex() {
        var q = myPets(OWNER_7);
        PlanAssert.assertUsesIndex(db, q, "responsibility_link_by_person_active_idx");
        PlanAssert.assertNoSeqScan(db, q, "responsibility_link");
    }

    /** The query exactly as spec §4.11 writes it. Task 12 replaces this method with MyPetsQueries.query. */
    private Select<?> myPets(UUID me) {
        var cutoff = MutableClock.START.minus(Duration.ofDays(30)).atOffset(ZoneOffset.UTC);
        var lastActivity = DSL.max(DSL.greatest(LOST_CASE.PUBLISHED_AT, LOST_CASE.RESOLVED_AT));
        return db.select(PET.ID, PET.NAME, PET.SPECIES, PET.SIZE, PET.COLORS, PET.MARKS, PET.PHOTO_URLS, PET.CREATED_AT,
                         DSL.max(LOST_CASE.CODE).filterWhere(LOST_CASE.STATUS.eq(DSL.inline("active"))).as("active_case_code"),
                         DSL.arrayAgg(LOST_CASE.CODE).orderBy(LOST_CASE.RESOLVED_AT.desc())
                            .filterWhere(LOST_CASE.STATUS.eq(DSL.inline("expired")).and(LOST_CASE.RESOLVED_AT.ge(cutoff)))
                            .as("reopenable_codes"),
                         lastActivity.as("last_activity"))
                 .from(RESPONSIBILITY_LINK)
                 .join(PET).on(PET.ID.eq(RESPONSIBILITY_LINK.PET_ID))
                 .leftJoin(LOST_CASE).on(LOST_CASE.PET_ID.eq(PET.ID), LOST_CASE.CREATED_BY.eq(me))
                 .where(RESPONSIBILITY_LINK.PERSON_ID.eq(me), RESPONSIBILITY_LINK.ROLE.eq(DSL.inline("owner")),
                        RESPONSIBILITY_LINK.ACTIVE_TO.isNull())
                 .groupBy(PET.ID)
                 .orderBy(lastActivity.desc().nullsLast(), PET.CREATED_AT.desc(), PET.ID);
    }
}
```

- [ ] **Step 9: Run them to verify they fail**

Run: `[mvn] test -Dtest='RecoveryClaimPlanTest,MyPetsPlanTest' 2>&1 | grep -E "PLAN|Seq Scan|does not use index|Tests run" | head -30`
Expected: both FAIL with `plan does not use index recovery_claim_by_case_recent_idx` / `plan does not use index responsibility_link_by_person_active_idx`, and the printed plans show `Seq Scan on recovery_claim` and `Seq Scan on responsibility_link`. Copy the first plan line of each into the report as "plan before".

- [ ] **Step 10: Write the two performance-index migrations**

`B/src/main/resources/db/migration/V20261101_1030__recovery_claim_by_case_index.sql`:

```sql
-- Performance index (L1 design §2.4). Growth answers (backend/CLAUDE.md · Migrations and indexes):
--   1. Can the table grow without bound? Yes: claims are never deleted and «Lo tengo» has no rate limit (decision #54's
--      reasoning applies), so one case can hold thousands.
--   2. How often does the query run? On every owner view of a case (LostCaseQueries.claimsQuery: the newest 50 of every
--      status, ORDER BY created_at DESC, id DESC, plus count(*) FILTER (WHERE status = 'open' AND last_active_at >= now − 7 d)
--      OVER ()), and per row of «Mis casos» and of the owner's own feed items (the correlated open-claim counts of
--      MyCasesQueries and FeedQueries).
--   3. Without it: each runs a full scan of every claim of every case.
-- Plan before (RecoveryClaimPlanTest, 62,000 claims, ANALYZE): Seq Scan on recovery_claim. Plan after: Index Scan using
-- recovery_claim_by_case_recent_idx (Limit over the case's entries in created_at order).
-- Write cost: one btree entry (text, timestamptz) per claim insert; status changes and a repeat's refresh (which does not
-- change created_at) do not touch it.
-- Overlap: recovery_claim_one_open_per_claimant (case_code, claimant_person_id) WHERE status = 'open' shares the case_code
-- prefix but is partial (open only), so it serves neither the list nor the count over every status; it stays as the
-- integrity UNIQUE. Needs human approval before merge.
CREATE INDEX recovery_claim_by_case_recent_idx ON recovery_claim (case_code, created_at DESC);
```

`B/src/main/resources/db/migration/V20261101_1040__responsibility_link_by_person_index.sql`:

```sql
-- Performance index (L1 design §2.4). Growth answers (backend/CLAUDE.md · Migrations and indexes):
--   1. Can the table grow without bound? Yes: it grows with every pet, and links are ended, never deleted.
--   2. How often does the query run? GET /me/pets (MyPetsQueries.query: WHERE person_id = ? AND role = 'owner' AND
--      active_to IS NULL) runs on every publish pet picker and every «Mis mascotas» view.
--   3. Without it: each is a full scan of every link of every person.
-- Plan before (MyPetsPlanTest, 20,000 links of 1,000 people, ANALYZE): Seq Scan on responsibility_link. Plan after:
-- Index Scan (or Bitmap Index Scan) using responsibility_link_by_person_active_idx.
-- Partial on active_to IS NULL: ended links are never listed. The query writes the predicate with jOOQ isNull(), which
-- renders as a literal predicate, so the planner can prove it under a generic prepared plan.
-- Write cost: one entry per active link (one per pet); an ended link leaves the index.
-- Overlap: responsibility_link_one_active_owner (pet_id) WHERE role = 'owner' AND active_to IS NULL leads with pet_id and
-- cannot serve a lookup by person. Needs human approval before merge.
CREATE INDEX responsibility_link_by_person_active_idx ON responsibility_link (person_id) WHERE active_to IS NULL;
```

- [ ] **Step 11: Run the plan checks to verify they pass**

Run: `[mvn] test -Dtest='RecoveryClaimPlanTest,MyPetsPlanTest' 2>&1 | grep -E "PLAN|using|Tests run" | head -30`
Expected: PASS. Copy the first plan line of each into the report as "plan after"; if the node differs from the migration comment's "Plan after" (for example a Bitmap Index Scan), correct the comment to what was printed before committing.

- [ ] **Step 12: List the three new indexes for approval**

Append to `/private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/indexes-for-approval.md`:

```markdown

## L1 Task 1 — `recovery_claim_one_open_per_claimant` — integrity (V20261101_1020)
UNIQUE partial index on recovery_claim (case_code, claimant_person_id) WHERE status = 'open'. Rule: one open claim per person per case; settles the double-tap race of «Lo tengo» (INSERT … ON CONFLICT … WHERE status = 'open' DO UPDATE: a repeat refreshes the open row and answers its id). Write cost: one entry per open claim, removed when answered. Overlap: shares the case_code prefix with recovery_claim_by_case_recent_idx.

## L1 Task 1 — `recovery_claim_by_case_recent_idx` — performance (V20261101_1030)
recovery_claim (case_code, created_at DESC). Growth: unbounded (never deleted, no rate limit). Query: the owner's claims list + open count on every owner case view; the correlated open-claim counts of «Mis casos» and the owner's feed items. Plan before/after: see the Task 1 report. Write cost: one entry per claim. Overlap: the partial UNIQUE above (open only) cannot serve every-status reads.

## L1 Task 1 — `responsibility_link_by_person_active_idx` — performance (V20261101_1040)
responsibility_link (person_id) WHERE active_to IS NULL. Growth: one row per pet, never deleted. Query: GET /me/pets on every publish pet picker and «Mis mascotas». Plan before/after: see the Task 1 report. Write cost: one entry per active link. Overlap: responsibility_link_one_active_owner leads with pet_id.
```

- [ ] **Step 13: Run the full build**

Run: `[mvn] verify 2>&1 | tail -20`
Expected: `BUILD SUCCESS` (ArchUnit, PIT and every existing test unchanged; the new CHECKs accept every row the existing fixtures write).

- [ ] **Step 14: Commit**

```bash
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 add \
  backend/src/main/resources/db/migration/V20261101_1030__recovery_claim_by_case_index.sql \
  backend/src/main/resources/db/migration/V20261101_1040__responsibility_link_by_person_index.sql \
  backend/src/test/java/co/scuby/cases/SeedVolume.java backend/src/test/java/co/scuby/cases/RecoveryClaimPlanTest.java \
  backend/src/test/java/co/scuby/cases/MyPetsPlanTest.java
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 commit -m "feat: performance indexes for the owner's claims and /me/pets, each after its failing plan check"
```

---

### Task 2: Pure rules for transitions and claims — `LostLifecycleDerivation`, `ClaimDerivation`

The rules every lifecycle and claim endpoint applies, with no I/O, as the spec's §3 constants and §7.4 tables. Each table row is a business rule a human reviews.

**Files:**
- Create: `B/src/main/java/co/scuby/cases/LostLifecycleDerivation.java`, `B/src/main/java/co/scuby/cases/ClaimDerivation.java`
- Test: `B/src/test/java/co/scuby/cases/LostLifecycleDerivationTest.java`, `B/src/test/java/co/scuby/cases/ClaimDerivationTest.java`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `LostLifecycleDerivation.REOPEN_WINDOW` (`Duration.ofDays(30)`); `enum Action { REUNITE, CANCEL, REOPEN, CLAIM }`; `enum Outcome { ALLOWED, REACTIVATE, ALREADY_DONE, INVALID_TRANSITION }` (`ALREADY_DONE`: the case is already in the action's target state — reunite on `reunited`, cancel on `cancelled`, reopen on `active` — so the action answers its success with no write; a claim never gets it); `static Outcome check(Action, String status, @Nullable Instant resolvedAt, Instant now)`; `static boolean insideReopenWindow(@Nullable Instant resolvedAt, Instant now)`; `static Instant reopenCutoff(Instant now)` (SQL: `resolved_at >= cutoff`); `static boolean isAttribution(@Nullable String)`; `static boolean isCancelReason(@Nullable String)`.
  - `ClaimDerivation.STALE_AFTER` (7 d), `PREFILL_WINDOW` (24 h); `record ContactFlags(boolean exposeWhatsapp, boolean phoneHasWhatsapp, boolean contactPhoneVerified, boolean inAppOnly)`; `record SightingLink(String status, @Nullable UUID reporterPersonId, String reporterDeviceHash, Instant createdAt)`; `static boolean isStale(String storedStatus, Instant lastActiveAt, Instant now)`; `static String wireStatus(String storedStatus, Instant lastActiveAt, Instant now)`; `static Instant staleCutoff(Instant now)` (SQL non-stale: `last_active_at >= cutoff`); `static Instant prefillCutoff(Instant now)` (SQL eligible: `created_at > cutoff`); `static @Nullable Integer openClaimCount(boolean owner, String caseStatus, int openNonStale)`; `static boolean isAnswer(@Nullable String)`; `static boolean answerChanges(String storedStatus, String requested)`; `static boolean prefillEligible(SightingLink, boolean mine, Instant now)` (`mine` is `LostCaseDerivation.mine`, Task 7: the one home of that rule); `static @Nullable String whatsappPhone(ContactFlags, String caseStatus, @Nullable String contactPhone)`; `static String whatsappText(@Nullable String petName, String code)`.

- [ ] **Step 1: Write the failing tests**

`B/src/test/java/co/scuby/cases/LostLifecycleDerivationTest.java`:

```java
package co.scuby.cases;

import co.scuby.cases.LostLifecycleDerivation.Action;
import co.scuby.cases.LostLifecycleDerivation.Outcome;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Which lifecycle action a lost case allows (docs/product/04 · Case state machine; spec §3, §4.3–4.5, §4.9).
 * Human review: this table is the rule. The reopen window is 30 days from resolved_at, INCLUSIVE. An action whose target
 * state the case is already in is ALREADY_DONE (a retry or a double tap answers its success and writes nothing); any
 * other state that is not the action's start is INVALID_TRANSITION.
 */
class LostLifecycleDerivationTest {

    static final Instant NOW = Instant.parse("2026-10-14T17:00:00Z");

    @ParameterizedTest(name = "{0} on {1}, resolved {2} ago → {3}")
    @CsvSource(nullValues = "null", value = {
            // action,  status,    resolved ago,   outcome
            "REUNITE,  active,    null,           ALLOWED",
            "REUNITE,  expired,   P1D,            INVALID_TRANSITION",
            "REUNITE,  reunited,  P1D,            ALREADY_DONE",
            "REUNITE,  cancelled, P1D,            INVALID_TRANSITION",
            "CANCEL,   active,    null,           ALLOWED",
            "CANCEL,   expired,   P1D,            INVALID_TRANSITION",
            "CANCEL,   reunited,  P1D,            INVALID_TRANSITION",
            "CANCEL,   cancelled, P1D,            ALREADY_DONE",
            "REOPEN,   expired,   P29D,           ALLOWED",
            "REOPEN,   expired,   P30D,           ALLOWED",
            "REOPEN,   expired,   PT720H0.001S,   INVALID_TRANSITION",
            "REOPEN,   expired,   null,           INVALID_TRANSITION",
            "REOPEN,   active,    null,           ALREADY_DONE",
            "REOPEN,   reunited,  P1D,            INVALID_TRANSITION",
            "REOPEN,   cancelled, P1D,            INVALID_TRANSITION",
            "CLAIM,    active,    null,           ALLOWED",
            "CLAIM,    expired,   P29D,           REACTIVATE",
            "CLAIM,    expired,   P30D,           REACTIVATE",
            "CLAIM,    expired,   PT720H0.001S,   INVALID_TRANSITION",
            "CLAIM,    expired,   null,           INVALID_TRANSITION",
            "CLAIM,    reunited,  P1D,            INVALID_TRANSITION",
            "CLAIM,    cancelled, P1D,            INVALID_TRANSITION",
    })
    void theTransitionTable(Action action, String status, Duration resolvedAgo, Outcome expected) {
        Instant resolvedAt = resolvedAgo == null ? null : NOW.minus(resolvedAgo);
        assertThat(LostLifecycleDerivation.check(action, status, resolvedAt, NOW)).isEqualTo(expected);
    }

    @Test
    void theWindowIsInclusiveAtThirtyDaysAndItsSqlCutoffAgrees() {
        Instant edge = NOW.minus(Duration.ofDays(30));
        assertThat(LostLifecycleDerivation.insideReopenWindow(edge, NOW)).isTrue();
        assertThat(LostLifecycleDerivation.insideReopenWindow(edge.minusMillis(1), NOW)).isFalse();
        assertThat(LostLifecycleDerivation.insideReopenWindow(NOW, NOW)).isTrue();
        assertThat(LostLifecycleDerivation.insideReopenWindow(null, NOW)).isFalse();
        // SQL writes `resolved_at >= reopenCutoff(now)`: the same instant is inside.
        assertThat(LostLifecycleDerivation.reopenCutoff(NOW)).isEqualTo(edge);
        assertThat(LostLifecycleDerivation.REOPEN_WINDOW).isEqualTo(Duration.ofDays(30));
    }

    @ParameterizedTest(name = "attribution {0} → {1}")
    @CsvSource(nullValues = "null", value = {
            "platform_sighting, true", "platform_claim, true", "platform_share, true", "offline, true", "unknown, true",
            "luck, false", "'', false", "null, false", "PLATFORM_CLAIM, false", "reunited_home, false",
    })
    void theFiveAttributions(String value, boolean valid) {
        assertThat(LostLifecycleDerivation.isAttribution(value)).isEqualTo(valid);
    }

    @ParameterizedTest(name = "cancel reason {0} → {1}")
    @CsvSource(nullValues = "null", value = {
            "false_alarm, true", "duplicate, true",
            "reunited_home, false", "no_response, false", "gave_up, false", "found_deceased, false", "null, false", "'', false",
    })
    void onlyTwoCancelReasonsInL1(String value, boolean valid) {
        assertThat(LostLifecycleDerivation.isCancelReason(value)).isEqualTo(valid);
    }
}
```

`B/src/test/java/co/scuby/cases/ClaimDerivationTest.java`:

```java
package co.scuby.cases;

import co.scuby.cases.ClaimDerivation.ContactFlags;
import co.scuby.cases.ClaimDerivation.SightingLink;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * «Lo tengo» rules (docs/product/04 · recovery_claim; spec §3, §4.9, §4.10, §4.13). Human review: these tables are the
 * rules — stale 7 days (strictly) after the claimant's last «Lo tengo», the owner-only badge, revisable answers, the 24 h
 * link to the claimant's own pin, the public-contact rule.
 */
class ClaimDerivationTest {

    static final Instant NOW = Instant.parse("2026-10-14T17:00:00Z");
    static final String A_DEVICE = "1".repeat(64);

    @ParameterizedTest(name = "{0} last active {1} ago → {2}")
    @CsvSource({
            "open,      PT1H,           open",
            "open,      P6D,            open",
            "open,      P7D,            open",
            "open,      PT168H0.001S,   stale",
            "open,      P30D,           stale",
            "confirmed, P30D,           confirmed",
            "dismissed, P30D,           dismissed",
    })
    void staleIsDerivedStrictlySevenDaysAfterTheLastActivityAndOnlyForOpenClaims(String stored, Duration idle, String wire) {
        assertThat(ClaimDerivation.wireStatus(stored, NOW.minus(idle), NOW)).isEqualTo(wire);
        assertThat(ClaimDerivation.isStale(stored, NOW.minus(idle), NOW)).isEqualTo("stale".equals(wire));
    }

    @Test
    void theSqlCutoffsMatchTheJavaRules() {
        // non-stale in SQL: last_active_at >= staleCutoff — the instant exactly 7 days ago is not stale in Java either
        assertThat(ClaimDerivation.staleCutoff(NOW)).isEqualTo(NOW.minus(Duration.ofDays(7)));
        assertThat(ClaimDerivation.isStale("open", ClaimDerivation.staleCutoff(NOW), NOW)).isFalse();
        // prefill in SQL: created_at > prefillCutoff — exclusive, like the 15-minute window
        assertThat(ClaimDerivation.prefillCutoff(NOW)).isEqualTo(NOW.minus(Duration.ofHours(24)));
        assertThat(ClaimDerivation.STALE_AFTER).isEqualTo(Duration.ofDays(7));
        assertThat(ClaimDerivation.PREFILL_WINDOW).isEqualTo(Duration.ofHours(24));
    }

    @ParameterizedTest(name = "owner={0} {1} open={2} → {3}")
    @CsvSource(nullValues = "null", value = {
            "true,  active,    2, 2",
            "true,  active,    0, 0",
            "true,  reunited,  3, 0",
            "true,  expired,   1, 0",
            "true,  cancelled, 1, 0",
            "false, active,    2, null",
            "false, active,    0, null",
            "false, reunited,  0, null",
    })
    void theBadgeIsOwnerOnlyAndCountsOnlyOnAnActiveCase(boolean owner, String caseStatus, int openNonStale, Integer expected) {
        assertThat(ClaimDerivation.openClaimCount(owner, caseStatus, openNonStale)).isEqualTo(expected);
    }

    @ParameterizedTest(name = "{0} → {1}: changes={2}")
    @CsvSource({
            "open,      confirmed, true",
            "open,      dismissed, true",
            "confirmed, dismissed, true",
            "dismissed, confirmed, true",
            "confirmed, confirmed, false",
            "dismissed, dismissed, false",
    })
    void answersAreRevisableAndARepeatChangesNothing(String stored, String requested, boolean changes) {
        assertThat(ClaimDerivation.answerChanges(stored, requested)).isEqualTo(changes);
    }

    @ParameterizedTest(name = "answer {0} → {1}")
    @CsvSource(nullValues = "null", value = {"confirmed, true", "dismissed, true", "open, false", "stale, false", "null, false", "'', false"})
    void onlyConfirmedOrDismissedIsAnAnswer(String value, boolean valid) {
        assertThat(ClaimDerivation.isAnswer(value)).isEqualTo(valid);
    }

    /**
     * Whether the claim keeps its from_sighting_id link (and copies the pin's point). Whose pin it is comes from the one
     * "mine" rule (LostCaseDerivation.mine, table-tested in LostCaseDerivationTest); an ineligible pin is ignored, never a
     * refusal of the claim.
     */
    @ParameterizedTest(name = "{0}")
    @CsvSource({
            // label,                     status,                mine,  age,         eligible
            "'mine, 1 h',                 visible,               true,  PT1H,        true",
            "'not mine',                  visible,               false, PT1H,        false",
            "'mine but hidden',           hidden_by_owner,       true,  PT1H,        false",
            "'mine but moderated',        removed_by_moderation, true,  PT1H,        false",
            "'mine but deleted',          deleted_by_reporter,   true,  PT1H,        false",
            "'mine, 23 h 59 min',         visible,               true,  PT23H59M,    true",
            "'mine, exactly 24 h',        visible,               true,  PT24H,       false",
            "'mine, 25 h',                visible,               true,  PT25H,       false",
    })
    void aClaimLinksOnlyTheCallersOwnRecentVisiblePin(String label, String status, boolean mine, Duration age, boolean eligible) {
        var pin = new SightingLink(status, null, A_DEVICE, NOW.minus(age));
        assertThat(ClaimDerivation.prefillEligible(pin, mine, NOW)).as(label).isEqualTo(eligible);
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(nullValues = "null", value = {
            // label,                expose, hasWa, verified, inAppOnly, caseStatus, phone,          expected
            "'public',               true,   true,  true,     false,     active,     +573114829017,  +573114829017",
            "'not exposed',          false,  true,  true,     false,     active,     +573114829017,  null",
            "'not on WhatsApp',      true,   false, true,     false,     active,     +573114829017,  null",
            "'not verified',         true,   true,  false,    false,     active,     +573114829017,  null",
            "'only in the app',      true,   true,  true,     true,      active,     +573114829017,  null",
            "'case not active',      true,   true,  true,     false,     expired,    +573114829017,  null",
            "'number not loaded',    true,   true,  true,     false,     active,     null,           null",
    })
    void theOwnersNumberIsHandedOverOnlyUnderThePublicContactRule(String label, boolean expose, boolean hasWa, boolean verified,
                                                                   boolean inAppOnly, String caseStatus, String phone, String expected) {
        var flags = new ContactFlags(expose, hasWa, verified, inAppOnly);
        assertThat(ClaimDerivation.whatsappPhone(flags, caseStatus, phone)).as(label).isEqualTo(expected);
    }

    @Test
    void thePrefilledTextIsSpanishAndNamesThePetAndTheCode() {
        assertThat(ClaimDerivation.whatsappText("Luna", "7K3PQ"))
                .isEqualTo("Hola, vi tu aviso de Luna en Scuby (7K3PQ) y creo que lo tengo.");
        assertThat(ClaimDerivation.whatsappText(null, "7K3PQ")).isEqualTo("Hola, vi tu aviso en Scuby (7K3PQ) y creo que lo tengo.");
        assertThat(ClaimDerivation.whatsappText("  ", "7K3PQ")).isEqualTo("Hola, vi tu aviso en Scuby (7K3PQ) y creo que lo tengo.");
    }
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `[mvn] test -Dtest='LostLifecycleDerivationTest,ClaimDerivationTest' 2>&1 | tail -15`
Expected: FAIL — compilation errors `cannot find symbol: class LostLifecycleDerivation` / `ClaimDerivation`.

- [ ] **Step 3: Implement `LostLifecycleDerivation`**

`B/src/main/java/co/scuby/cases/LostLifecycleDerivation.java`:

```java
package co.scuby.cases;

import org.jspecify.annotations.Nullable;

import java.time.Duration;
import java.time.Instant;
import java.util.Set;

/**
 * Which lifecycle action a lost case allows now (docs/product/04-lost-workflow.md · Case state machine). Pure.
 * Reunite and cancel close an active case; reopen brings back an expired one within REOPEN_WINDOW of resolved_at
 * (inclusive); a claim on an expired case inside the window reactivates it first (decision #29). An owner action on a
 * case already in its target state is ALREADY_DONE: the endpoint answers its success and writes nothing (a retry after a
 * lost response, a double tap, or a race another request won), so the first call's resolution and attribution stay.
 */
final class LostLifecycleDerivation {

    /** Measured from resolved_at, inclusive: !now.isAfter(resolvedAt + 30 d); SQL resolved_at >= now − 30 d. */
    static final Duration REOPEN_WINDOW = Duration.ofDays(30);

    private static final Set<String> ATTRIBUTIONS = Set.of("platform_sighting", "platform_claim", "platform_share", "offline", "unknown");
    /** L1 writes only these two; found_deceased and gave_up are a proposal to the client (open item O35). */
    private static final Set<String> CANCEL_REASONS = Set.of("false_alarm", "duplicate");

    enum Action { REUNITE, CANCEL, REOPEN, CLAIM }

    enum Outcome { ALLOWED, REACTIVATE, ALREADY_DONE, INVALID_TRANSITION }

    private LostLifecycleDerivation() {}

    static Outcome check(Action action, String status, @Nullable Instant resolvedAt, Instant now) {
        boolean active = "active".equals(status);
        boolean reopenable = "expired".equals(status) && insideReopenWindow(resolvedAt, now);
        return switch (action) {
            case REUNITE -> active ? Outcome.ALLOWED : "reunited".equals(status) ? Outcome.ALREADY_DONE : Outcome.INVALID_TRANSITION;
            case CANCEL -> active ? Outcome.ALLOWED : "cancelled".equals(status) ? Outcome.ALREADY_DONE : Outcome.INVALID_TRANSITION;
            case REOPEN -> active ? Outcome.ALREADY_DONE : reopenable ? Outcome.ALLOWED : Outcome.INVALID_TRANSITION;
            case CLAIM -> active ? Outcome.ALLOWED : reopenable ? Outcome.REACTIVATE : Outcome.INVALID_TRANSITION;
        };
    }

    static boolean insideReopenWindow(@Nullable Instant resolvedAt, Instant now) {
        return resolvedAt != null && !now.isAfter(resolvedAt.plus(REOPEN_WINDOW));
    }

    /** The SQL form of the window: resolved_at >= reopenCutoff(now). */
    static Instant reopenCutoff(Instant now) {
        return now.minus(REOPEN_WINDOW);
    }

    static boolean isAttribution(@Nullable String value) {
        return value != null && ATTRIBUTIONS.contains(value);
    }

    static boolean isCancelReason(@Nullable String value) {
        return value != null && CANCEL_REASONS.contains(value);
    }
}
```

- [ ] **Step 4: Implement `ClaimDerivation`**

`B/src/main/java/co/scuby/cases/ClaimDerivation.java`:

```java
package co.scuby.cases;

import org.jspecify.annotations.Nullable;

import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;

/**
 * Recovery-claim rules (docs/product/04-lost-workflow.md · recovery_claim; L1 design §3, §4.9, §4.10). Pure.
 * A claim is stale when it is still open 7 days after the claimant's last «Lo tengo» on it (last_active_at: the insert,
 * or a repeat that refreshed it); stale is derived, never stored. The badge is
 * owner-only: «a claim must never reduce reach» (04 · Rule: a recovery claim must never reduce reach), and a public
 * «Posible hallazgo» tells helpers the search may be over.
 */
final class ClaimDerivation {

    /** Stale iff lastActiveAt + 7 d is before now (strict); SQL non-stale: last_active_at >= now − 7 d. */
    static final Duration STALE_AFTER = Duration.ofDays(7);
    /** A pin prefills a claim when created within 24 h, exclusive; SQL created_at > now − 24 h. */
    static final Duration PREFILL_WINDOW = Duration.ofHours(24);

    private static final Set<String> ANSWERS = Set.of("confirmed", "dismissed");

    /** The publisher's contact preferences, as stored on the case. */
    record ContactFlags(boolean exposeWhatsapp, boolean phoneHasWhatsapp, boolean contactPhoneVerified, boolean inAppOnly) {}

    /** The pin a claim says it grew out of (from_sighting_id). */
    record SightingLink(String status, @Nullable UUID reporterPersonId, String reporterDeviceHash, Instant createdAt) {}

    private ClaimDerivation() {}

    static boolean isStale(String storedStatus, Instant lastActiveAt, Instant now) {
        return "open".equals(storedStatus) && lastActiveAt.plus(STALE_AFTER).isBefore(now);
    }

    /** The contract's claim status: the stored one, or `stale` for an open claim idle past STALE_AFTER. */
    static String wireStatus(String storedStatus, Instant lastActiveAt, Instant now) {
        return isStale(storedStatus, lastActiveAt, now) ? "stale" : storedStatus;
    }

    static Instant staleCutoff(Instant now) {
        return now.minus(STALE_AFTER);
    }

    static Instant prefillCutoff(Instant now) {
        return now.minus(PREFILL_WINDOW);
    }

    /** open_claim_count on a case view: null for a non-owner (not even queried), 0 off `active`. */
    static @Nullable Integer openClaimCount(boolean owner, String caseStatus, int openNonStale) {
        if (!owner) return null;
        return "active".equals(caseStatus) ? openNonStale : 0;
    }

    static boolean isAnswer(@Nullable String value) {
        return value != null && ANSWERS.contains(value);
    }

    /** Repeating the current answer is a no-op; confirmed ↔ dismissed may change at any time. */
    static boolean answerChanges(String storedStatus, String requested) {
        return !storedStatus.equals(requested);
    }

    /**
     * Whether a claim keeps its from_sighting_id link: the pin is on this case (the caller's query guarantees it), visible,
     * the claimant's own ({@code mine}, from LostCaseDerivation.mine: their person, or an anonymous pin from their device),
     * and created within PREFILL_WINDOW. An ineligible pin is ignored (the claim is stored without the link), never refused.
     */
    static boolean prefillEligible(SightingLink pin, boolean mine, Instant now) {
        return "visible".equals(pin.status()) && mine && pin.createdAt().isAfter(prefillCutoff(now));
    }

    /** The owner's number for the claimant's WhatsApp link, only under the public-contact rule on an active case. */
    static @Nullable String whatsappPhone(ContactFlags flags, String caseStatus, @Nullable String contactPhone) {
        boolean publicContact = flags.exposeWhatsapp() && flags.phoneHasWhatsapp() && flags.contactPhoneVerified() && !flags.inAppOnly();
        return publicContact && "active".equals(caseStatus) ? contactPhone : null;
    }

    /** Spanish for every locale: the owner reads it and no owner language is stored (spec assumption 13). */
    static String whatsappText(@Nullable String petName, String code) {
        String about = petName == null || petName.isBlank() ? "" : " de " + petName.strip();
        return "Hola, vi tu aviso" + about + " en Scuby (" + code + ") y creo que lo tengo.";
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `[mvn] test -Dtest='LostLifecycleDerivationTest,ClaimDerivationTest,ArchitectureTest' 2>&1 | tail -15`
Expected: PASS (`ArchitectureTest` confirms both classes are pure).

- [ ] **Step 6: Mutation score**

Run: `[mvn] test-compile org.pitest:pitest-maven:mutationCoverage 2>&1 | grep -E "Generated|LostLifecycleDerivation|ClaimDerivation|BUILD"`
Expected: `BUILD SUCCESS` and the overall line `>> Generated N mutations Killed M (P%)` with P ≥ 80. Open `B/target/pit-reports/index.html` and record the two classes' scores in the report; a surviving mutant in either class means a missing table row — add the row (it is a rule), do not lower the threshold.

- [ ] **Step 7: Commit**

```bash
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 add \
  backend/src/main/java/co/scuby/cases/LostLifecycleDerivation.java backend/src/main/java/co/scuby/cases/ClaimDerivation.java \
  backend/src/test/java/co/scuby/cases/LostLifecycleDerivationTest.java backend/src/test/java/co/scuby/cases/ClaimDerivationTest.java
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 commit -m "feat: lifecycle and claim rules as pure derivations (reopen window, stale, owner-only badge, prefill, contact rule)"
```

---
### Task 3: `Patch<T>` and the edit, pets and profile rules — `LostEditDerivation`, `MyPetsDerivation`, `ProfileTextDerivation`

PATCH semantics (spec §3: absent = unchanged, explicit `null` = clear where allowed, `{}` = no-op) need a type that keeps the three states apart; Jackson binds an absent record component and an explicit `null` the same way, so `Patch<T>` is filled through Jackson's absent-value and null-value hooks. The three derivations hold the field rules of the edit and the profile update, which columns an edit writes, and how `/me/pets` picks the reopenable code.

**Files:**
- Create: `B/src/main/java/co/scuby/platform/web/Patch.java`, `B/src/main/java/co/scuby/platform/web/PatchDeserializer.java`
- Create: `B/src/main/java/co/scuby/cases/EditLostRequest.java`, `LostEditDerivation.java`, `MyPetRow.java`, `MyPetView.java`, `MyPetsDerivation.java`
- Create: `B/src/main/java/co/scuby/identity/ProfileUpdateRequest.java`, `B/src/main/java/co/scuby/identity/ProfileTextDerivation.java`
- Test: `B/src/test/java/co/scuby/platform/web/PatchTest.java`, `B/src/test/java/co/scuby/cases/LostEditDerivationTest.java`, `B/src/test/java/co/scuby/cases/MyPetsDerivationTest.java`, `B/src/test/java/co/scuby/identity/ProfileTextDerivationTest.java`

**Interfaces:**
- Consumes: `PointInput(Double lat, Double lng)` with `toGeoPoint()`, `GeoPoint`, `LocationPrecisionDerivation.publicCenter(GeoPoint)`.
- Produces:
  - `public final class Patch<T>`: `static <T> Patch<T> absent()`, `static <T> Patch<T> of(@Nullable T value)`, `boolean isPresent()`, `@Nullable T value()`; `equals`/`hashCode`/`toString`. `@JsonDeserialize(using = PatchDeserializer.class)`.
  - `record EditLostRequest(Patch<List<String>> photoUrls, Patch<String> marks, Patch<PointInput> lastSeenPoint, Patch<Double> lastSeenRadiusM, Patch<OffsetDateTime> lastSeenAt)`.
  - `LostEditDerivation`: `static Map<String, String> problems(EditLostRequest body, Instant now, Duration futureTolerance)` (wire field → reason; empty when valid); `record Change(@Nullable List<String> photoUrls, Patch<String> marks, @Nullable GeoPoint point, @Nullable GeoPoint publicPoint, @Nullable Double radiusM, @Nullable Instant lastSeenAt)` with `boolean touchesPet()`, `boolean isEmpty()`; `static Change change(EditLostRequest body, GeoPoint storedPoint)` (call only when `problems` is empty); `static List<String> newPhotos(List<String> sent, List<String> onPet)`.
  - `record MyPetRow(UUID id, @Nullable String name, String species, @Nullable String size, List<String> colors, @Nullable String marks, List<String> photoUrls, @Nullable String activeCaseCode, @Nullable String latestReopenableCode)`; `record MyPetView(String id, String name, String species, @Nullable String size, List<String> colors, @Nullable String marks, List<String> photoUrls, @Nullable String activeCaseCode, @Nullable String reopenableCaseCode)`; `MyPetsDerivation.derive(List<MyPetRow>) → List<MyPetView>`.
  - `record ProfileUpdateRequest(Patch<String> displayName, Patch<String> city, Patch<String> bio, Patch<NotificationPrefsInput> notificationPrefs, Patch<String> photoUrl)` with nested `record NotificationPrefsInput(@JsonProperty(required = true) @Nullable Boolean lost, … found, … adoption, … help)`.
  - `ProfileTextDerivation`: `NAME_MAX = 80`, `BIO_MAX = 280`, `CITY_MAX = 80`; `static boolean hasLink(String)`; `static String trimmedName(String)`; `static Map<String, String> problems(ProfileUpdateRequest)`.

- [ ] **Step 1: Write the failing `Patch` test**

`B/src/test/java/co/scuby/platform/web/PatchTest.java`:

```java
package co.scuby.platform.web;

import org.junit.jupiter.api.Test;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.PropertyNamingStrategies;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Absent, explicit null and a value stay three different things on a record (docs/eng/api.md · Conventions, PATCH). */
class PatchTest {

    record Point(Double lat, Double lng) {}

    record Body(Patch<String> marks, Patch<List<String>> photoUrls, Patch<Point> lastSeenPoint, Patch<Double> radiusM) {}

    static final JsonMapper JSON = JsonMapper.builder().propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE).build();

    private static Body read(String json) {
        return JSON.readValue(json, Body.class);
    }

    @Test
    void anAbsentFieldIsAbsent() {
        Body b = read("{}");
        assertThat(b.marks().isPresent()).isFalse();
        assertThat(b.photoUrls().isPresent()).isFalse();
        assertThat(b.lastSeenPoint().isPresent()).isFalse();
        assertThat(b.radiusM()).isEqualTo(Patch.absent());
    }

    @Test
    void anExplicitNullIsPresentAndNull() {
        Body b = read("{\"marks\":null,\"photo_urls\":null,\"last_seen_point\":null,\"radius_m\":null}");
        assertThat(b.marks().isPresent()).isTrue();
        assertThat(b.marks().value()).isNull();
        assertThat(b.photoUrls()).isEqualTo(Patch.of(null));
        assertThat(b.lastSeenPoint().isPresent()).isTrue();
        assertThat(b.radiusM().value()).isNull();
    }

    @Test
    void aValueIsReadWithItsOwnTypeNestedRecordsAndListsIncluded() {
        Body b = read("{\"marks\":\"Collar rojo\",\"photo_urls\":[\"a\",\"b\"],\"last_seen_point\":{\"lat\":6.25,\"lng\":-75.59},\"radius_m\":300}");
        assertThat(b.marks()).isEqualTo(Patch.of("Collar rojo"));
        assertThat(b.photoUrls().value()).containsExactly("a", "b");
        assertThat(b.lastSeenPoint().value()).isEqualTo(new Point(6.25, -75.59));
        assertThat(b.radiusM().value()).isEqualTo(300.0);
        assertThat(b.marks().isPresent()).isTrue();
    }

    @Test
    void aWrongTypeInsideIsAJacksonError() {
        assertThatThrownBy(() -> read("{\"photo_urls\":\"a\"}")).isInstanceOf(JacksonException.class);
        assertThatThrownBy(() -> read("{\"last_seen_point\":[1,2]}")).isInstanceOf(JacksonException.class);
    }

    @Test
    void equalityAndToString() {
        assertThat(Patch.<String>absent()).isSameAs(Patch.<Integer>absent());
        assertThat(Patch.of("x")).isEqualTo(Patch.of("x")).isNotEqualTo(Patch.of("y")).isNotEqualTo(Patch.absent());
        assertThat(Patch.of(null)).isNotEqualTo(Patch.absent());
        assertThat(Patch.of("x").hashCode()).isEqualTo(Patch.of("x").hashCode());
        assertThat(Patch.absent()).hasToString("Patch.absent");
        assertThat(Patch.of("x")).hasToString("Patch[x]");
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `[mvn] test -Dtest=PatchTest 2>&1 | tail -10`
Expected: FAIL — `cannot find symbol: class Patch`.

- [ ] **Step 3: Implement `Patch` and its deserializer**

`B/src/main/java/co/scuby/platform/web/Patch.java`:

```java
package co.scuby.platform.web;

import org.jspecify.annotations.Nullable;
import tools.jackson.databind.annotation.JsonDeserialize;

import java.util.Objects;

/**
 * One field of a PATCH body (docs/eng/api.md · Conventions): absent (leave it as it is), present with null (clear it,
 * where the contract allows), or present with a value. Jackson binds an absent record component and an explicit null
 * the same way, so a PATCH request record declares each field as Patch&lt;T&gt;; {@link PatchDeserializer} fills it through
 * Jackson's absent-value and null-value hooks. Whether null is allowed is the field rule's business, not this class's.
 */
@JsonDeserialize(using = PatchDeserializer.class)
public final class Patch<T> {

    private static final Patch<?> ABSENT = new Patch<>(false, null);

    private final boolean present;
    private final @Nullable T value;

    private Patch(boolean present, @Nullable T value) {
        this.present = present;
        this.value = value;
    }

    @SuppressWarnings("unchecked")
    public static <T> Patch<T> absent() {
        return (Patch<T>) ABSENT;
    }

    public static <T> Patch<T> of(@Nullable T value) {
        return new Patch<>(true, value);
    }

    public boolean isPresent() {
        return present;
    }

    /** The sent value; null when absent or sent as null (tell them apart with {@link #isPresent()}). */
    public @Nullable T value() {
        return value;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof Patch<?> p && p.present == present && Objects.equals(p.value, value);
    }

    @Override
    public int hashCode() {
        return Objects.hash(present, value);
    }

    @Override
    public String toString() {
        return present ? "Patch[" + value + "]" : "Patch.absent";
    }
}
```

`B/src/main/java/co/scuby/platform/web/PatchDeserializer.java`:

```java
package co.scuby.platform.web;

import org.jspecify.annotations.Nullable;
import tools.jackson.core.JsonParser;
import tools.jackson.databind.BeanProperty;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.JavaType;
import tools.jackson.databind.ValueDeserializer;

/**
 * Reads Patch&lt;T&gt;: a JSON value through T's own deserializer (found for the property's type parameter), an explicit
 * null as Patch.of(null) (getNullValue), and a missing property as Patch.absent() (getAbsentValue, which Jackson calls
 * for a missing creator property such as a record component).
 */
public final class PatchDeserializer extends ValueDeserializer<Patch<?>> {

    private final @Nullable ValueDeserializer<Object> content;

    public PatchDeserializer() {
        this(null);
    }

    private PatchDeserializer(@Nullable ValueDeserializer<Object> content) {
        this.content = content;
    }

    @Override
    public ValueDeserializer<?> createContextual(DeserializationContext ctxt, @Nullable BeanProperty property) {
        JavaType patch = property != null ? property.getType() : ctxt.getContextualType();
        JavaType contentType = patch.containedTypeOrUnknown(0);
        return new PatchDeserializer(ctxt.findContextualValueDeserializer(contentType, property));
    }

    @Override
    public Patch<?> deserialize(JsonParser p, DeserializationContext ctxt) {
        if (content == null) throw new IllegalStateException("PatchDeserializer was not contextualized with its content type");
        return Patch.of(content.deserialize(p, ctxt));
    }

    @Override
    public Object getNullValue(DeserializationContext ctxt) {
        return Patch.of(null);
    }

    @Override
    public Object getAbsentValue(DeserializationContext ctxt) {
        return Patch.absent();
    }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `[mvn] test -Dtest='PatchTest,ArchitectureTest' 2>&1 | tail -10`
Expected: PASS. If `anAbsentFieldIsAbsent` fails with `marks()` being `null` (Jackson did not call `getAbsentValue`), that is a real incompatibility: debug with `superpowers:systematic-debugging` (stuck rule applies) — do not replace `Patch` by nullable fields, which loses the explicit-null state the contract needs.

- [ ] **Step 5: Commit**

```bash
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 add \
  backend/src/main/java/co/scuby/platform/web/Patch.java backend/src/main/java/co/scuby/platform/web/PatchDeserializer.java \
  backend/src/test/java/co/scuby/platform/web/PatchTest.java
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 commit -m "feat: Patch<T> keeps absent, null and a value apart in PATCH bodies"
```

- [ ] **Step 6: Write the failing derivation tests**

`B/src/test/java/co/scuby/cases/LostEditDerivationTest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.web.Patch;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** PATCH /lost-cases/{code} (spec §4.1): the field rules and which columns a body writes. Human review: these are the rules. */
class LostEditDerivationTest {

    static final Instant NOW = Instant.parse("2026-10-14T17:00:00Z");
    static final Duration DRIFT = Duration.ofMinutes(5);
    static final GeoPoint STORED = new GeoPoint(6.2442, -75.5812);

    static EditLostRequest body(Patch<List<String>> photos, Patch<String> marks, Patch<PointInput> point,
                                Patch<Double> radius, Patch<OffsetDateTime> at) {
        return new EditLostRequest(photos, marks, point, radius, at);
    }

    static EditLostRequest empty() {
        return body(Patch.absent(), Patch.absent(), Patch.absent(), Patch.absent(), Patch.absent());
    }

    static EditLostRequest radius(Double r) {
        return body(Patch.absent(), Patch.absent(), Patch.absent(), Patch.of(r), Patch.absent());
    }

    static EditLostRequest photos(List<String> urls) {
        return body(Patch.of(urls), Patch.absent(), Patch.absent(), Patch.absent(), Patch.absent());
    }

    static EditLostRequest point(PointInput p) {
        return body(Patch.absent(), Patch.absent(), Patch.of(p), Patch.absent(), Patch.absent());
    }

    static EditLostRequest lastSeenAt(OffsetDateTime at) {
        return body(Patch.absent(), Patch.absent(), Patch.absent(), Patch.absent(), Patch.of(at));
    }

    static EditLostRequest marks(String m) {
        return body(Patch.absent(), Patch.of(m), Patch.absent(), Patch.absent(), Patch.absent());
    }

    private static Map<String, String> problems(EditLostRequest b) {
        return LostEditDerivation.problems(b, NOW, DRIFT);
    }

    @Test
    void anEmptyBodyHasNoProblemsAndWritesNothing() {
        assertThat(problems(empty())).isEmpty();
        var change = LostEditDerivation.change(empty(), STORED);
        assertThat(change.isEmpty()).isTrue();
        assertThat(change.touchesPet()).isFalse();
    }

    @ParameterizedTest(name = "radius {0} → valid {1}")
    @CsvSource(nullValues = "null", value = {"0.1, true", "300, true", "5000, true", "5000.01, false", "0, false", "-1, false", "NaN, false", "null, false"})
    void theRadiusIsAboveZeroAndAtMost5000(Double r, boolean valid) {
        assertThat(problems(radius(r))).isEqualTo(valid ? Map.of() : Map.of("last_seen_radius_m", "more than 0 and at most 5000"));
    }

    @ParameterizedTest(name = "{0} photos → valid {1}")
    @CsvSource({"1, true", "6, true", "0, false", "7, false"})
    void oneToSixPhotos(int count, boolean valid) {
        List<String> urls = new ArrayList<>(Collections.nCopies(count, "http://localhost/dev-media/a.jpg"));
        assertThat(problems(photos(urls)).containsKey("photo_urls")).isEqualTo(!valid);
    }

    @Test
    void photosCannotBeNullOrContainAnEmptyUrl() {
        assertThat(problems(body(Patch.of(null), Patch.absent(), Patch.absent(), Patch.absent(), Patch.absent())))
                .containsEntry("photo_urls", "1 to 6 photos");
        assertThat(problems(photos(List.of("http://x/a.jpg", " ")))).containsEntry("photo_urls", "a photo url is empty");
    }

    @Test
    void marksAreAtMost500CharactersCountedLikePostgresOrNull() {
        assertThat(problems(marks("🐶".repeat(500)))).isEmpty();
        assertThat(problems(marks("a".repeat(501)))).containsEntry("marks", "at most 500 characters");
        assertThat(problems(marks(null))).isEmpty();
    }

    @ParameterizedTest(name = "point {0},{1} → valid {2}")
    @CsvSource(nullValues = "null", value = {"6.25, -75.59, true", "90, 180, true", "-90, -180, true", "90.1, 0, false",
            "0, -180.1, false", "null, 0, false", "0, null, false"})
    void thePointIsInRange(Double lat, Double lng, boolean valid) {
        assertThat(problems(point(new PointInput(lat, lng))).containsKey("last_seen_point")).isEqualTo(!valid);
    }

    @Test
    void aNullPointIsRefused() {
        assertThat(problems(body(Patch.absent(), Patch.absent(), Patch.of(null), Patch.absent(), Patch.absent())))
                .containsEntry("last_seen_point", "lat -90..90 and lng -180..180");
    }

    @Test
    void lastSeenAtMayBeUpToFiveMinutesAheadAndHasNoLowerBound() {
        OffsetDateTime edge = NOW.plus(DRIFT).atOffset(ZoneOffset.UTC);
        assertThat(problems(lastSeenAt(edge))).isEmpty();
        assertThat(problems(lastSeenAt(edge.plusNanos(1_000_000)))).isEqualTo(Map.of("last_seen_at", "in the future"));
        assertThat(problems(lastSeenAt(OffsetDateTime.parse("2020-01-01T00:00:00-05:00")))).isEmpty();
        assertThat(problems(body(Patch.absent(), Patch.absent(), Patch.absent(), Patch.absent(), Patch.of(null))))
                .isEqualTo(Map.of("last_seen_at", "required"));
    }

    @Test
    void everyBrokenFieldIsNamedAtOnce() {
        var all = body(Patch.of(List.of()), Patch.of("a".repeat(501)), Patch.of(null), Patch.of(0.0), Patch.of(null));
        assertThat(problems(all)).containsOnlyKeys("photo_urls", "marks", "last_seen_point", "last_seen_radius_m", "last_seen_at");
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource({
            // label,                 photos, marks, point,  radius, at,    touchesPet, moves, empty
            "'photos only',           true,   false, false,  false,  false, true,       false, false",
            "'marks only',            false,  true,  false,  false,  false, true,       false, false",
            "'radius only',           false,  false, false,  true,   false, false,      false, false",
            "'time only',             false,  false, false,  false,  true,  false,      false, false",
            "'a new point',           false,  false, true,   false,  false, false,      true,  false",
            "'everything',            true,   true,  true,   true,   true,  true,       true,  false",
    })
    void whichColumnsABodyWrites(String label, boolean photos, boolean marks, boolean point, boolean radius, boolean at,
                                 boolean touchesPet, boolean moves, boolean empty) {
        var b = body(photos ? Patch.of(List.of("http://x/a.jpg")) : Patch.absent(), marks ? Patch.of("Collar") : Patch.absent(),
                point ? Patch.of(new PointInput(6.30, -75.60)) : Patch.absent(), radius ? Patch.of(250.0) : Patch.absent(),
                at ? Patch.of(OffsetDateTime.parse("2026-10-14T08:00:00-05:00")) : Patch.absent());
        var change = LostEditDerivation.change(b, STORED);
        assertThat(change.touchesPet()).as(label).isEqualTo(touchesPet);
        assertThat(change.point() != null).as(label).isEqualTo(moves);
        assertThat(change.isEmpty()).as(label).isEqualTo(empty);
        assertThat(change.radiusM()).isEqualTo(radius ? 250.0 : null);
        assertThat(change.lastSeenAt()).isEqualTo(at ? Instant.parse("2026-10-14T13:00:00Z") : null);
        assertThat(change.photoUrls()).isEqualTo(photos ? List.of("http://x/a.jpg") : null);
        assertThat(change.marks()).isEqualTo(marks ? Patch.of("Collar") : Patch.absent());
    }

    @Test
    void aMovedPointCarriesItsSnappedPublicCenter() {
        var change = LostEditDerivation.change(point(new PointInput(6.30, -75.60)), STORED);
        assertThat(change.point()).isEqualTo(new GeoPoint(6.30, -75.60));
        assertThat(change.publicPoint()).isEqualTo(new GeoPoint(6.3, -75.599348));
    }

    @Test
    void theStoredPointIsNotAMoveAndAloneWritesNothing() {
        var change = LostEditDerivation.change(point(new PointInput(6.2442, -75.5812)), STORED);
        assertThat(change.point()).isNull();
        assertThat(change.publicPoint()).isNull();
        assertThat(change.isEmpty()).isTrue();
    }

    @Test
    void explicitNullMarksTouchThePet() {
        var change = LostEditDerivation.change(marks(null), STORED);
        assertThat(change.touchesPet()).isTrue();
        assertThat(change.marks()).isEqualTo(Patch.of(null));
    }

    @Test
    void onlyPhotosNotAlreadyOnThePetNeedAnUploadCheck() {
        assertThat(LostEditDerivation.newPhotos(List.of("a", "b", "c", "b"), List.of("a", "x"))).containsExactly("b", "c");
        assertThat(LostEditDerivation.newPhotos(List.of("a"), List.of("a"))).isEmpty();
        assertThat(LostEditDerivation.newPhotos(List.of(), List.of("a"))).isEmpty();
    }
}
```

`B/src/test/java/co/scuby/cases/MyPetsDerivationTest.java`:

```java
package co.scuby.cases;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** GET /me/pets (spec §4.11): a reopenable code only when there is no active case; nameless pets are "". */
class MyPetsDerivationTest {

    static final UUID PET = UUID.fromString("00000000-0000-0000-0000-0000000000e1");

    static MyPetRow row(String name, String active, String reopenable) {
        return new MyPetRow(PET, name, "dog", "small", List.of("black", "tan"), "Collar rojo", List.of("http://x/a.jpg"), active, reopenable);
    }

    @ParameterizedTest(name = "active={0} latestReopenable={1} → active={0} reopenable={2}")
    @CsvSource(nullValues = "null", value = {
            "7K3PQ, EXP22, null",
            "7K3PQ, null,  null",
            "null,  EXP22, EXP22",
            "null,  null,  null",
    })
    void anActiveCaseHidesTheReopenableOne(String active, String latestReopenable, String reopenable) {
        MyPetView v = MyPetsDerivation.derive(List.of(row("Luna", active, latestReopenable))).getFirst();
        assertThat(v.activeCaseCode()).isEqualTo(active);
        assertThat(v.reopenableCaseCode()).isEqualTo(reopenable);
    }

    @Test
    void thePetFieldsPassThroughAndANamelessPetIsAnEmptyString() {
        MyPetView named = MyPetsDerivation.derive(List.of(row("Luna", null, null))).getFirst();
        assertThat(named.id()).isEqualTo(PET.toString());
        assertThat(named.name()).isEqualTo("Luna");
        assertThat(named.species()).isEqualTo("dog");
        assertThat(named.size()).isEqualTo("small");
        assertThat(named.colors()).containsExactly("black", "tan");
        assertThat(named.marks()).isEqualTo("Collar rojo");
        assertThat(named.photoUrls()).containsExactly("http://x/a.jpg");
        assertThat(MyPetsDerivation.derive(List.of(row(null, null, null))).getFirst().name()).isEqualTo("");
    }

    @Test
    void theQueryOrderIsKept() {
        var a = new MyPetRow(UUID.fromString("00000000-0000-0000-0000-00000000000a"), "A", "cat", null, List.of(), null, List.of(), null, null);
        var b = new MyPetRow(UUID.fromString("00000000-0000-0000-0000-00000000000b"), "B", "dog", null, List.of(), null, List.of(), null, null);
        assertThat(MyPetsDerivation.derive(List.of(b, a))).extracting(MyPetView::name).containsExactly("B", "A");
        assertThat(MyPetsDerivation.derive(List.of())).isEmpty();
    }
}
```

`B/src/test/java/co/scuby/identity/ProfileTextDerivationTest.java`:

```java
package co.scuby.identity;

import co.scuby.identity.ProfileUpdateRequest.NotificationPrefsInput;
import co.scuby.platform.web.Patch;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** PATCH /me/profile field rules (docs/eng/auth.md · Profile; spec §4.12). Human review: the link rule is this table. */
class ProfileTextDerivationTest {

    static ProfileUpdateRequest only(String field, Patch<?> value) {
        @SuppressWarnings("unchecked") Patch<String> s = (Patch<String>) value;
        return new ProfileUpdateRequest(
                field.equals("display_name") ? s : Patch.absent(),
                field.equals("city") ? s : Patch.absent(),
                field.equals("bio") ? s : Patch.absent(),
                field.equals("notification_prefs") ? (Patch<NotificationPrefsInput>) (Patch<?>) value : Patch.absent(),
                field.equals("photo_url") ? s : Patch.absent());
    }

    @ParameterizedTest(name = "«{0}» → link {1}")
    @CsvSource({
            "'Visita https://scuby.co',                      true",
            "'http://x.co',                                  true",
            "'WWW.ejemplo',                                  true",
            "'escríbeme a wa.me/573001112233',               true",
            "'Tel:3001112233',                               true",
            "'MAILTO:ana@x',                                 true",
            "'mi web: ana.com',                              true",
            "'ana@gmail.com',                                true",
            "'Hola.Soy',                                     true",
            "'Hola. Soy rescatista',                         false",
            "'Pesa 3.5 kg',                                  false",
            "'hotel: Casa Blanca',                           false",
            "'Rescatista de gatos en Envigado.',             false",
            "'e.g. gatos',                                   false",
            "'',                                             false",
    })
    void theBioRefusesLinksAndDomainShapedTokens(String text, boolean link) {
        assertThat(ProfileTextDerivation.hasLink(text)).isEqualTo(link);
    }

    @Test
    void theNameIsTrimmedAndMustNotBeEmpty() {
        assertThat(ProfileTextDerivation.trimmedName("  Ana María Gómez \t")).isEqualTo("Ana María Gómez");
        assertThat(ProfileTextDerivation.problems(only("display_name", Patch.of("   ")))).isEqualTo(Map.of("display_name", "must not be empty"));
        assertThat(ProfileTextDerivation.problems(only("display_name", Patch.of(null)))).isEqualTo(Map.of("display_name", "required"));
        assertThat(ProfileTextDerivation.problems(only("display_name", Patch.of(" " + "🐶".repeat(80) + " ")))).isEmpty();
        assertThat(ProfileTextDerivation.problems(only("display_name", Patch.of("a".repeat(81)))))
                .isEqualTo(Map.of("display_name", "at most 80 characters"));
    }

    @Test
    void cityAndBioLengthsCountCharactersAndNullClears() {
        assertThat(ProfileTextDerivation.problems(only("city", Patch.of("🐶".repeat(80))))).isEmpty();
        assertThat(ProfileTextDerivation.problems(only("city", Patch.of("a".repeat(81))))).isEqualTo(Map.of("city", "at most 80 characters"));
        assertThat(ProfileTextDerivation.problems(only("city", Patch.of(null)))).isEmpty();
        assertThat(ProfileTextDerivation.problems(only("bio", Patch.of("a".repeat(280))))).isEmpty();
        assertThat(ProfileTextDerivation.problems(only("bio", Patch.of("a".repeat(281))))).isEqualTo(Map.of("bio", "at most 280 characters"));
        assertThat(ProfileTextDerivation.problems(only("bio", Patch.of("Mi web: ana.com")))).isEqualTo(Map.of("bio", "no links"));
        assertThat(ProfileTextDerivation.problems(only("bio", Patch.of(null)))).isEmpty();
    }

    @Test
    void notificationPrefsComeAsAllFour() {
        assertThat(ProfileTextDerivation.problems(only("notification_prefs", Patch.of(new NotificationPrefsInput(true, false, true, false))))).isEmpty();
        assertThat(ProfileTextDerivation.problems(only("notification_prefs", Patch.of(null)))).isEqualTo(Map.of("notification_prefs", "required"));
        assertThat(ProfileTextDerivation.problems(only("notification_prefs", Patch.of(new NotificationPrefsInput(null, true, true, null)))))
                .isEqualTo(Map.of("notification_prefs.lost", "required", "notification_prefs.help", "required"));
    }

    @Test
    void aPhotoUrlIsNotEmptyAndNullReturnsToTheInitials() {
        assertThat(ProfileTextDerivation.problems(only("photo_url", Patch.of(" ")))).isEqualTo(Map.of("photo_url", "must not be empty"));
        assertThat(ProfileTextDerivation.problems(only("photo_url", Patch.of(null)))).isEmpty();
        assertThat(ProfileTextDerivation.problems(only("photo_url", Patch.of("http://localhost/dev-media/a.jpg")))).isEmpty();
    }

    @Test
    void anEmptyBodyHasNoProblems() {
        assertThat(ProfileTextDerivation.problems(new ProfileUpdateRequest(Patch.absent(), Patch.absent(), Patch.absent(),
                Patch.absent(), Patch.absent()))).isEmpty();
        assertThat(ProfileTextDerivation.NAME_MAX).isEqualTo(80);
        assertThat(ProfileTextDerivation.BIO_MAX).isEqualTo(280);
        assertThat(ProfileTextDerivation.CITY_MAX).isEqualTo(80);
    }
}
```

- [ ] **Step 7: Run them to verify they fail**

Run: `[mvn] test -Dtest='LostEditDerivationTest,MyPetsDerivationTest,ProfileTextDerivationTest' 2>&1 | tail -15`
Expected: FAIL — `cannot find symbol` for `EditLostRequest`, `LostEditDerivation`, `MyPetRow`, `MyPetsDerivation`, `ProfileUpdateRequest`, `ProfileTextDerivation`.

- [ ] **Step 8: Implement the request records**

`B/src/main/java/co/scuby/cases/EditLostRequest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.web.Patch;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * EditLostRequest (web/src/contracts/owner.ts · editLost). Every field optional: absent = unchanged; marks may be sent
 * as null to clear it; null for any other field is validation_failed (LostEditDerivation.problems). Bound without @Valid:
 * the field rules run after the owner check (L1 design §3).
 */
record EditLostRequest(Patch<List<String>> photoUrls, Patch<String> marks, Patch<PointInput> lastSeenPoint,
                       Patch<Double> lastSeenRadiusM, Patch<OffsetDateTime> lastSeenAt) {}
```

`B/src/main/java/co/scuby/identity/ProfileUpdateRequest.java`:

```java
package co.scuby.identity;

import co.scuby.platform.web.Patch;
import com.fasterxml.jackson.annotation.JsonProperty;
import org.jspecify.annotations.Nullable;

/**
 * ProfileUpdateRequest (web/src/contracts/session.ts · updateProfile). PATCH semantics: absent = unchanged; city, bio and
 * photo_url may be sent as null to clear; null display_name or notification_prefs is validation_failed. The four
 * notification booleans come together (the contract requires them): an absent one is a Jackson error naming it.
 */
record ProfileUpdateRequest(Patch<String> displayName, Patch<String> city, Patch<String> bio,
                            Patch<NotificationPrefsInput> notificationPrefs, Patch<String> photoUrl) {

    record NotificationPrefsInput(@JsonProperty(required = true) @Nullable Boolean lost,
                                  @JsonProperty(required = true) @Nullable Boolean found,
                                  @JsonProperty(required = true) @Nullable Boolean adoption,
                                  @JsonProperty(required = true) @Nullable Boolean help) {}
}
```

- [ ] **Step 9: Implement the three derivations**

`B/src/main/java/co/scuby/cases/LostEditDerivation.java`:

```java
package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.web.Patch;
import org.jspecify.annotations.Nullable;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * PATCH /lost-cases/{code} (docs/product/04-lost-workflow.md · editing; L1 design §4.1). Pure. The field rules, and which
 * columns a valid body writes. A point equal to the stored exact point is not a move. A moved point carries its snapped
 * public center (decision #69) and resets the place name to the generic label (the place namer is never called here).
 * There is no lower bound on last_seen_at, and existing sightings are not revalidated.
 */
final class LostEditDerivation {

    static final int MAX_PHOTOS = 6;
    static final int MAX_MARKS = 500;
    static final double MAX_RADIUS_M = 5000;

    /** What a valid body changes. photoUrls/point/radiusM/lastSeenAt null = unchanged; marks keeps its Patch (null clears). */
    record Change(@Nullable List<String> photoUrls, Patch<String> marks, @Nullable GeoPoint point, @Nullable GeoPoint publicPoint,
                  @Nullable Double radiusM, @Nullable Instant lastSeenAt) {

        boolean touchesPet() {
            return photoUrls != null || marks.isPresent();
        }

        boolean isEmpty() {
            return !touchesPet() && point == null && radiusM == null && lastSeenAt == null;
        }
    }

    private LostEditDerivation() {}

    /** Wire field → what is wrong; empty when the body is valid. futureTolerance is PublishLostService.CLOCK_DRIFT. */
    static Map<String, String> problems(EditLostRequest body, Instant now, Duration futureTolerance) {
        Map<String, String> found = new LinkedHashMap<>();
        if (body.photoUrls().isPresent()) {
            List<String> urls = body.photoUrls().value();
            if (urls == null || urls.isEmpty() || urls.size() > MAX_PHOTOS) found.put("photo_urls", "1 to 6 photos");
            else if (urls.stream().anyMatch(u -> u == null || u.isBlank())) found.put("photo_urls", "a photo url is empty");
        }
        String marks = body.marks().value();
        if (marks != null && marks.codePointCount(0, marks.length()) > MAX_MARKS) found.put("marks", "at most 500 characters");
        if (body.lastSeenPoint().isPresent() && !validPoint(body.lastSeenPoint().value())) {
            found.put("last_seen_point", "lat -90..90 and lng -180..180");
        }
        if (body.lastSeenRadiusM().isPresent()) {
            Double r = body.lastSeenRadiusM().value();
            if (r == null || !(r > 0) || r > MAX_RADIUS_M) found.put("last_seen_radius_m", "more than 0 and at most 5000");
        }
        if (body.lastSeenAt().isPresent()) {
            OffsetDateTime at = body.lastSeenAt().value();
            if (at == null) found.put("last_seen_at", "required");
            else if (at.toInstant().isAfter(now.plus(futureTolerance))) found.put("last_seen_at", "in the future");
        }
        return found;
    }

    /** Call only when problems(...) is empty. */
    static Change change(EditLostRequest body, GeoPoint storedPoint) {
        List<String> photos = body.photoUrls().isPresent() ? List.copyOf(body.photoUrls().value()) : null;
        GeoPoint point = null;
        GeoPoint publicPoint = null;
        if (body.lastSeenPoint().isPresent()) {
            GeoPoint sent = body.lastSeenPoint().value().toGeoPoint();
            if (!sent.equals(storedPoint)) {
                point = sent;
                publicPoint = LocationPrecisionDerivation.publicCenter(sent);
            }
        }
        Double radius = body.lastSeenRadiusM().isPresent() ? body.lastSeenRadiusM().value() : null;
        Instant at = body.lastSeenAt().isPresent() ? body.lastSeenAt().value().toInstant() : null;
        return new Change(photos, body.marks(), point, publicPoint, radius, at);
    }

    /** The sent photos the pet does not have yet: only these go through the upload check (spec §4.1, Q-C1). */
    static List<String> newPhotos(List<String> sent, List<String> onPet) {
        return sent.stream().filter(u -> !onPet.contains(u)).distinct().toList();
    }

    private static boolean validPoint(@Nullable PointInput p) {
        return p != null && p.lat() != null && p.lng() != null
                && p.lat() >= -90 && p.lat() <= 90 && p.lng() >= -180 && p.lng() <= 180;
    }
}
```

`B/src/main/java/co/scuby/cases/MyPetRow.java`:

```java
package co.scuby.cases;

import org.jspecify.annotations.Nullable;

import java.util.List;
import java.util.UUID;

/** One of the caller's pets as GET /me/pets reads it (MyPetsQueries): the pet, the caller's active case, the latest reopenable. */
record MyPetRow(UUID id, @Nullable String name, String species, @Nullable String size, List<String> colors,
                @Nullable String marks, List<String> photoUrls, @Nullable String activeCaseCode, @Nullable String latestReopenableCode) {}
```

`B/src/main/java/co/scuby/cases/MyPetView.java`:

```java
package co.scuby.cases;

import org.jspecify.annotations.Nullable;

import java.util.List;

/** An item of the contract's Pets (web/src/contracts/owner.ts · petWire). Every field present. */
record MyPetView(String id, String name, String species, @Nullable String size, List<String> colors, @Nullable String marks,
                 List<String> photoUrls, @Nullable String activeCaseCode, @Nullable String reopenableCaseCode) {}
```

`B/src/main/java/co/scuby/cases/MyPetsDerivation.java`:

```java
package co.scuby.cases;

import java.util.List;

/** The caller's pet rows (already ordered by the query) → Pets. Pure. A reopenable code only when no case is active. */
final class MyPetsDerivation {

    private MyPetsDerivation() {}

    static List<MyPetView> derive(List<MyPetRow> rows) {
        return rows.stream().map(r -> new MyPetView(r.id().toString(), r.name() == null ? "" : r.name(), r.species(), r.size(),
                r.colors(), r.marks(), r.photoUrls(), r.activeCaseCode(),
                r.activeCaseCode() == null ? r.latestReopenableCode() : null)).toList();
    }
}
```

`B/src/main/java/co/scuby/identity/ProfileTextDerivation.java`:

```java
package co.scuby.identity;

import co.scuby.identity.ProfileUpdateRequest.NotificationPrefsInput;
import org.jspecify.annotations.Nullable;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * PATCH /me/profile field rules (docs/eng/auth.md · Profile; L1 design §4.12). Pure. The bio has no links: a WhatsApp link
 * in a bio would bypass the case's contact preferences. Refused, case-insensitive: http://, https://, www., wa.me, tel:,
 * mailto: and any domain-shaped token (a word, a dot, two or more letters). Accepted false positives: «Hola.Soy».
 */
final class ProfileTextDerivation {

    static final int NAME_MAX = 80;
    static final int BIO_MAX = 280;
    static final int CITY_MAX = 80;

    private static final Pattern LINK = Pattern.compile(
            "(?iu)(https?://|\\bwww\\.|\\bwa\\.me|\\btel:|\\bmailto:|[\\p{L}\\p{N}_-]+\\.\\p{L}{2,})");

    private ProfileTextDerivation() {}

    static boolean hasLink(String text) {
        return LINK.matcher(text).find();
    }

    static String trimmedName(String raw) {
        return raw.strip();
    }

    static Map<String, String> problems(ProfileUpdateRequest body) {
        Map<String, String> found = new LinkedHashMap<>();
        if (body.displayName().isPresent()) {
            String raw = body.displayName().value();
            if (raw == null) found.put("display_name", "required");
            else if (trimmedName(raw).isEmpty()) found.put("display_name", "must not be empty");
            else if (length(trimmedName(raw)) > NAME_MAX) found.put("display_name", "at most 80 characters");
        }
        String city = body.city().value();
        if (city != null && length(city) > CITY_MAX) found.put("city", "at most 80 characters");
        String bio = body.bio().value();
        if (bio != null) {
            if (length(bio) > BIO_MAX) found.put("bio", "at most 280 characters");
            else if (hasLink(bio)) found.put("bio", "no links");
        }
        if (body.notificationPrefs().isPresent()) {
            NotificationPrefsInput prefs = body.notificationPrefs().value();
            if (prefs == null) {
                found.put("notification_prefs", "required");
            } else {
                requireFlag(found, "lost", prefs.lost());
                requireFlag(found, "found", prefs.found());
                requireFlag(found, "adoption", prefs.adoption());
                requireFlag(found, "help", prefs.help());
            }
        }
        String photo = body.photoUrl().value();
        if (photo != null && photo.isBlank()) found.put("photo_url", "must not be empty");
        return found;
    }

    private static void requireFlag(Map<String, String> found, String name, @Nullable Boolean value) {
        if (value == null) found.put("notification_prefs." + name, "required");
    }

    private static int length(String s) {
        return s.codePointCount(0, s.length());
    }
}
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `[mvn] test -Dtest='LostEditDerivationTest,MyPetsDerivationTest,ProfileTextDerivationTest,ArchitectureTest' 2>&1 | tail -15`
Expected: PASS. (`RequiredFieldsTest` does not see these records yet: no controller binds them.)

- [ ] **Step 11: Mutation score**

Run: `[mvn] test-compile org.pitest:pitest-maven:mutationCoverage 2>&1 | grep -E "Generated|BUILD"`
Expected: `BUILD SUCCESS`, overall ≥ 80 %. Record `LostEditDerivation`, `MyPetsDerivation` and `ProfileTextDerivation` scores from `B/target/pit-reports/index.html`; add a table row for any surviving mutant.

- [ ] **Step 12: Commit**

```bash
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 add \
  backend/src/main/java/co/scuby/cases/EditLostRequest.java backend/src/main/java/co/scuby/cases/LostEditDerivation.java \
  backend/src/main/java/co/scuby/cases/MyPetRow.java backend/src/main/java/co/scuby/cases/MyPetView.java \
  backend/src/main/java/co/scuby/cases/MyPetsDerivation.java \
  backend/src/main/java/co/scuby/identity/ProfileUpdateRequest.java backend/src/main/java/co/scuby/identity/ProfileTextDerivation.java \
  backend/src/test/java/co/scuby/cases/LostEditDerivationTest.java backend/src/test/java/co/scuby/cases/MyPetsDerivationTest.java \
  backend/src/test/java/co/scuby/identity/ProfileTextDerivationTest.java
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 commit -m "feat: edit, my-pets and profile field rules as pure derivations"
```

---
### Task 4: Reunite, cancel, reopen — and the harness pieces every later endpoint task uses

`POST /cases/{code}/reunite`, `/cancel`, `/reopen` (spec §4.3–4.5): one conditional `UPDATE` each, a pre-read that classifies errors in the decided order, and the `lost_case_one_active_per_pet` unique violation caught by name. Each is idempotent: on a case already in the action's target state it answers the same `200 {id: code}` with no write; when the `UPDATE` changes 0 rows after a passing pre-read, one re-read tells "already in the target state" (200) from "another state" (`invalid_transition`). The harness gains `ApiClient.patch/delete`, a reusable `Contention` helper for held-row races, fixtures for closed cases and extra cases of one pet, and `ContractCoverageTest` learns to call session routes that have path variables (none existed before; without the fix it looks up a ceiling for `/cases/x/reunite` and fails).

**Files:**
- Modify: `B/src/test/java/co/scuby/support/ApiClient.java` (add `patch`, `delete`)
- Create: `B/src/test/java/co/scuby/support/Contention.java`
- Modify: `B/src/test/java/co/scuby/support/CaseFixtures.java` (add `petOf`, `close`, `lostCaseForPet`)
- Modify: `B/src/test/java/co/scuby/contract/ContractCoverageTest.java` (path variables)
- Modify: `B/src/test/java/co/scuby/support/StatementCeilings.java`
- Create: `B/src/main/java/co/scuby/platform/db/UniqueViolation.java`; Test: `B/src/test/java/co/scuby/platform/db/UniqueViolationTest.java`
- Modify: `B/src/main/java/co/scuby/cases/CaseAccessPolicy.java` (add `isOwner`)
- Create: `B/src/main/java/co/scuby/cases/CreatedView.java`, `CaseErrors.java`, `OwnerAccess.java`, `LifecycleQueries.java`, `CaseLifecycleRequests.java`, `CaseLifecycleService.java`, `CaseLifecycleController.java`
- Modify: `B/src/main/java/co/scuby/cases/CasesSecurityRules.java`
- Test: `B/src/test/java/co/scuby/cases/CaseLifecycleTest.java`, `CaseLifecyclePrecedenceTest.java`, `CaseLifecycleRaceTest.java`

**Interfaces:**
- Consumes: `LostLifecycleDerivation` (Task 2); `LOST_CASE.RESOLUTION`, `RESOLUTION_ATTRIBUTION` (Task 1); `CaseCodes.normalize(String) → Optional<String>`; `LostCaseQueries.isPurged(String)`.
- Produces:
  - `ApiClient.patch(String template, String json, Object... vars)`, `ApiClient.delete(String template, Object... vars)` (checked, like `post`).
  - `support.Contention(DataSource, DSLContext)` implements `AutoCloseable`: `void hold(String sql, Object... binds)` (a transaction left open on its own connection; its backend pid is kept), `void commit()`, `void awaitWaiters(int n)` (≥ n backends blocked by the held transaction's pid within 10 s, else `AssertionError`; a waiter left by another test never counts), `close()` rolls back.
  - `CaseFixtures.petOf(String code) → UUID`; `CaseFixtures.close(String code, String status, Instant resolvedAt)` (resolution stays NULL); `CaseFixtures.lostCaseForPet(UUID owner, UUID pet, String code, String status, Instant publishedAt) → String`.
  - `platform.db.UniqueViolation.on(Throwable, String constraint) → boolean` (public, domain-free).
  - `CaseAccessPolicy.isOwner(UUID createdBy, @Nullable UUID personId) → boolean`.
  - `record CreatedView(String id)` — the contract's `Created`.
  - `CaseErrors`: `notFound()`, `notFound(String what)`, `gone()`, `forbidden()`, `forbidden(String message)`, `invalidTransition()`, `activeCaseExists(String code)`, `invalidField(String field, String reason)`, `invalidFields(Map<String,String>)` — each returns an `ApiException`.
  - `OwnerAccess` (`@Component`): `static String code(String raw)` (normalized or `not_found`), `static Optional<UUID> id(String raw)`, `<T> T require(Optional<T> row, Function<T, UUID> createdBy, UUID me)` (`not_found`, then `forbidden`).
  - `LifecycleQueries` (`@Component`): `record LifecycleRow(String code, UUID createdBy, UUID petId, String status, @Nullable Instant resolvedAt, @Nullable String otherActiveCode)`; `Optional<LifecycleRow> load(String code)`; `boolean close(String code, UUID owner, String status, String resolution, @Nullable String attribution, Instant now)`; `boolean reopen(String code, @Nullable UUID owner, Instant now)` (owner null = claim reactivation); `Optional<String> activeCodeFor(UUID petId)`; `static final String ACTIVE_PER_PET = "lost_case_one_active_per_pet"`.
  - Ceilings: `POST /cases/{code}/reunite` 4, `POST /cases/{code}/cancel` 4, `POST /cases/{code}/reopen` 4 (each: session, pre-read, `UPDATE`, re-read on the race-loser path; 3 on success; 2 for a repeat the pre-read answers).

- [ ] **Step 1: Harness — `ApiClient.patch/delete`, `Contention`, fixtures, coverage with path variables**

In `B/src/test/java/co/scuby/support/ApiClient.java`, after the `put` method add:

```java
    public ApiResponse patch(String template, String json, Object... vars) { return call(HttpMethod.PATCH, template, json, vars); }

    public ApiResponse delete(String template, Object... vars) { return call(HttpMethod.DELETE, template, null, vars); }
```

`B/src/test/java/co/scuby/support/Contention.java`:

```java
package co.scuby.support;

import org.jooq.DSLContext;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.concurrent.TimeUnit;

/**
 * Makes a race deterministic: hold a write in a transaction of its own (another connection), start the request, wait
 * until it queues on that row, then commit (docs/eng/backend.md · Concurrency, race tests). Close it in @AfterEach.
 */
public final class Contention implements AutoCloseable {

    /** Backends blocked by the holder's pid only: a waiter left behind by another test never counts. */
    private static final String WAITING = "SELECT count(*) FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid))";

    private final DataSource dataSource;
    private final DSLContext db;
    private Connection holder;
    private int holderPid;

    public Contention(DataSource dataSource, DSLContext db) {
        this.dataSource = dataSource;
        this.db = db;
    }

    /** Runs {@code sql} in a transaction that stays open until {@link #commit()} or {@link #close()}. */
    public void hold(String sql, Object... binds) throws SQLException {
        if (holder != null) throw new IllegalStateException("already holding a transaction");
        holder = dataSource.getConnection();
        holder.setAutoCommit(false);
        try (PreparedStatement pid = holder.prepareStatement("SELECT pg_backend_pid()");
             ResultSet rs = pid.executeQuery()) {
            rs.next();
            holderPid = rs.getInt(1);
        }
        try (PreparedStatement ps = holder.prepareStatement(sql)) {
            for (int i = 0; i < binds.length; i++) ps.setObject(i + 1, binds[i]);
            ps.execute();
        }
    }

    public void commit() throws SQLException {
        holder.commit();
        holder.close();
        holder = null;
    }

    /** Returns once at least {@code n} backends wait on the held transaction; fails after 10 s. */
    public void awaitWaiters(int n) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            Integer waiting = db.fetchOne(WAITING, holderPid).get(0, Integer.class);
            if (waiting != null && waiting >= n) return;
            Thread.sleep(20);
        }
        throw new AssertionError("no request queued behind the held row within 10 s (waiting: " + db.fetchOne(WAITING, holderPid).get(0) + ")");
    }

    @Override
    public void close() throws SQLException {
        if (holder != null) {
            holder.rollback();
            holder.close();
            holder = null;
        }
    }
}
```

In `B/src/test/java/co/scuby/support/CaseFixtures.java`, before `purge`, add:

```java
    /** The pet a case was published for. */
    public UUID petOf(String code) {
        return db.select(LOST_CASE.PET_ID).from(LOST_CASE).where(LOST_CASE.CODE.eq(code)).fetchOne(LOST_CASE.PET_ID);
    }

    /** Closes a case as expiry or an earlier close left it: status and resolved_at set, resolution left NULL. */
    public void close(String code, String status, Instant resolvedAt) {
        db.update(LOST_CASE).set(LOST_CASE.STATUS, status).set(LOST_CASE.RESOLVED_AT, resolvedAt.atOffset(ZoneOffset.UTC))
          .where(LOST_CASE.CODE.eq(code)).execute();
    }

    /** Another case for an existing pet, at Medellín, 300 m; the pet's owner link is not touched. */
    public String lostCaseForPet(UUID owner, UUID pet, String code, String status, Instant publishedAt) {
        GeoPoint publicAt = LocationPrecisionDerivation.publicCenter(MEDELLIN);
        db.insertInto(LOST_CASE)
          .set(LOST_CASE.CODE, code).set(LOST_CASE.PET_ID, pet).set(LOST_CASE.CREATED_BY, owner)
          .set(LOST_CASE.STATUS, status).set(LOST_CASE.PUBLISHED_AT, publishedAt.atOffset(ZoneOffset.UTC))
          .set(LOST_CASE.RESOLVED_AT, "active".equals(status) ? null : publishedAt.plusSeconds(86_400).atOffset(ZoneOffset.UTC))
          .set(LOST_CASE.CONTACT_PHONE, LUNA_PHONE).set(LOST_CASE.CONTACT_PHONE_VERIFIED, true).set(LOST_CASE.PHONE_HAS_WHATSAPP, true)
          .set(LOST_CASE.EXPOSE_WHATSAPP, true).set(LOST_CASE.EXPOSE_EMAIL, false).set(LOST_CASE.IN_APP_ONLY, false)
          .set(LOST_CASE.LAST_SEEN_LAT, MEDELLIN.lat()).set(LOST_CASE.LAST_SEEN_LNG, MEDELLIN.lng())
          .set(LOST_CASE.LAST_SEEN_PUBLIC_LAT, publicAt.lat()).set(LOST_CASE.LAST_SEEN_PUBLIC_LNG, publicAt.lng())
          .set(LOST_CASE.LAST_SEEN_RADIUS_M, 300.0).set(LOST_CASE.LAST_SEEN_AT, publishedAt.atOffset(ZoneOffset.UTC))
          .execute();
        return code;
    }
```

In `B/src/test/java/co/scuby/contract/ContractCoverageTest.java` replace

```java
            String path = o.path().replaceAll("\\{[^/}]+}", "x");
            var r = anonymous.call(HttpMethod.valueOf(o.method()), path, o.method().equals("GET") || o.method().equals("DELETE") ? null : "{}");
```

with

```java
            // The template itself (its ceiling and contract entry are keyed by it), with "x" for every path variable.
            Object[] vars = java.util.regex.Pattern.compile("\\{[^/}]+}").matcher(o.path()).results().map(m -> (Object) "x").toArray();
            var r = anonymous.call(HttpMethod.valueOf(o.method()), o.path(),
                    o.method().equals("GET") || o.method().equals("DELETE") ? null : "{}", vars);
```

Run: `[mvn] test -Dtest='ContractCoverageTest,HarnessSelfTest,CaseEndpointTest' 2>&1 | tail -10`
Expected: PASS (no behaviour change yet; the existing session routes have no path variables).

- [ ] **Step 2: Write the failing lifecycle tests**

`B/src/test/java/co/scuby/cases/CaseLifecycleTest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.cache.ClearableCache;
import co.scuby.platform.flags.FeatureFlags;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.RESPONSIBILITY_LINK;
import static co.scuby.db.generated.Tables.SIGHTING;
import static org.assertj.core.api.Assertions.assertThat;

/** Reunite, cancel, reopen (docs/product/04 · Case state machine; spec §4.3–4.5). */
@IntegrationTest
class CaseLifecycleTest {

    static final Instant NOW = MutableClock.START;

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient owner;
    ApiClient stranger;
    UUID carolina;

    @BeforeEach
    void setUp() {
        owner = clients.newBrowser();
        carolina = accounts.signIn(owner, "carolina@correo.co");
        stranger = clients.newBrowser();
        accounts.signIn(stranger, "stranger@correo.co");
        cases.luna(carolina);
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, NOW.minusSeconds(3600), NOW.minusSeconds(3600), null, "3".repeat(64), null, "visible");
    }

    private Record luna() {
        return db.selectFrom(LOST_CASE).where(LOST_CASE.CODE.eq("7K3PQ")).fetchOne();
    }

    private ApiResponse reunite(ApiClient as, String code, String attribution) {
        return as.post("/cases/{code}/reunite", "{\"resolution_attribution\":" + json(attribution) + "}", code);
    }

    private ApiResponse cancel(ApiClient as, String code, String resolution) {
        return as.post("/cases/{code}/cancel", "{\"resolution\":" + json(resolution) + "}", code);
    }

    private ApiResponse reopen(ApiClient as, String code) {
        return as.post("/cases/{code}/reopen", null, code);
    }

    private static String json(String s) {
        return s == null ? "null" : "\"" + s + "\"";
    }

    private ApiResponse cold(java.util.function.Supplier<ApiResponse> call) {
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        return call.get();
    }

    private void assertUnchanged() {
        Record r = luna();
        assertThat(r.get(LOST_CASE.STATUS)).isEqualTo("active");
        assertThat(r.get(LOST_CASE.RESOLUTION)).isNull();
        assertThat(r.get(LOST_CASE.RESOLUTION_ATTRIBUTION)).isNull();
        assertThat(r.get(LOST_CASE.RESOLVED_AT)).isNull();
    }

    // --- reunite ---

    @Test
    void reuniteClosesTheCaseWithItsResolutionAndAttributionAndAnswersTheCode() {
        ApiResponse r = reunite(owner, "7k3pq", "platform_sighting");
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/id")).isEqualTo("7K3PQ");
        Record row = luna();
        assertThat(row.get(LOST_CASE.STATUS)).isEqualTo("reunited");
        assertThat(row.get(LOST_CASE.RESOLUTION)).isEqualTo("reunited_home");
        assertThat(row.get(LOST_CASE.RESOLUTION_ATTRIBUTION)).isEqualTo("platform_sighting");
        assertThat(row.get(LOST_CASE.RESOLVED_AT).toInstant()).isEqualTo(NOW);
        ApiResponse page = clients.newBrowser().get("/cases/{code}", "7K3PQ");
        assertThat(page.str("/status")).isEqualTo("reunited");
        assertThat(page.str("/resolved_at")).isEqualTo("2026-10-14T17:00:00Z");
        assertThat(page.isNull("/contact")).isTrue();
    }

    @ParameterizedTest
    @CsvSource({"platform_sighting", "platform_claim", "platform_share", "offline", "unknown"})
    void everyAttributionIsAcceptedAndStoredAsSent(String attribution) {
        assertThat(reunite(owner, "7K3PQ", attribution).status()).isEqualTo(200);
        assertThat(luna().get(LOST_CASE.RESOLUTION_ATTRIBUTION)).isEqualTo(attribution);
    }

    @Test
    void reuniteLeavesThePetItsLinkAndTheSightingsUntouched() {
        UUID pet = cases.petOf("7K3PQ");
        reunite(owner, "7K3PQ", "offline");
        assertThat(db.fetchCount(RESPONSIBILITY_LINK, RESPONSIBILITY_LINK.PET_ID.eq(pet).and(RESPONSIBILITY_LINK.ACTIVE_TO.isNull()))).isEqualTo(1);
        assertThat(db.fetchCount(SIGHTING, SIGHTING.CASE_CODE.eq("7K3PQ").and(SIGHTING.STATUS.eq("visible")))).isEqualTo(1);
    }

    // --- cancel ---

    @ParameterizedTest
    @CsvSource({"false_alarm", "duplicate"})
    void cancelStoresTheReasonAndNoAttribution(String resolution) {
        ApiResponse r = cancel(owner, "7K3PQ", resolution);
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/id")).isEqualTo("7K3PQ");
        Record row = luna();
        assertThat(row.get(LOST_CASE.STATUS)).isEqualTo("cancelled");
        assertThat(row.get(LOST_CASE.RESOLUTION)).isEqualTo(resolution);
        assertThat(row.get(LOST_CASE.RESOLUTION_ATTRIBUTION)).isNull();
        assertThat(row.get(LOST_CASE.RESOLVED_AT).toInstant()).isEqualTo(NOW);
    }

    @Test
    void aCancelledCaseIsStillServedWithoutContactListedInMisCasosAndGoneFromTheFeed() {
        cancel(owner, "7K3PQ", "false_alarm");
        ApiResponse page = clients.newBrowser().get("/cases/{code}", "7K3PQ");
        assertThat(page.status()).isEqualTo(200);
        assertThat(page.str("/status")).isEqualTo("cancelled");
        assertThat(page.isNull("/contact")).isTrue();
        assertThat(clients.newBrowser().get("/feed").json().get("items")).isEmpty();
        assertThat(owner.get("/me/cases").str("/0/status")).isEqualTo("cancelled");
    }

    // --- a case closes once; a repeat of the same close is a success that writes nothing ---

    @Test
    void aRepeatedReuniteAnswersOkAndKeepsTheFirstCallsAttribution() {
        reunite(owner, "7K3PQ", "offline");
        ApiResponse again = cold(() -> reunite(owner, "7K3PQ", "unknown"));       // a retry after a lost response, another attribution
        assertThat(again.status()).isEqualTo(200);
        assertThat(again.str("/id")).isEqualTo("7K3PQ");
        assertThat(again.statements()).as("answered by the pre-read: %s", again.statements()).hasSize(2);
        assertThat(luna().get(LOST_CASE.RESOLUTION)).isEqualTo("reunited_home");
        assertThat(luna().get(LOST_CASE.RESOLUTION_ATTRIBUTION)).as("the first call's attribution stays").isEqualTo("offline");
        ApiResponse cancelAfter = cancel(owner, "7K3PQ", "duplicate");
        assertThat(cancelAfter.status()).isEqualTo(409);
        assertThat(cancelAfter.errorCode()).isEqualTo("invalid_transition");
        assertThat(luna().get(LOST_CASE.STATUS)).isEqualTo("reunited");
    }

    @Test
    void aRepeatedCancelAnswersOkAndKeepsTheFirstCallsReason() {
        cancel(owner, "7K3PQ", "duplicate");
        ApiResponse again = cancel(owner, "7K3PQ", "false_alarm");
        assertThat(again.status()).isEqualTo(200);
        assertThat(again.str("/id")).isEqualTo("7K3PQ");
        assertThat(luna().get(LOST_CASE.RESOLUTION)).isEqualTo("duplicate");
        ApiResponse reuniteAfter = reunite(owner, "7K3PQ", "offline");
        assertThat(reuniteAfter.status()).isEqualTo(409);
        assertThat(reuniteAfter.errorCode()).isEqualTo("invalid_transition");
        assertThat(luna().get(LOST_CASE.RESOLUTION_ATTRIBUTION)).isNull();
    }

    @ParameterizedTest(name = "{0} on {1} → {2}")
    @CsvSource({
            "reunite, expired,   409",
            "reunite, reunited,  200",
            "reunite, cancelled, 409",
            "cancel,  expired,   409",
            "cancel,  reunited,  409",
            "cancel,  cancelled, 200",
    })
    void onAClosedCaseOnlyTheSameCloseIsOkAndNothingIsWritten(String action, String status, int expected) {
        cases.close("7K3PQ", status, NOW.minus(Duration.ofDays(1)));                // resolution left NULL: a write would show
        ApiResponse r = "reunite".equals(action) ? reunite(owner, "7K3PQ", "offline") : cancel(owner, "7K3PQ", "duplicate");
        assertThat(r.status()).isEqualTo(expected);
        if (expected == 409) assertThat(r.errorCode()).isEqualTo("invalid_transition");
        else assertThat(r.str("/id")).isEqualTo("7K3PQ");
        assertThat(luna().get(LOST_CASE.STATUS)).isEqualTo(status);
        assertThat(luna().get(LOST_CASE.RESOLUTION)).as("nothing written").isNull();
        assertThat(luna().get(LOST_CASE.RESOLUTION_ATTRIBUTION)).isNull();
        assertThat(luna().get(LOST_CASE.RESOLVED_AT).toInstant()).isEqualTo(NOW.minus(Duration.ofDays(1)));
    }

    // --- reopen ---

    @Test
    void reopenBringsBackAnExpiredCaseAndKeepsItsSightingsAndPublishedAt() {
        Instant published = luna().get(LOST_CASE.PUBLISHED_AT).toInstant();
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(3)));
        ApiResponse r = reopen(owner, "7K3PQ");
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/id")).isEqualTo("7K3PQ");
        Record row = luna();
        assertThat(row.get(LOST_CASE.STATUS)).isEqualTo("active");
        assertThat(row.get(LOST_CASE.RESOLVED_AT)).isNull();
        assertThat(row.get(LOST_CASE.RESOLUTION)).isNull();
        assertThat(row.get(LOST_CASE.RESOLUTION_ATTRIBUTION)).isNull();
        assertThat(row.get(LOST_CASE.PUBLISHED_AT).toInstant()).isEqualTo(published);
        assertThat(db.fetchCount(SIGHTING, SIGHTING.CASE_CODE.eq("7K3PQ"))).isEqualTo(1);
        assertThat(clients.newBrowser().get("/cases/{code}", "7K3PQ").json().get("sightings")).hasSize(1);
    }

    @Test
    void theReopenWindowIsThirtyDaysInclusive() {
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(30)));
        assertThat(reopen(owner, "7K3PQ").status()).isEqualTo(200);
    }

    @Test
    void oneMillisecondPastThirtyDaysIsInvalidTransition() {
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(30)).minusMillis(1));
        ApiResponse r = reopen(owner, "7K3PQ");
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("invalid_transition");
        assertThat(luna().get(LOST_CASE.STATUS)).isEqualTo("expired");
    }

    @ParameterizedTest
    @CsvSource({"reunited", "cancelled"})
    void aReunitedOrCancelledCaseIsNeverReopened(String status) {
        cases.close("7K3PQ", status, NOW.minus(Duration.ofDays(1)));
        assertThat(reopen(owner, "7K3PQ").errorCode()).isEqualTo("invalid_transition");
        assertThat(luna().get(LOST_CASE.STATUS)).isEqualTo(status);
    }

    @Test
    void reopenOnAnAlreadyActiveCaseAnswersOkAndWritesNothing() {
        Instant published = luna().get(LOST_CASE.PUBLISHED_AT).toInstant();
        ApiResponse r = cold(() -> reopen(owner, "7K3PQ"));                        // a retry, or a claim reactivated it first
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/id")).isEqualTo("7K3PQ");
        assertThat(r.statements()).as("answered by the pre-read: %s", r.statements()).hasSize(2);
        assertUnchanged();
        assertThat(luna().get(LOST_CASE.PUBLISHED_AT).toInstant()).isEqualTo(published);
    }

    @Test
    void reopenNamesThePetsOtherActiveCase() {
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(3)));
        cases.lostCaseForPet(carolina, cases.petOf("7K3PQ"), "NEW22", "active", NOW.minus(Duration.ofDays(1)));
        ApiResponse r = reopen(owner, "7K3PQ");
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("active_case_exists");
        assertThat(r.str("/error/details/case_code")).isEqualTo("NEW22");
        assertThat(luna().get(LOST_CASE.STATUS)).isEqualTo("expired");
    }

    // --- who and which code ---

    @Test
    void anUnknownMalformedOrPurgedCodeIsNotFoundForEveryAction() {
        cases.purge("GONE5");
        for (String code : new String[] {"ZZZZZ", "bad!", "GONE5"}) {
            assertThat(reunite(owner, code, "offline").errorCode()).as(code).isEqualTo("not_found");
            assertThat(cancel(owner, code, "duplicate").errorCode()).as(code).isEqualTo("not_found");
            assertThat(reopen(owner, code).errorCode()).as(code).isEqualTo("not_found");
        }
    }

    @Test
    void someoneElseIsForbiddenAndNothingChanges() {
        assertThat(reunite(stranger, "7K3PQ", "offline").status()).isEqualTo(403);
        assertThat(cancel(stranger, "7K3PQ", "duplicate").errorCode()).isEqualTo("forbidden");
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(1)));
        assertThat(reopen(stranger, "7K3PQ").errorCode()).isEqualTo("forbidden");
        assertThat(luna().get(LOST_CASE.STATUS)).isEqualTo("expired");
    }

    @Test
    void withoutASessionItIsUnauthorized() {
        ApiResponse r = clients.newBrowser().post("/cases/{code}/reunite", "{\"resolution_attribution\":\"offline\"}", "7K3PQ");
        assertThat(r.status()).isEqualTo(401);
        assertThat(r.errorCode()).isEqualTo("unauthorized");
        assertUnchanged();
    }

    @ParameterizedTest(name = "reunite «{0}»")
    @CsvSource(nullValues = "null", value = {"luck", "null", "''", "REUNITED_HOME"})
    void aWrongAttributionIsValidationFailedNamingTheField(String attribution) {
        ApiResponse r = reunite(owner, "7K3PQ", attribution);
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has("resolution_attribution")).isTrue();
        assertUnchanged();
    }

    @ParameterizedTest(name = "cancel «{0}»")
    @CsvSource(nullValues = "null", value = {"reunited_home", "no_response", "gave_up", "null"})
    void aWrongCancelReasonIsValidationFailedNamingTheField(String resolution) {
        ApiResponse r = cancel(owner, "7K3PQ", resolution);
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("resolution")).isTrue();
        assertUnchanged();
    }

    @Test
    void anAbsentRequiredFieldIsAJacksonErrorNamingIt() {
        ApiResponse r = owner.post("/cases/{code}/reunite", "{}", "7K3PQ");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("resolution_attribution")).isTrue();
        assertThat(owner.post("/cases/{code}/cancel", "{}", "7K3PQ").json().at("/error/fields").has("resolution")).isTrue();
        assertUnchanged();
    }

    // --- statements (session-cache miss) ---

    @Test
    void measuredStatements() {
        assertThat(cold(() -> reunite(owner, "7K3PQ", "offline")).statements()).hasSize(3);   // session, pre-read, conditional update
        db.update(LOST_CASE).set(LOST_CASE.STATUS, "expired").set(LOST_CASE.RESOLUTION, (String) null)
          .set(LOST_CASE.RESOLUTION_ATTRIBUTION, (String) null).set(LOST_CASE.RESOLVED_AT, NOW.minusSeconds(60).atOffset(ZoneOffset.UTC)).execute();
        assertThat(cold(() -> reopen(owner, "7K3PQ")).statements()).hasSize(3);                // session, pre-read, conditional update
        assertThat(cold(() -> cancel(owner, "7K3PQ", "duplicate")).statements()).hasSize(3);
        assertThat(cold(() -> cancel(owner, "7K3PQ", "duplicate")).statements()).as("a repeat, answered by the pre-read").hasSize(2);
        assertThat(cold(() -> reopen(owner, "7K3PQ")).statements()).as("refused by the pre-read").hasSize(2);
    }
}
```

`B/src/test/java/co/scuby/cases/CaseLifecyclePrecedenceTest.java`:

```java
package co.scuby.cases;

import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** When two rules fail at once, the first of session → not_found → forbidden → body → status wins (spec §3). */
@IntegrationTest
class CaseLifecyclePrecedenceTest {

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;

    ApiClient owner;
    ApiClient stranger;
    UUID carolina;

    @BeforeEach
    void setUp() {
        owner = clients.newBrowser();
        carolina = accounts.signIn(owner, "carolina@correo.co");
        stranger = clients.newBrowser();
        accounts.signIn(stranger, "stranger@correo.co");
        cases.luna(carolina);
    }

    @Test
    void unauthorizedBeatsEverything() {
        assertThat(clients.newBrowser().post("/cases/{code}/reunite", "{", "ZZZZZ").errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void anUnreadableBodyBeatsTheLookups() {
        assertThat(stranger.post("/cases/{code}/reunite", "{\"resolution_attribution\":{\"x\":1}}", "ZZZZZ").errorCode())
                .isEqualTo("validation_failed");
        assertThat(stranger.post("/cases/{code}/cancel", "{", "ZZZZZ").errorCode()).isEqualTo("validation_failed");
    }

    @Test
    void notFoundBeatsABadBody() {
        assertThat(stranger.post("/cases/{code}/reunite", "{\"resolution_attribution\":\"luck\"}", "ZZZZZ").errorCode()).isEqualTo("not_found");
    }

    @Test
    void forbiddenBeatsABadBody() {
        assertThat(stranger.post("/cases/{code}/reunite", "{\"resolution_attribution\":\"luck\"}", "7K3PQ").errorCode()).isEqualTo("forbidden");
        assertThat(stranger.post("/cases/{code}/cancel", "{\"resolution\":null}", "7K3PQ").errorCode()).isEqualTo("forbidden");
    }

    @Test
    void forbiddenBeatsAClosedCase() {
        cases.close("7K3PQ", "reunited", MutableClock.START.minus(Duration.ofDays(1)));
        assertThat(stranger.post("/cases/{code}/reunite", "{\"resolution_attribution\":\"offline\"}", "7K3PQ").errorCode()).isEqualTo("forbidden");
        assertThat(stranger.post("/cases/{code}/reopen", null, "7K3PQ").errorCode()).isEqualTo("forbidden");
    }

    @Test
    void aBadBodyBeatsAClosedCase() {
        cases.close("7K3PQ", "reunited", MutableClock.START.minus(Duration.ofDays(1)));
        assertThat(owner.post("/cases/{code}/reunite", "{\"resolution_attribution\":\"luck\"}", "7K3PQ").errorCode()).isEqualTo("validation_failed");
        assertThat(owner.post("/cases/{code}/cancel", "{\"resolution\":\"no_response\"}", "7K3PQ").errorCode()).isEqualTo("validation_failed");
    }

    @Test
    void invalidTransitionBeatsActiveCaseExistsOnReopen() {
        cases.close("7K3PQ", "expired", MutableClock.START.minus(Duration.ofDays(31)));
        cases.lostCaseForPet(carolina, cases.petOf("7K3PQ"), "NEW22", "active", MutableClock.START);
        assertThat(owner.post("/cases/{code}/reopen", null, "7K3PQ").errorCode()).isEqualTo("invalid_transition");
    }
}
```

`B/src/test/java/co/scuby/cases/CaseLifecycleRaceTest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.cache.ClearableCache;
import co.scuby.platform.flags.FeatureFlags;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.Contention;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;

import javax.sql.DataSource;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.SIGHTING;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * Closes and reopens take no application lock (decision #59): one conditional UPDATE each. The races of spec §7.2,
 * made deterministic with a held uncommitted row (Contention) or a barrier. Invariants, never lock order; never a 500.
 */
@IntegrationTest
class CaseLifecycleRaceTest {

    /** A signed-in «Lo vi» left uncommitted: it holds FOR KEY SHARE on the case row and on its reporter's person row. */
    static final String HELD_SIGHTING = "INSERT INTO scuby.sighting (id, case_code, lat, lng, seen_at, created_at, reporter_device_hash, reporter_person_id) "
            + "VALUES (gen_random_uuid(), '7K3PQ', 6.2455, -75.5905, now(), now(), repeat('a', 64), ?)";
    static final String HELD_REUNITE = "UPDATE scuby.lost_case SET status = 'reunited', resolved_at = now(), resolution = 'reunited_home', "
            + "resolution_attribution = 'offline' WHERE code = '7K3PQ'";

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired DataSource dataSource;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient owner;
    UUID carolina;
    Contention contention;
    ExecutorService pool = Executors.newFixedThreadPool(4);

    @BeforeEach
    void setUp() {
        contention = new Contention(dataSource, db);
        owner = clients.newBrowser();
        carolina = accounts.signIn(owner, "carolina@correo.co");
        cases.luna(carolina);
    }

    @AfterEach
    void tearDown() throws Exception {
        contention.close();
        pool.shutdownNow();
    }

    private ApiClient twinOf(ApiClient browser) {
        ApiClient twin = clients.newBrowser();
        twin.setCookie("__Host-session", browser.cookie("__Host-session").orElseThrow());
        return twin;
    }

    private String status() {
        return db.select(LOST_CASE.STATUS).from(LOST_CASE).where(LOST_CASE.CODE.eq("7K3PQ")).fetchOne(LOST_CASE.STATUS);
    }

    private String attribution() {
        return db.select(LOST_CASE.RESOLUTION_ATTRIBUTION).from(LOST_CASE).where(LOST_CASE.CODE.eq("7K3PQ")).fetchOne(LOST_CASE.RESOLUTION_ATTRIBUTION);
    }

    @Test
    void aReuniteNeverWaitsForAnUncommittedSightingAndTheSightingStays() throws Exception {
        contention.hold(HELD_SIGHTING, accounts.person("held@correo.co"));
        Future<ApiResponse> f = pool.submit(() -> owner.post("/cases/{code}/reunite", "{\"resolution_attribution\":\"offline\"}", "7K3PQ"));
        assertThat(f.get(10, TimeUnit.SECONDS).status()).isEqualTo(200);
        contention.commit();
        assertThat(status()).isEqualTo("reunited");
        assertThat(db.fetchCount(SIGHTING, SIGHTING.CASE_CODE.eq("7K3PQ"))).isEqualTo(1);
    }

    @Test
    void aCancelNeverWaitsForAnUncommittedSightingEither() throws Exception {
        contention.hold(HELD_SIGHTING, accounts.person("held@correo.co"));
        Future<ApiResponse> f = pool.submit(() -> owner.post("/cases/{code}/cancel", "{\"resolution\":\"duplicate\"}", "7K3PQ"));
        assertThat(f.get(10, TimeUnit.SECONDS).status()).isEqualTo(200);
        contention.commit();
        assertThat(status()).isEqualTo("cancelled");
        assertThat(db.fetchCount(SIGHTING)).isEqualTo(1);
    }

    @Test
    void aSightingCommittedBeforeTheCloseStaysAndOneAfterItIsRefused() {
        ApiClient helper = clients.newBrowser();
        accounts.signIn(helper, "helper@correo.co");
        String body = "{\"point\":{\"lat\":6.2455,\"lng\":-75.5905},\"seen_at\":\"" + MutableClock.START + "\",\"note\":null,\"contact_phone\":null}";
        assertThat(helper.post("/cases/{code}/sightings", body, "7K3PQ").status()).isEqualTo(201);
        assertThat(owner.post("/cases/{code}/reunite", "{\"resolution_attribution\":\"platform_sighting\"}", "7K3PQ").status()).isEqualTo(200);
        ApiResponse late = helper.post("/cases/{code}/sightings", body, "7K3PQ");
        assertThat(late.status()).isEqualTo(409);
        assertThat(late.errorCode()).isEqualTo("invalid_transition");
        assertThat(db.fetchCount(SIGHTING)).isEqualTo(1);
        assertThat(owner.get("/cases/{code}", "7K3PQ").json().get("sightings")).hasSize(1);
    }

    @Test
    void aReuniteAndACancelAtOnceCloseTheCaseExactlyOnce() throws Exception {
        for (int round = 0; round < 6; round++) {
            testDb.reset();
            owner = clients.newBrowser();
            carolina = accounts.signIn(owner, "carolina" + round + "@correo.co");
            cases.luna(carolina);
            ApiClient a = owner;
            ApiClient b = twinOf(owner);
            var barrier = new CyclicBarrier(2);
            Callable<ApiResponse> reunite = () -> { barrier.await(10, TimeUnit.SECONDS);
                return a.post("/cases/{code}/reunite", "{\"resolution_attribution\":\"offline\"}", "7K3PQ"); };
            Callable<ApiResponse> cancel = () -> { barrier.await(10, TimeUnit.SECONDS);
                return b.post("/cases/{code}/cancel", "{\"resolution\":\"duplicate\"}", "7K3PQ"); };
            Future<ApiResponse> fr = pool.submit(reunite);
            Future<ApiResponse> fc = pool.submit(cancel);
            ApiResponse rr = fr.get(30, TimeUnit.SECONDS);
            ApiResponse rc = fc.get(30, TimeUnit.SECONDS);
            assertThat(List.of(rr.status(), rc.status())).as("round %d", round).containsExactlyInAnyOrder(200, 409);
            ApiResponse loser = rr.status() == 409 ? rr : rc;
            assertThat(loser.errorCode()).isEqualTo("invalid_transition");
            assertThat(status()).isEqualTo(rr.status() == 200 ? "reunited" : "cancelled");
        }
    }

    /**
     * Deterministic close against close: a reunite is held uncommitted; the cancel passes its pre-read (active), its UPDATE
     * waits on the row, re-checks status = 'active' after the commit, matches nothing, and its re-read finds `reunited`, a
     * different state from its own target: invalid_transition. The longest path: session, pre-read, UPDATE, re-read = 4.
     */
    @Test
    void aCancelThatMeetsACommittedReuniteIsInvalidTransitionOnTheLongestPath() throws Exception {
        contention.hold(HELD_REUNITE);
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        Future<ApiResponse> f = pool.submit(() -> owner.post("/cases/{code}/cancel", "{\"resolution\":\"duplicate\"}", "7K3PQ"));
        contention.awaitWaiters(1);
        contention.commit();
        ApiResponse r = f.get(30, TimeUnit.SECONDS);
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("invalid_transition");
        assertThat(status()).isEqualTo("reunited");
        assertThat(attribution()).isEqualTo("offline");
        assertThat(r.statements()).as("%s", r.statements()).hasSize(4);
    }

    /** A retried reunite that meets the first one in flight: 200, and the first call's attribution stays. */
    @Test
    void aRetriedReuniteThatMeetsTheFirstOneAnswersOkAndKeepsItsAttribution() throws Exception {
        contention.hold(HELD_REUNITE);
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        Future<ApiResponse> f = pool.submit(() -> owner.post("/cases/{code}/reunite", "{\"resolution_attribution\":\"unknown\"}", "7K3PQ"));
        contention.awaitWaiters(1);
        contention.commit();
        ApiResponse r = f.get(30, TimeUnit.SECONDS);
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/id")).isEqualTo("7K3PQ");
        assertThat(attribution()).as("never overwritten by the retry").isEqualTo("offline");
        assertThat(r.statements()).as("%s", r.statements()).hasSize(4);
    }

    /**
     * The owner's reopen against a claim's reactivation of the same expired case (the reactivation is the reopen UPDATE
     * without the owner guard, held uncommitted here): the reopen's UPDATE waits, re-checks status = 'expired' after the
     * commit, matches nothing, and its re-read finds the case active — what the owner asked for. Both end active: 200.
     */
    @Test
    void aReopenThatMeetsAClaimsReactivationAnswersOkAndTheCaseIsActive() throws Exception {
        cases.close("7K3PQ", "expired", MutableClock.START.minus(Duration.ofDays(2)));
        contention.hold("UPDATE scuby.lost_case SET status = 'active', resolution = NULL, resolution_attribution = NULL, resolved_at = NULL "
                + "WHERE code = '7K3PQ'");
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        Future<ApiResponse> f = pool.submit(() -> owner.post("/cases/{code}/reopen", null, "7K3PQ"));
        contention.awaitWaiters(1);
        contention.commit();
        ApiResponse r = f.get(30, TimeUnit.SECONDS);
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/id")).isEqualTo("7K3PQ");
        assertThat(status()).isEqualTo("active");
        assertThat(r.statements()).as("%s", r.statements()).hasSize(4);
    }

    /**
     * The reopen passes its pre-read (the rival's active case is not committed), its UPDATE waits on the rival's entry in
     * lost_case_one_active_per_pet, the rival commits, the UPDATE fails on the unique index: active_case_exists naming the
     * rival, never a 500. The longest reopen path: session, pre-read, update, active-code read = the ceiling, 4.
     */
    @Test
    void aReopenThatLosesToAnUncommittedPublishOfTheSamePetIsActiveCaseExists() throws Exception {
        cases.close("7K3PQ", "expired", MutableClock.START.minus(Duration.ofDays(2)));
        UUID pet = cases.petOf("7K3PQ");
        contention.hold("INSERT INTO scuby.lost_case (code, pet_id, created_by, status, published_at, contact_phone, contact_phone_verified, "
                + "phone_has_whatsapp, expose_whatsapp, expose_email, in_app_only, last_seen_lat, last_seen_lng, last_seen_public_lat, "
                + "last_seen_public_lng, last_seen_radius_m, last_seen_at) VALUES ('RIVAL', ?, ?, 'active', now(), '+573114829017', true, "
                + "true, true, false, false, 6.2442, -75.5812, 6.2442, -75.580392, 300, now())", pet, carolina);
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        Future<ApiResponse> f = pool.submit(() -> owner.post("/cases/{code}/reopen", null, "7K3PQ"));
        contention.awaitWaiters(1);
        contention.commit();
        ApiResponse r = f.get(30, TimeUnit.SECONDS);
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("active_case_exists");
        assertThat(r.str("/error/details/case_code")).isEqualTo("RIVAL");
        assertThat(status()).isEqualTo("expired");
        assertThat(r.statements()).as("%s", r.statements()).hasSize(4);
    }
}
```

`B/src/test/java/co/scuby/platform/db/UniqueViolationTest.java`:

```java
package co.scuby.platform.db;

import org.junit.jupiter.api.Test;

import java.sql.SQLException;

import static org.assertj.core.api.Assertions.assertThat;

class UniqueViolationTest {

    static final SQLException DUPLICATE = new SQLException(
            "ERROR: duplicate key value violates unique constraint \"lost_case_one_active_per_pet\"", "23505");

    @Test
    void recognisesTheNamedConstraintAnywhereInTheCauseChain() {
        assertThat(UniqueViolation.on(DUPLICATE, "lost_case_one_active_per_pet")).isTrue();
        assertThat(UniqueViolation.on(new RuntimeException("wrapped", new IllegalStateException(DUPLICATE)), "lost_case_one_active_per_pet")).isTrue();
    }

    @Test
    void anotherConstraintAnotherStateOrNoSqlErrorIsNot() {
        assertThat(UniqueViolation.on(DUPLICATE, "sighting_replay_key")).isFalse();
        assertThat(UniqueViolation.on(DUPLICATE, "lost_case_one_active")).as("a prefix of the name").isFalse();
        assertThat(UniqueViolation.on(new SQLException("violates check constraint \"lost_case_one_active_per_pet\"", "23514"),
                "lost_case_one_active_per_pet")).isFalse();
        assertThat(UniqueViolation.on(new RuntimeException("boom"), "lost_case_one_active_per_pet")).isFalse();
    }
}
```

- [ ] **Step 3: Run them to verify they fail**

Run: `[mvn] test -Dtest='CaseLifecycleTest,CaseLifecyclePrecedenceTest,CaseLifecycleRaceTest,UniqueViolationTest' 2>&1 | tail -20`
Expected: FAIL — `cannot find symbol: class UniqueViolation`; once that compiles (Step 4), the endpoint tests fail with `no statement ceiling for POST /cases/{code}/reunite` and then `contract has no POST … → 404` until the controller exists.

- [ ] **Step 4: Implement the shared pieces**

`B/src/main/java/co/scuby/platform/db/UniqueViolation.java`:

```java
package co.scuby.platform.db;

import java.sql.SQLException;

/**
 * Whether an exception is Postgres' unique violation (SQLSTATE 23505) of one named constraint. The constraint name comes
 * from the server message («duplicate key value violates unique constraint "name"»), which stays in the message when the
 * driver's logServerErrorDetail is off (only the row detail is dropped). Domain-free.
 */
public final class UniqueViolation {

    private UniqueViolation() {}

    public static boolean on(Throwable error, String constraint) {
        for (Throwable t = error; t != null; t = t.getCause() == t ? null : t.getCause()) {
            if (t instanceof SQLException sql && "23505".equals(sql.getSQLState())
                    && String.valueOf(sql.getMessage()).contains("\"" + constraint + "\"")) {
                return true;
            }
        }
        return false;
    }
}
```

In `B/src/main/java/co/scuby/cases/CaseAccessPolicy.java` replace the class body with:

```java
@Component
class CaseAccessPolicy {
    Access accessFor(UUID createdBy, Caller caller) {
        return isOwner(createdBy, caller.personId()) ? Access.OWNER : Access.PUBLIC;
    }

    /** The owner of a lost case is the person who published it (lost_case.created_by), by session. */
    boolean isOwner(UUID createdBy, @org.jspecify.annotations.Nullable UUID personId) {
        return createdBy.equals(personId);
    }
}
```

`B/src/main/java/co/scuby/cases/CreatedView.java`:

```java
package co.scuby.cases;

/** The contract's Created: `{id}` — a case code for case actions, a sighting or claim id for theirs. */
record CreatedView(String id) {}
```

`B/src/main/java/co/scuby/cases/CaseErrors.java`:

```java
package co.scuby.cases;

import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;

import java.util.Map;

/** The contract errors the case endpoints answer, built in one place so their messages stay consistent. */
final class CaseErrors {

    private CaseErrors() {}

    static ApiException notFound() {
        return new ApiException(ErrorCode.NOT_FOUND, "no such case");
    }

    static ApiException notFound(String what) {
        return new ApiException(ErrorCode.NOT_FOUND, "no such " + what);
    }

    static ApiException gone() {
        return new ApiException(ErrorCode.GONE, "this case was purged");
    }

    static ApiException forbidden() {
        return forbidden("only the case's owner can do this");
    }

    static ApiException forbidden(String message) {
        return new ApiException(ErrorCode.FORBIDDEN, message);
    }

    static ApiException invalidTransition() {
        return new ApiException(ErrorCode.INVALID_TRANSITION, "the case's status does not allow this");
    }

    static ApiException activeCaseExists(String code) {
        return new ApiException(ErrorCode.ACTIVE_CASE_EXISTS, "the pet already has an active lost case", Map.of(), Map.of("case_code", code));
    }

    static ApiException invalidField(String field, String reason) {
        return invalidFields(Map.of(field, reason));
    }

    static ApiException invalidFields(Map<String, String> fields) {
        return new ApiException(ErrorCode.VALIDATION_FAILED, "request does not match the contract", fields, Map.of());
    }
}
```

`B/src/main/java/co/scuby/cases/OwnerAccess.java`:

```java
package co.scuby.cases;

import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;

/** The first two steps of every owner endpoint (spec §3): the case exists (not_found), the caller is its owner (forbidden). */
@Component
class OwnerAccess {

    private final CaseAccessPolicy policy;

    OwnerAccess(CaseAccessPolicy policy) {
        this.policy = policy;
    }

    /** A path code, upper-cased; anything that cannot be a code is not_found (as CaseCodes.normalize). */
    static String code(String raw) {
        return CaseCodes.normalize(raw).orElseThrow(CaseErrors::notFound);
    }

    /** A path id; a malformed one is simply unknown. */
    static Optional<UUID> id(String raw) {
        try {
            return Optional.of(UUID.fromString(raw));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    <T> T require(Optional<T> row, Function<T, UUID> createdBy, UUID me) {
        T found = row.orElseThrow(CaseErrors::notFound);
        if (!policy.isOwner(createdBy.apply(found), me)) throw CaseErrors.forbidden();
        return found;
    }
}
```

`B/src/main/java/co/scuby/cases/LifecycleQueries.java`:

```java
package co.scuby.cases;

import co.scuby.db.generated.tables.LostCase;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;

/**
 * The lifecycle statements of a lost case: a pre-read and one conditional UPDATE per transition (decision #59, no locks).
 * Every status literal is inline: lost_case_one_active_per_pet is partial on status = 'active'.
 */
@Component
class LifecycleQueries {

    static final String ACTIVE_PER_PET = "lost_case_one_active_per_pet";

    record LifecycleRow(String code, UUID createdBy, UUID petId, String status, @Nullable Instant resolvedAt,
                        @Nullable String otherActiveCode) {}

    private static final LostCase OTHER = LOST_CASE.as("other");

    private final DSLContext db;

    LifecycleQueries(DSLContext db) {
        this.db = db;
    }

    /** The case, and the code of another active case of the same pet, if any (the active_case_exists pre-check). */
    Optional<LifecycleRow> load(String code) {
        Field<String> other = DSL.field(DSL.select(OTHER.CODE).from(OTHER)
                .where(OTHER.PET_ID.eq(LOST_CASE.PET_ID), OTHER.STATUS.eq(DSL.inline("active")), OTHER.CODE.ne(LOST_CASE.CODE)))
                .as("other_active_code");
        return db.select(LOST_CASE.CODE, LOST_CASE.CREATED_BY, LOST_CASE.PET_ID, LOST_CASE.STATUS, LOST_CASE.RESOLVED_AT, other)
                 .from(LOST_CASE).where(LOST_CASE.CODE.eq(code))
                 .fetchOptional(r -> new LifecycleRow(r.get(LOST_CASE.CODE), r.get(LOST_CASE.CREATED_BY), r.get(LOST_CASE.PET_ID),
                         r.get(LOST_CASE.STATUS), r.get(LOST_CASE.RESOLVED_AT) == null ? null : r.get(LOST_CASE.RESOLVED_AT).toInstant(),
                         r.get(other)));
    }

    /** Reunite or cancel: only the owner, only from active. False when the guard did not hold (the race loser). */
    boolean close(String code, UUID owner, String status, String resolution, @Nullable String attribution, Instant now) {
        return db.update(LOST_CASE)
                 .set(LOST_CASE.STATUS, DSL.inline(status))
                 .set(LOST_CASE.RESOLUTION, resolution)
                 .set(LOST_CASE.RESOLUTION_ATTRIBUTION, attribution)
                 .set(LOST_CASE.RESOLVED_AT, now.atOffset(ZoneOffset.UTC))
                 .where(LOST_CASE.CODE.eq(code), LOST_CASE.CREATED_BY.eq(owner), LOST_CASE.STATUS.eq(DSL.inline("active")))
                 .execute() == 1;
    }

    /**
     * Back to active: from expired, inside the reopen window, and only while the pet has no other active case. With
     * owner = null it is a claim's reactivation (decision #29: anyone holding the animal may revive it). A concurrent
     * publish that wins the pet makes this fail on lost_case_one_active_per_pet (caught by the caller).
     */
    boolean reopen(String code, @Nullable UUID owner, Instant now) {
        Condition ownerGuard = owner == null ? DSL.noCondition() : LOST_CASE.CREATED_BY.eq(owner);
        return db.update(LOST_CASE)
                 .set(LOST_CASE.STATUS, DSL.inline("active"))
                 .set(LOST_CASE.RESOLUTION, (String) null)
                 .set(LOST_CASE.RESOLUTION_ATTRIBUTION, (String) null)
                 .set(LOST_CASE.RESOLVED_AT, (java.time.OffsetDateTime) null)
                 .where(LOST_CASE.CODE.eq(code), ownerGuard, LOST_CASE.STATUS.eq(DSL.inline("expired")),
                        LOST_CASE.RESOLVED_AT.ge(LostLifecycleDerivation.reopenCutoff(now).atOffset(ZoneOffset.UTC)),
                        DSL.notExists(DSL.selectOne().from(OTHER)
                                .where(OTHER.PET_ID.eq(LOST_CASE.PET_ID), OTHER.STATUS.eq(DSL.inline("active")))))
                 .execute() == 1;
    }

    Optional<String> activeCodeFor(UUID petId) {
        return db.select(LOST_CASE.CODE).from(LOST_CASE)
                 .where(LOST_CASE.PET_ID.eq(petId), LOST_CASE.STATUS.eq(DSL.inline("active")))
                 .fetchOptional(LOST_CASE.CODE);
    }
}
```

`B/src/main/java/co/scuby/cases/CaseLifecycleRequests.java`:

```java
package co.scuby.cases;

import com.fasterxml.jackson.annotation.JsonProperty;
import org.jspecify.annotations.Nullable;

/**
 * ReuniteRequest and CancelRequest (web/src/contracts/owner.ts). Bound as strings, not enums: a value outside the list
 * is a body error checked after the owner check (spec §3), not a Jackson error before the lookups. Absent is a Jackson error.
 */
final class CaseLifecycleRequests {

    private CaseLifecycleRequests() {}

    record ReuniteRequest(@JsonProperty(required = true) @Nullable String resolutionAttribution) {}

    record CancelRequest(@JsonProperty(required = true) @Nullable String resolution) {}
}
```

`B/src/main/java/co/scuby/cases/CaseLifecycleService.java`:

```java
package co.scuby.cases;

import co.scuby.cases.CaseLifecycleRequests.CancelRequest;
import co.scuby.cases.CaseLifecycleRequests.ReuniteRequest;
import co.scuby.cases.LifecycleQueries.LifecycleRow;
import co.scuby.cases.LostLifecycleDerivation.Action;
import co.scuby.cases.LostLifecycleDerivation.Outcome;
import co.scuby.platform.db.UniqueViolation;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import java.util.function.BooleanSupplier;

/**
 * Reunite, cancel, reopen (docs/product/04-lost-workflow.md · Case state machine; L1 design §4.3–4.5). Order: the case
 * exists → the caller is its owner → the body → the status. Each transition is one conditional UPDATE in autocommit; zero
 * rows after a passing pre-read is the race loser and answers what one re-read classifies. Idempotent: a case already in
 * the action's target state answers the same success with no write (a retry after a lost response, a double tap, or a
 * race another request won), so the first call's resolution and attribution are never overwritten; any other state is
 * invalid_transition. Never re-broadcasts, notifies no one, writes no outbox row (L2 derives what it needs from rows).
 */
@Service
class CaseLifecycleService {

    private final LifecycleQueries queries;
    private final OwnerAccess owners;
    private final Clock clock;

    CaseLifecycleService(LifecycleQueries queries, OwnerAccess owners, Clock clock) {
        this.queries = queries;
        this.owners = owners;
        this.clock = clock;
    }

    String reunite(String rawCode, UUID me, ReuniteRequest body) {
        String code = OwnerAccess.code(rawCode);
        LifecycleRow row = owners.require(queries.load(code), LifecycleRow::createdBy, me);
        if (!LostLifecycleDerivation.isAttribution(body.resolutionAttribution())) {
            throw CaseErrors.invalidField("resolution_attribution", "one of platform_sighting, platform_claim, platform_share, offline, unknown");
        }
        Instant now = clock.instant();
        return close(Action.REUNITE, row, now, () -> queries.close(code, me, "reunited", "reunited_home", body.resolutionAttribution(), now));
    }

    String cancel(String rawCode, UUID me, CancelRequest body) {
        String code = OwnerAccess.code(rawCode);
        LifecycleRow row = owners.require(queries.load(code), LifecycleRow::createdBy, me);
        if (!LostLifecycleDerivation.isCancelReason(body.resolution())) {
            throw CaseErrors.invalidField("resolution", "false_alarm or duplicate");
        }
        Instant now = clock.instant();
        return close(Action.CANCEL, row, now, () -> queries.close(code, me, "cancelled", body.resolution(), null, now));
    }

    /**
     * One close. ALREADY_DONE on the pre-read answers the code with no write; ALLOWED runs the conditional UPDATE; zero
     * rows is the race loser, and one re-read tells "already in the target state" (the code, nothing written) from any
     * other state (invalid_transition).
     */
    private String close(Action action, LifecycleRow row, Instant now, BooleanSupplier update) {
        Outcome before = LostLifecycleDerivation.check(action, row.status(), row.resolvedAt(), now);
        if (before == Outcome.ALREADY_DONE) return row.code();
        if (before != Outcome.ALLOWED) throw CaseErrors.invalidTransition();
        if (update.getAsBoolean()) return row.code();
        LifecycleRow after = queries.load(row.code()).orElseThrow(CaseErrors::notFound);
        if (LostLifecycleDerivation.check(action, after.status(), after.resolvedAt(), now) == Outcome.ALREADY_DONE) return row.code();
        throw CaseErrors.invalidTransition();
    }

    String reopen(String rawCode, UUID me) {
        String code = OwnerAccess.code(rawCode);
        LifecycleRow row = owners.require(queries.load(code), LifecycleRow::createdBy, me);
        Instant now = clock.instant();
        if (alreadyActive(row, now)) return code;
        boolean reopened;
        try {
            reopened = queries.reopen(code, me, now);
        } catch (RuntimeException e) {
            if (!UniqueViolation.on(e, LifecycleQueries.ACTIVE_PER_PET)) throw e;
            throw queries.activeCodeFor(row.petId()).map(CaseErrors::activeCaseExists).orElseGet(CaseErrors::invalidTransition);
        }
        if (reopened) return code;
        // The race loser: a claim's reactivation may have made the case active first — what the owner asked for.
        if (alreadyActive(queries.load(code).orElseThrow(CaseErrors::notFound), now)) return code;
        throw CaseErrors.invalidTransition();
    }

    /**
     * True when this case is already active (reopen has nothing to do); otherwise invalid_transition first (status or
     * window), then active_case_exists (spec §4.5); false when it is reopenable.
     */
    private static boolean alreadyActive(LifecycleRow row, Instant now) {
        Outcome outcome = LostLifecycleDerivation.check(Action.REOPEN, row.status(), row.resolvedAt(), now);
        if (outcome == Outcome.ALREADY_DONE) return true;
        if (outcome != Outcome.ALLOWED) throw CaseErrors.invalidTransition();
        if (row.otherActiveCode() != null) throw CaseErrors.activeCaseExists(row.otherActiveCode());
        return false;
    }
}
```

`B/src/main/java/co/scuby/cases/CaseLifecycleController.java`:

```java
package co.scuby.cases;

import co.scuby.cases.CaseLifecycleRequests.CancelRequest;
import co.scuby.cases.CaseLifecycleRequests.ReuniteRequest;
import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Account;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** reuniteCase, cancelCase, reopenCase: 200 {id: the case code}. Bodies bound without @Valid (the service validates). */
@ApiComponent
@RestController
class CaseLifecycleController {

    private final CaseLifecycleService service;

    CaseLifecycleController(CaseLifecycleService service) {
        this.service = service;
    }

    @PostMapping("/cases/{code}/reunite")
    CreatedView reunite(@PathVariable String code, Account account, @RequestBody ReuniteRequest body) {
        return new CreatedView(service.reunite(code, account.personId(), body));
    }

    @PostMapping("/cases/{code}/cancel")
    CreatedView cancel(@PathVariable String code, Account account, @RequestBody CancelRequest body) {
        return new CreatedView(service.cancel(code, account.personId(), body));
    }

    @PostMapping("/cases/{code}/reopen")
    CreatedView reopen(@PathVariable String code, Account account) {
        return new CreatedView(service.reopen(code, account.personId()));
    }
}
```

In `B/src/main/java/co/scuby/cases/CasesSecurityRules.java` replace the two `rules.requestMatchers` lines with:

```java
        rules.requestMatchers(HttpMethod.POST, "/lost-cases").authenticated();
        rules.requestMatchers(HttpMethod.GET, "/me/cases").authenticated();
        rules.requestMatchers(HttpMethod.POST, "/cases/*/reunite").authenticated();
        rules.requestMatchers(HttpMethod.POST, "/cases/*/cancel").authenticated();
        rules.requestMatchers(HttpMethod.POST, "/cases/*/reopen").authenticated();
```

and update its javadoc to: `/** cases' `session` endpoints (openapi.json security: session), each with its method. Case reads, the feed, «Lo vi» and a reporter's correction and delete are public. */`

In `B/src/test/java/co/scuby/support/StatementCeilings.java`, after the `"POST /cases/{code}/sightings"` entry (keep the trailing commas valid), add:

```java
            Map.entry("POST /cases/{code}/reunite", 4),   // longest path, CaseLifecycleRaceTest (the race loser): session, pre-read (case + other active code), conditional UPDATE (zero rows), re-read; 3 on success (CaseLifecycleTest), 2 for a repeat
            Map.entry("POST /cases/{code}/cancel", 4),    // as reunite
            Map.entry("POST /cases/{code}/reopen", 4),    // longest path, measured by CaseLifecycleRaceTest: session, pre-read, UPDATE (zero rows or the unique violation), re-read or active-code read; 3 on success, 2 on an already active case
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `[mvn] test -Dtest='CaseLifecycleTest,CaseLifecyclePrecedenceTest,CaseLifecycleRaceTest,UniqueViolationTest,ContractCoverageTest,RequiredFieldsTest,ArchitectureTest' 2>&1 | tail -20`
Expected: PASS. `ContractCoverageTest` now also runs `POST /cases/{code}/reunite|cancel|reopen` anonymously → `401`. If `RequiredFieldsTest` names `ReuniteRequest.resolution_attribution` or `CancelRequest.resolution`, the `@JsonProperty(required = true)` is missing.

- [ ] **Step 6: Run the whole suite**

Run: `[mvn] verify 2>&1 | tail -15`
Expected: `BUILD SUCCESS`.

- [ ] **Step 7: Commit**

```bash
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 add \
  backend/src/test/java/co/scuby/support/ApiClient.java backend/src/test/java/co/scuby/support/Contention.java \
  backend/src/test/java/co/scuby/support/CaseFixtures.java backend/src/test/java/co/scuby/support/StatementCeilings.java \
  backend/src/test/java/co/scuby/contract/ContractCoverageTest.java \
  backend/src/main/java/co/scuby/platform/db/UniqueViolation.java backend/src/test/java/co/scuby/platform/db/UniqueViolationTest.java \
  backend/src/main/java/co/scuby/cases/CaseAccessPolicy.java backend/src/main/java/co/scuby/cases/CreatedView.java \
  backend/src/main/java/co/scuby/cases/CaseErrors.java backend/src/main/java/co/scuby/cases/OwnerAccess.java \
  backend/src/main/java/co/scuby/cases/LifecycleQueries.java backend/src/main/java/co/scuby/cases/CaseLifecycleRequests.java \
  backend/src/main/java/co/scuby/cases/CaseLifecycleService.java backend/src/main/java/co/scuby/cases/CaseLifecycleController.java \
  backend/src/main/java/co/scuby/cases/CasesSecurityRules.java \
  backend/src/test/java/co/scuby/cases/CaseLifecycleTest.java backend/src/test/java/co/scuby/cases/CaseLifecyclePrecedenceTest.java \
  backend/src/test/java/co/scuby/cases/CaseLifecycleRaceTest.java
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 commit -m "feat: reunite, cancel and reopen a lost case, one conditional UPDATE each"
```

---
### Task 5: Edit a lost case — `PATCH /lost-cases/{code}`, `PATCH /cases/{code}`, and `Pets.updateLook`

The owner corrects an active case (spec §4.1): photos and signs go to the shared pet through `Pets` (its only writer), the zone and time to the case. Photo checks run before the transaction; the case `UPDATE` comes last as the guard, so a close that commits in between rolls the pet change back. `PATCH /cases/{code}` exists for the other verticals and answers `404` for every code (spec §4.2).

**Files:**
- Modify: `B/src/main/java/co/scuby/pets/Pets.java` (add `LookChange`, `updateLook`)
- Test: `B/src/test/java/co/scuby/pets/PetsLookTest.java`
- Create: `B/src/main/java/co/scuby/cases/EditLostService.java`, `EditLostController.java`, `EditCaseController.java`
- Create: `B/src/test/java/co/scuby/support/Photos.java`
- Modify: `B/src/main/java/co/scuby/cases/CasesSecurityRules.java`, `B/src/test/java/co/scuby/support/StatementCeilings.java`
- Test: `B/src/test/java/co/scuby/cases/EditLostTest.java`, `EditLostPrecedenceTest.java`, `EditLostRaceTest.java`

**Interfaces:**
- Consumes: `Patch<T>`, `EditLostRequest`, `LostEditDerivation.problems/change/newPhotos`, `LostEditDerivation.Change` (Task 3); `OwnerAccess`, `CaseErrors`, `Contention`, `ApiClient.patch`, `CaseFixtures.close/lostCaseForPet/petOf` (Task 4); `PhotoAttachments.requireAttachable(List<String>, UploadPurpose, Caller, String)`; `PublishLostService.CLOCK_DRIFT`; `TransactionTemplate`.
- Produces:
  - `@ModuleApi Pets.LookChange(@Nullable List<String> photoUrls, Patch<String> marks)` (public nested record) and `public void updateLook(UUID petId, LookChange change)` — `@Transactional(propagation = MANDATORY)`; writes only the sent fields; the caller has already authorized the write.
  - `support.Photos.uploaded(ApiClient api, String purpose, String seed) → String` (the stored photo's URL, slot taken by `api`'s caller for `purpose`).
  - Ceilings: `PATCH /lost-cases/{code}` 5, `PATCH /cases/{code}` 1.

- [ ] **Step 1: Write the failing `Pets.updateLook` test**

`B/src/test/java/co/scuby/pets/PetsLookTest.java`:

```java
package co.scuby.pets;

import co.scuby.platform.web.Patch;
import co.scuby.support.Accounts;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.UUID;

import static co.scuby.db.generated.Tables.PET;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Pets stays the only writer of pet: an edit of a lost case changes the shared pet through updateLook (spec §5). */
@IntegrationTest
class PetsLookTest {

    @Autowired Pets pets;
    @Autowired DSLContext db;
    @Autowired TransactionTemplate tx;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;

    UUID pet;

    @BeforeEach
    void setUp() {
        cases.luna(accounts.person("carolina@correo.co"));
        pet = cases.petOf("7K3PQ");
        db.update(PET).set(PET.MARKS, "Collar rojo").where(PET.ID.eq(pet)).execute();
    }

    private String marks() {
        return db.select(PET.MARKS).from(PET).where(PET.ID.eq(pet)).fetchOne(PET.MARKS);
    }

    private List<String> photos() {
        return List.of(db.select(PET.PHOTO_URLS).from(PET).where(PET.ID.eq(pet)).fetchOne(PET.PHOTO_URLS));
    }

    @Test
    void writesOnlyTheSentFields() {
        List<String> before = photos();
        tx.executeWithoutResult(s -> pets.updateLook(pet, new Pets.LookChange(null, Patch.of("Collar azul"))));
        assertThat(marks()).isEqualTo("Collar azul");
        assertThat(photos()).isEqualTo(before);
        tx.executeWithoutResult(s -> pets.updateLook(pet, new Pets.LookChange(List.of("http://x/1.jpg", "http://x/2.jpg"), Patch.absent())));
        assertThat(photos()).containsExactly("http://x/1.jpg", "http://x/2.jpg");
        assertThat(marks()).isEqualTo("Collar azul");
    }

    @Test
    void anExplicitNullClearsTheMarks() {
        tx.executeWithoutResult(s -> pets.updateLook(pet, new Pets.LookChange(null, Patch.of(null))));
        assertThat(marks()).isNull();
    }

    @Test
    void nothingSentIsNoStatement() {
        tx.executeWithoutResult(s -> pets.updateLook(pet, new Pets.LookChange(null, Patch.absent())));
        assertThat(marks()).isEqualTo("Collar rojo");
    }

    @Test
    void itNeedsTheCallersTransaction() {
        assertThatThrownBy(() -> pets.updateLook(pet, new Pets.LookChange(null, Patch.of("x"))))
                .isInstanceOf(IllegalTransactionStateException.class);
        assertThat(marks()).isEqualTo("Collar rojo");
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `[mvn] test -Dtest=PetsLookTest 2>&1 | tail -10`
Expected: FAIL — `cannot find symbol: class LookChange` / `method updateLook`.

- [ ] **Step 3: Implement `Pets.updateLook`**

In `B/src/main/java/co/scuby/pets/Pets.java` add the imports `co.scuby.platform.web.Patch`, `org.jooq.Field`, `java.util.LinkedHashMap`, `java.util.Map`; after `NewPet` add:

```java
    /** What an edit of a case changes on its pet: photoUrls null = unchanged; marks absent = unchanged, null = cleared. */
    public record LookChange(@Nullable List<String> photoUrls, Patch<String> marks) {}
```

and after `requireOwnedBy` add:

```java
    /**
     * Writes the sent look fields of a pet, in the caller's transaction. The caller has authorized the write (the owner of
     * a case of this pet). The pet is shared: the change shows on every case of it, past ones included.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void updateLook(UUID petId, LookChange change) {
        Map<Field<?>, Object> set = new LinkedHashMap<>();
        if (change.photoUrls() != null) set.put(PET.PHOTO_URLS, change.photoUrls().toArray(String[]::new));
        if (change.marks().isPresent()) set.put(PET.MARKS, change.marks().value());
        if (set.isEmpty()) return;
        db.update(PET).set(set).where(PET.ID.eq(petId)).execute();
    }
```

Run: `[mvn] test -Dtest='PetsLookTest,PetsTest' 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 add \
  backend/src/main/java/co/scuby/pets/Pets.java backend/src/test/java/co/scuby/pets/PetsLookTest.java
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 commit -m "feat: Pets.updateLook writes a pet's photos and signs inside the caller's transaction"
```

- [ ] **Step 5: Write the failing edit tests**

`B/src/test/java/co/scuby/support/Photos.java`:

```java
package co.scuby.support;

import co.scuby.platform.crypto.Hashing;
import org.springframework.http.HttpMethod;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

/** A photo this browser's caller uploaded for a purpose, through the real slot and the development bucket. */
public final class Photos {

    private Photos() {}

    /** Takes a slot for {@code purpose} as {@code api}'s caller, stores the bytes (processed at once), returns the photo's URL. */
    public static String uploaded(ApiClient api, String purpose, String seed) {
        byte[] bytes = seed.getBytes(StandardCharsets.UTF_8);
        String sha = Hashing.sha256Hex(bytes);
        ApiResponse slot = api.post("/uploads", """
                {"purpose":"%s","sha256":"%s","content_type":"image/jpeg","bytes":%d}""".formatted(purpose, sha, bytes.length));
        assertThat(slot.status()).as("upload slot: %s", slot.body()).isEqualTo(201);
        if (!slot.isNull("/upload")) api.rawBytes(HttpMethod.PUT, "/dev-media/{sha}.jpg", bytes, "image/jpeg", sha);
        return slot.str("/url");
    }
}
```

`B/src/test/java/co/scuby/cases/EditLostTest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.cache.ClearableCache;
import co.scuby.platform.flags.FeatureFlags;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.Photos;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.SIGHTING;
import static org.assertj.core.api.Assertions.assertThat;

/** PATCH /lost-cases/{code} (docs/product/04 · editing; spec §4.1) and the thin PATCH /cases/{code} (§4.2). */
@IntegrationTest
class EditLostTest {

    static final Instant NOW = MutableClock.START;
    static final String FIXTURE_PHOTO = "http://localhost/dev-media/" + "a".repeat(64) + ".jpg";

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient owner;
    ApiClient stranger;
    UUID carolina;
    UUID pet;

    @BeforeEach
    void setUp() {
        owner = clients.newBrowser();
        carolina = accounts.signIn(owner, "carolina@correo.co");
        stranger = clients.newBrowser();
        accounts.signIn(stranger, "stranger@correo.co");
        cases.luna(carolina);
        pet = cases.petOf("7K3PQ");
        db.update(PET).set(PET.MARKS, "Collar rojo").where(PET.ID.eq(pet)).execute();
        db.update(LOST_CASE).set(LOST_CASE.PLACE_NAME, "Laureles").where(LOST_CASE.CODE.eq("7K3PQ")).execute();
    }

    private ApiResponse edit(ApiClient as, String code, String json) {
        return as.patch("/lost-cases/{code}", json, code);
    }

    private Record luna() {
        return db.selectFrom(LOST_CASE).where(LOST_CASE.CODE.eq("7K3PQ")).fetchOne();
    }

    private Record thePet() {
        return db.selectFrom(PET).where(PET.ID.eq(pet)).fetchOne();
    }

    private ApiResponse cold(java.util.function.Supplier<ApiResponse> call) {
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        return call.get();
    }

    private void assertNothingChanged() {
        assertThat(thePet().get(PET.MARKS)).isEqualTo("Collar rojo");
        assertThat(List.of(thePet().get(PET.PHOTO_URLS))).containsExactly(FIXTURE_PHOTO);
        assertThat(luna().get(LOST_CASE.LAST_SEEN_RADIUS_M)).isEqualTo(100.0);
        assertThat(luna().get(LOST_CASE.PLACE_NAME)).isEqualTo("Laureles");
    }

    @Test
    void photosAndSignsChangeTheSharedPetAndShowOnEveryCaseOfIt() {
        cases.lostCaseForPet(carolina, pet, "OLD22", "reunited", NOW.minus(Duration.ofDays(60)));
        String newPhoto = Photos.uploaded(owner, "pet", "luna-edit-1");
        ApiResponse r = edit(owner, "7K3PQ", "{\"photo_urls\":[\"" + FIXTURE_PHOTO + "\",\"" + newPhoto + "\"],\"marks\":\"Collar azul\"}");
        assertThat(r.status()).isEqualTo(204);
        assertThat(r.body()).isEmpty();
        assertThat(thePet().get(PET.MARKS)).isEqualTo("Collar azul");
        assertThat(List.of(thePet().get(PET.PHOTO_URLS))).containsExactly(FIXTURE_PHOTO, newPhoto);
        for (String code : new String[] {"7K3PQ", "OLD22"}) {
            ApiResponse page = clients.newBrowser().get("/cases/{code}", code);
            assertThat(page.str("/pet/marks")).as(code).isEqualTo("Collar azul");
            assertThat(page.str("/pet/photo_urls/1")).as(code).isEqualTo(newPhoto);
        }
    }

    @Test
    void anExplicitNullClearsTheSigns() {
        assertThat(edit(owner, "7K3PQ", "{\"marks\":null}").status()).isEqualTo(204);
        assertThat(thePet().get(PET.MARKS)).isNull();
    }

    @Test
    void absentFieldsStayAsTheyAre() {
        assertThat(edit(owner, "7K3PQ", "{\"last_seen_radius_m\":300}").status()).isEqualTo(204);
        assertThat(luna().get(LOST_CASE.LAST_SEEN_RADIUS_M)).isEqualTo(300.0);
        assertThat(luna().get(LOST_CASE.PLACE_NAME)).isEqualTo("Laureles");
        assertThat(luna().get(LOST_CASE.LAST_SEEN_LAT)).isEqualTo(6.2442);
        assertThat(thePet().get(PET.MARKS)).isEqualTo("Collar rojo");
        assertThat(List.of(thePet().get(PET.PHOTO_URLS))).containsExactly(FIXTURE_PHOTO);
    }

    @Test
    void aMovedZoneReSnapsThePublicCenterAndShowsTheGenericPlaceLabel() {
        assertThat(edit(owner, "7K3PQ", "{\"last_seen_point\":{\"lat\":6.30,\"lng\":-75.60}}").status()).isEqualTo(204);
        Record row = luna();
        assertThat(row.get(LOST_CASE.LAST_SEEN_LAT)).isEqualTo(6.30);
        assertThat(row.get(LOST_CASE.LAST_SEEN_LNG)).isEqualTo(-75.60);
        assertThat(row.get(LOST_CASE.LAST_SEEN_PUBLIC_LAT)).isEqualTo(6.3);
        assertThat(row.get(LOST_CASE.LAST_SEEN_PUBLIC_LNG)).isEqualTo(-75.599348);
        assertThat(row.get(LOST_CASE.PLACE_NAME)).isNull();
        ApiResponse pub = clients.newBrowser().get("/cases/{code}", "7K3PQ");
        assertThat(pub.json().at("/last_seen/center/lat").asDouble()).isEqualTo(6.3);
        assertThat(pub.json().at("/last_seen/center/lng").asDouble()).isEqualTo(-75.599348);
        assertThat(pub.str("/last_seen/place_name")).isEqualTo("Zona marcada en el mapa");
        assertThat(owner.get("/cases/{code}", "7K3PQ").json().at("/last_seen/center/lng").asDouble()).isEqualTo(-75.60);
    }

    @Test
    void theStoredPointIsNotAMoveAndKeepsThePlaceName() {
        assertThat(edit(owner, "7K3PQ", "{\"last_seen_point\":{\"lat\":6.2442,\"lng\":-75.5812},\"last_seen_radius_m\":250}").status()).isEqualTo(204);
        assertThat(luna().get(LOST_CASE.PLACE_NAME)).isEqualTo("Laureles");
        assertThat(luna().get(LOST_CASE.LAST_SEEN_RADIUS_M)).isEqualTo(250.0);
    }

    @Test
    void lastSeenAtMayBeFiveMinutesAheadButNotMore() {
        assertThat(edit(owner, "7K3PQ", "{\"last_seen_at\":\"2026-10-14T17:05:00Z\"}").status()).isEqualTo(204);
        assertThat(luna().get(LOST_CASE.LAST_SEEN_AT).toInstant()).isEqualTo(Instant.parse("2026-10-14T17:05:00Z"));
        ApiResponse r = edit(owner, "7K3PQ", "{\"last_seen_at\":\"2026-10-14T17:05:00.001Z\"}");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("last_seen_at")).isTrue();
        assertThat(luna().get(LOST_CASE.LAST_SEEN_AT).toInstant()).isEqualTo(Instant.parse("2026-10-14T17:05:00Z"));
    }

    @Test
    void existingSightingsAreNotRevalidated() {
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, NOW.minusSeconds(600), NOW.minusSeconds(600), null, "3".repeat(64), null, "visible");
        assertThat(edit(owner, "7K3PQ", "{\"last_seen_point\":{\"lat\":4.711,\"lng\":-74.07},\"last_seen_at\":\"2026-10-14T16:59:00Z\"}").status())
                .isEqualTo(204);
        assertThat(db.fetchCount(SIGHTING, SIGHTING.STATUS.eq("visible"))).isEqualTo(1);
    }

    @Test
    void anOpenClaimNeverBlocksAnEdit() {
        UUID andres = accounts.person("andres@correo.co");
        db.execute("INSERT INTO scuby.recovery_claim (id, case_code, claimant_person_id, phone, status, created_at) "
                + "VALUES (gen_random_uuid(), '7K3PQ', ?, '+573001112233', 'open', ?)", andres, NOW.atOffset(java.time.ZoneOffset.UTC));
        assertThat(edit(owner, "7K3PQ", "{\"marks\":\"Collar azul\"}").status()).isEqualTo(204);
    }

    @Test
    void anEmptyBodyIsANoOpOnAnActiveCaseWithNoWrite() {
        ApiResponse r = cold(() -> edit(owner, "7K3PQ", "{}"));
        assertThat(r.status()).isEqualTo(204);
        assertThat(r.statements()).as("%s", r.statements()).hasSize(2);           // session, pre-read; no write
        assertNothingChanged();
    }

    @ParameterizedTest
    @CsvSource({"expired", "reunited", "cancelled"})
    void aCaseThatIsNotActiveCannotBeEditedEvenWithAnEmptyBody(String status) {
        cases.close("7K3PQ", status, NOW.minus(Duration.ofDays(1)));
        assertThat(edit(owner, "7K3PQ", "{}").errorCode()).isEqualTo("invalid_transition");
        ApiResponse r = edit(owner, "7K3PQ", "{\"marks\":\"Collar azul\"}");
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("invalid_transition");
        assertThat(thePet().get(PET.MARKS)).isEqualTo("Collar rojo");
    }

    @Test
    void aPhotoTheCallerDidNotUploadForThePetIsRefused() {
        String sightingPhoto = Photos.uploaded(owner, "sighting", "not-for-a-pet");
        for (String photo : new String[] {"http://localhost/dev-media/" + "0".repeat(64) + ".jpg", sightingPhoto,
                Photos.uploaded(stranger, "pet", "someone-elses")}) {
            ApiResponse r = edit(owner, "7K3PQ", "{\"photo_urls\":[\"" + photo + "\"]}");
            assertThat(r.status()).as(photo).isEqualTo(422);
            assertThat(r.json().at("/error/fields").has("photo_urls")).isTrue();
        }
        assertNothingChanged();
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(delimiter = '|', value = {   // default quote character (') so the JSON's double quotes stay literal
            "{\"photo_urls\":[]}                                   | photo_urls",
            "{\"photo_urls\":null}                                 | photo_urls",
            "{\"photo_urls\":[\"a\",\"b\",\"c\",\"d\",\"e\",\"f\",\"g\"]} | photo_urls",
            "{\"photo_urls\":[\"\"]}                               | photo_urls",
            "{\"last_seen_point\":null}                            | last_seen_point",
            "{\"last_seen_point\":{\"lat\":91,\"lng\":0}}          | last_seen_point",
            "{\"last_seen_point\":{\"lat\":0}}                     | last_seen_point",
            "{\"last_seen_radius_m\":0}                            | last_seen_radius_m",
            "{\"last_seen_radius_m\":5000.5}                       | last_seen_radius_m",
            "{\"last_seen_radius_m\":null}                         | last_seen_radius_m",
            "{\"last_seen_at\":null}                               | last_seen_at",
    })
    void aBrokenFieldIsValidationFailedNamingItAndNothingIsWritten(String json, String field) {
        ApiResponse r = edit(owner, "7K3PQ", json);
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has(field)).as(r.body()).isTrue();
        assertNothingChanged();
    }

    @Test
    void marksLongerThan500CharactersAreRefused() {
        ApiResponse r = edit(owner, "7K3PQ", "{\"marks\":\"" + "a".repeat(501) + "\"}");
        assertThat(r.json().at("/error/fields").has("marks")).isTrue();
        assertNothingChanged();
    }

    @Test
    void anUnknownOrMalformedCodeIsNotFoundSomeoneElseIsForbiddenNobodyIsUnauthorized() {
        assertThat(edit(owner, "ZZZZZ", "{\"marks\":\"x\"}").errorCode()).isEqualTo("not_found");
        assertThat(edit(owner, "bad!", "{\"marks\":\"x\"}").errorCode()).isEqualTo("not_found");
        assertThat(edit(stranger, "7K3PQ", "{\"marks\":\"x\"}").errorCode()).isEqualTo("forbidden");
        ApiResponse anon = clients.newBrowser().patch("/lost-cases/{code}", "{\"marks\":\"x\"}", "7K3PQ");
        assertThat(anon.status()).isEqualTo(401);
        assertNothingChanged();
    }

    @Test
    void theOtherVerticalsEditAnswersNotFoundForEveryCodeWithoutAQuery() {
        for (String code : new String[] {"7K3PQ", "ZZZZZ"}) {
            ApiResponse r = cold(() -> owner.patch("/cases/{code}", "{\"marks\":\"x\"}", code));
            assertThat(r.status()).as(code).isEqualTo(404);
            assertThat(r.errorCode()).isEqualTo("not_found");
            assertThat(r.statements()).as("only the session lookup").hasSize(1);
        }
        assertThat(clients.newBrowser().patch("/cases/{code}", "{}", "7K3PQ").status()).isEqualTo(401);
        assertNothingChanged();
    }

    @Test
    void theWorstPathIsFiveStatements() {
        String newPhoto = Photos.uploaded(owner, "pet", "luna-edit-worst");
        ApiResponse r = cold(() -> edit(owner, "7K3PQ", "{\"photo_urls\":[\"" + newPhoto + "\"],\"marks\":\"Collar azul\","
                + "\"last_seen_point\":{\"lat\":6.30,\"lng\":-75.60},\"last_seen_radius_m\":400,\"last_seen_at\":\"2026-10-14T16:00:00Z\"}"));
        assertThat(r.status()).isEqualTo(204);
        assertThat(r.statements()).as("%s", r.statements()).hasSize(5);   // session, pre-read, upload lookup, pet update, case update
    }

    @Test
    void photosAlreadyOnThePetNeedNoUploadLookup() {
        ApiResponse r = cold(() -> edit(owner, "7K3PQ", "{\"photo_urls\":[\"" + FIXTURE_PHOTO + "\"]}"));
        assertThat(r.status()).isEqualTo(204);
        assertThat(r.statements()).as("%s", r.statements()).hasSize(4);   // session, pre-read, pet update, case update
    }
}
```

`B/src/test/java/co/scuby/cases/EditLostPrecedenceTest.java`:

```java
package co.scuby.cases;

import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;

/** session → not_found → forbidden → body (fields, then photos) → status (spec §3, §4.1). */
@IntegrationTest
class EditLostPrecedenceTest {

    static final String BAD = "{\"last_seen_radius_m\":0}";

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;

    ApiClient owner;
    ApiClient stranger;

    @BeforeEach
    void setUp() {
        owner = clients.newBrowser();
        cases.luna(accounts.signIn(owner, "carolina@correo.co"));
        stranger = clients.newBrowser();
        accounts.signIn(stranger, "stranger@correo.co");
    }

    @Test
    void anUnreadableBodyIsAnsweredBeforeAnyLookup() {
        assertThat(stranger.patch("/lost-cases/{code}", "{\"marks\":{\"a\":1}}", "ZZZZZ").errorCode()).isEqualTo("validation_failed");
        assertThat(stranger.patch("/lost-cases/{code}", "{\"photo_urls\":\"x\"}", "ZZZZZ").errorCode()).isEqualTo("validation_failed");
    }

    @Test
    void notFoundBeatsForbiddenAndABadBody() {
        assertThat(stranger.patch("/lost-cases/{code}", BAD, "ZZZZZ").errorCode()).isEqualTo("not_found");
    }

    @Test
    void forbiddenBeatsABadBody() {
        assertThat(stranger.patch("/lost-cases/{code}", BAD, "7K3PQ").errorCode()).isEqualTo("forbidden");
    }

    @Test
    void aBadFieldBeatsAClosedCase() {
        cases.close("7K3PQ", "reunited", MutableClock.START.minus(Duration.ofDays(1)));
        assertThat(owner.patch("/lost-cases/{code}", BAD, "7K3PQ").errorCode()).isEqualTo("validation_failed");
    }

    @Test
    void aPhotoNotUploadedBeatsAClosedCase() {
        cases.close("7K3PQ", "reunited", MutableClock.START.minus(Duration.ofDays(1)));
        var r = owner.patch("/lost-cases/{code}", "{\"photo_urls\":[\"http://localhost/dev-media/" + "0".repeat(64) + ".jpg\"]}", "7K3PQ");
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has("photo_urls")).isTrue();
    }
}
```

`B/src/test/java/co/scuby/cases/EditLostRaceTest.java`:

```java
package co.scuby.cases;

import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.Contention;
import co.scuby.support.IntegrationTest;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import javax.sql.DataSource;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.SIGHTING;
import static org.assertj.core.api.Assertions.assertThat;

/** The edit holds the case row only for its last statement; a close in between rolls the pet change back (spec §4.1, §10). */
@IntegrationTest
class EditLostRaceTest {

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired DataSource dataSource;

    ApiClient owner;
    UUID pet;
    Contention contention;
    ExecutorService pool = Executors.newFixedThreadPool(2);

    @BeforeEach
    void setUp() {
        contention = new Contention(dataSource, db);
        owner = clients.newBrowser();
        cases.luna(accounts.signIn(owner, "carolina@correo.co"));
        pet = cases.petOf("7K3PQ");
        db.update(PET).set(PET.MARKS, "Collar rojo").where(PET.ID.eq(pet)).execute();
    }

    @AfterEach
    void tearDown() throws Exception {
        contention.close();
        pool.shutdownNow();
    }

    private String marks() {
        return db.select(PET.MARKS).from(PET).where(PET.ID.eq(pet)).fetchOne(PET.MARKS);
    }

    @Test
    void anEditAndAnUncommittedSightingBothCommit() throws Exception {
        // A signed-in «Lo vi» (spec §7.2): the uncommitted insert also holds its reporter's person row.
        contention.hold("INSERT INTO scuby.sighting (id, case_code, lat, lng, seen_at, created_at, reporter_device_hash, reporter_person_id) "
                + "VALUES (gen_random_uuid(), '7K3PQ', 6.2455, -75.5905, now(), now(), repeat('a', 64), ?)", accounts.person("held@correo.co"));
        Future<ApiResponse> f = pool.submit(() -> owner.patch("/lost-cases/{code}", "{\"marks\":\"Collar azul\",\"last_seen_radius_m\":250}", "7K3PQ"));
        assertThat(f.get(10, TimeUnit.SECONDS).status()).as("the edit does not wait for the sighting").isEqualTo(204);
        contention.commit();
        assertThat(marks()).isEqualTo("Collar azul");
        assertThat(db.fetchCount(SIGHTING)).isEqualTo(1);
        assertThat(db.select(LOST_CASE.LAST_SEEN_RADIUS_M).from(LOST_CASE).fetchOne(LOST_CASE.LAST_SEEN_RADIUS_M)).isEqualTo(250.0);
    }

    @Test
    void aCloseCommittedBetweenThePetUpdateAndTheCaseGuardRollsThePetBack() throws Exception {
        contention.hold("UPDATE scuby.lost_case SET status = 'reunited', resolved_at = now(), resolution = 'reunited_home' WHERE code = '7K3PQ'");
        Future<ApiResponse> f = pool.submit(() -> owner.patch("/lost-cases/{code}", "{\"marks\":\"Collar azul\"}", "7K3PQ"));
        contention.awaitWaiters(1);                // the pet is updated; the case guard waits on the held row
        contention.commit();
        ApiResponse r = f.get(30, TimeUnit.SECONDS);
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("invalid_transition");
        assertThat(marks()).as("the pet change rolled back with the refused guard").isEqualTo("Collar rojo");
    }
}
```

- [ ] **Step 6: Run them to verify they fail**

Run: `[mvn] test -Dtest='EditLostTest,EditLostPrecedenceTest,EditLostRaceTest' 2>&1 | tail -15`
Expected: FAIL — `no statement ceiling for PATCH /lost-cases/{code}` (and then 404/405 answers until the controllers exist).

- [ ] **Step 7: Implement the edit**

`B/src/main/java/co/scuby/cases/EditLostService.java`:

```java
package co.scuby.cases;

import co.scuby.pets.Pets;
import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.security.Account;
import co.scuby.platform.security.Caller;
import co.scuby.uploads.PhotoAttachments;
import co.scuby.uploads.UploadPurpose;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PET;

/**
 * PATCH /lost-cases/{code} (docs/product/04-lost-workflow.md · editing; L1 design §4.1). Order: the case exists → the
 * caller is its owner → the field rules → the photos (outside any transaction: S3 in staging) → active. Then one
 * transaction: the pet's look through Pets, and last, as the guard, the case UPDATE (… AND status = 'active'). Zero rows
 * there is invalid_transition and rolls the pet change back. The case row is held only by that last statement. Never
 * re-broadcasts (decision #27); the place namer is never called (a network call): a moved zone gets the generic label.
 */
@Service
class EditLostService {

    record Target(UUID createdBy, String status, UUID petId, GeoPoint point, List<String> petPhotos) {}

    private final DSLContext db;
    private final Clock clock;
    private final OwnerAccess owners;
    private final Pets pets;
    private final PhotoAttachments photos;
    private final TransactionTemplate tx;

    EditLostService(DSLContext db, Clock clock, OwnerAccess owners, Pets pets, PhotoAttachments photos, TransactionTemplate tx) {
        this.db = db;
        this.clock = clock;
        this.owners = owners;
        this.pets = pets;
        this.photos = photos;
        this.tx = tx;
    }

    void edit(String rawCode, Account account, Caller caller, EditLostRequest body) {
        String code = OwnerAccess.code(rawCode);
        UUID me = account.personId();
        Instant now = clock.instant();
        Target target = owners.require(target(code), Target::createdBy, me);
        Map<String, String> problems = LostEditDerivation.problems(body, now, PublishLostService.CLOCK_DRIFT);
        if (!problems.isEmpty()) throw CaseErrors.invalidFields(problems);
        if (body.photoUrls().isPresent()) {
            photos.requireAttachable(LostEditDerivation.newPhotos(body.photoUrls().value(), target.petPhotos()),
                    UploadPurpose.pet, caller, "photo_urls");
        }
        if (!"active".equals(target.status())) throw CaseErrors.invalidTransition();
        LostEditDerivation.Change change = LostEditDerivation.change(body, target.point());
        if (change.isEmpty()) return;
        tx.executeWithoutResult(status -> {
            if (change.touchesPet()) pets.updateLook(target.petId(), new Pets.LookChange(change.photoUrls(), change.marks()));
            if (updateCase(code, me, change) == 0) throw CaseErrors.invalidTransition();
        });
    }

    private Optional<Target> target(String code) {
        return db.select(LOST_CASE.CREATED_BY, LOST_CASE.STATUS, LOST_CASE.PET_ID, LOST_CASE.LAST_SEEN_LAT, LOST_CASE.LAST_SEEN_LNG, PET.PHOTO_URLS)
                 .from(LOST_CASE).join(PET).on(PET.ID.eq(LOST_CASE.PET_ID))
                 .where(LOST_CASE.CODE.eq(code))
                 .fetchOptional(r -> new Target(r.get(LOST_CASE.CREATED_BY), r.get(LOST_CASE.STATUS), r.get(LOST_CASE.PET_ID),
                         new GeoPoint(r.get(LOST_CASE.LAST_SEEN_LAT), r.get(LOST_CASE.LAST_SEEN_LNG)), Arrays.asList(r.get(PET.PHOTO_URLS))));
    }

    /** The case's sent fields, guarded by owner and active; SET status = status when only pet fields were sent. */
    private int updateCase(String code, UUID me, LostEditDerivation.Change change) {
        Map<Field<?>, Object> set = new LinkedHashMap<>();
        if (change.point() != null) {
            set.put(LOST_CASE.LAST_SEEN_LAT, change.point().lat());
            set.put(LOST_CASE.LAST_SEEN_LNG, change.point().lng());
            set.put(LOST_CASE.LAST_SEEN_PUBLIC_LAT, change.publicPoint().lat());
            set.put(LOST_CASE.LAST_SEEN_PUBLIC_LNG, change.publicPoint().lng());
            set.put(LOST_CASE.PLACE_NAME, null);
        }
        if (change.radiusM() != null) set.put(LOST_CASE.LAST_SEEN_RADIUS_M, change.radiusM());
        if (change.lastSeenAt() != null) set.put(LOST_CASE.LAST_SEEN_AT, change.lastSeenAt().atOffset(ZoneOffset.UTC));
        if (set.isEmpty()) set.put(LOST_CASE.STATUS, LOST_CASE.STATUS);
        return db.update(LOST_CASE).set(set)
                 .where(LOST_CASE.CODE.eq(code), LOST_CASE.CREATED_BY.eq(me), LOST_CASE.STATUS.eq(DSL.inline("active")))
                 .execute();
    }
}
```

`B/src/main/java/co/scuby/cases/EditLostController.java`:

```java
package co.scuby.cases;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Account;
import co.scuby.platform.security.Caller;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** editLost: 204. The body is bound without @Valid: its rules run after the owner check (L1 design §3). */
@ApiComponent
@RestController
class EditLostController {

    private final EditLostService service;

    EditLostController(EditLostService service) {
        this.service = service;
    }

    @PatchMapping("/lost-cases/{code}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void edit(@PathVariable String code, Account account, Caller caller, @RequestBody EditLostRequest body) {
        service.edit(code, account, caller, body);
    }
}
```

`B/src/main/java/co/scuby/cases/EditCaseController.java`:

```java
package co.scuby.cases;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Account;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * editCase, for found, adoption and help cases (L1 design §4.2). None of those verticals has a table yet and a lost code
 * uses editLost, so every code is not_found, without a query. The body is not bound (no schema to read it against). The
 * route exists so the contract is complete; the verticals' CaseKind implementations replace it.
 */
@ApiComponent
@RestController
class EditCaseController {

    @PatchMapping("/cases/{code}")
    void edit(@PathVariable String code, Account account) {
        throw CaseErrors.notFound();
    }
}
```

In `CasesSecurityRules.authorize` add:

```java
        rules.requestMatchers(HttpMethod.PATCH, "/lost-cases/*").authenticated();
        rules.requestMatchers(HttpMethod.PATCH, "/cases/*").authenticated();
```

In `StatementCeilings` add:

```java
            Map.entry("PATCH /lost-cases/{code}", 5),   // worst path, EditLostTest: session, pre-read (case + pet photos), upload lookup, pet update, case update (the guard); {} is 2, photos already on the pet 4
            Map.entry("PATCH /cases/{code}", 1),        // the session lookup only: every code is not_found without a query (no table for the other verticals yet)
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `[mvn] test -Dtest='EditLostTest,EditLostPrecedenceTest,EditLostRaceTest,PetsLookTest,ContractCoverageTest,RequiredFieldsTest,ArchitectureTest' 2>&1 | tail -20`
Expected: PASS. Two expected traps: (a) `photosAlreadyOnThePetNeedNoUploadLookup` — `requireAttachable` with an empty list must not run a statement (it returns early; if it does, the count is 5); (b) `aBrokenFieldIs…` with `{"last_seen_point":{"lat":0}}` — the missing `lng` binds as null and is a field rule, not a Jackson error.

- [ ] **Step 9: Run the whole suite and commit**

Run: `[mvn] verify 2>&1 | tail -10` — Expected: `BUILD SUCCESS`.

```bash
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 add \
  backend/src/main/java/co/scuby/cases/EditLostService.java backend/src/main/java/co/scuby/cases/EditLostController.java \
  backend/src/main/java/co/scuby/cases/EditCaseController.java backend/src/main/java/co/scuby/cases/CasesSecurityRules.java \
  backend/src/test/java/co/scuby/support/Photos.java backend/src/test/java/co/scuby/support/StatementCeilings.java \
  backend/src/test/java/co/scuby/cases/EditLostTest.java backend/src/test/java/co/scuby/cases/EditLostPrecedenceTest.java \
  backend/src/test/java/co/scuby/cases/EditLostRaceTest.java
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 commit -m "feat: edit a lost case — the shared pet through Pets, a moved zone re-snapped, the case UPDATE last as the guard"
```

---
### Task 6: Owner moderation of a pin — `PATCH /cases/{code}/sightings/{sightingId}` — and the owner's view without deleted pins

The owner hides a pin from the public views or highlights it (spec §4.6); the flags are independent and idempotent, allowed in any case status. A pin removed by moderation or deleted by its reporter is `not_found` even to the owner, and the owner's sightings query changes from `status <> 'removed_by_moderation'` to `status IN ('visible', 'hidden_by_owner')` (spec §2.2) so a deleted pin appears for nobody.

**Files:**
- Create: `B/src/main/java/co/scuby/cases/ModerateSightingRequest.java`, `SightingModerationService.java`, `SightingModerationController.java`
- Modify: `B/src/main/java/co/scuby/cases/LostCaseQueries.java` (owner visibility)
- Modify: `CasesSecurityRules`, `StatementCeilings`
- Test: `B/src/test/java/co/scuby/cases/SightingModerationTest.java`

**Interfaces:**
- Consumes: `Patch<T>` (Task 3); `OwnerAccess.code/id/require`, `CaseErrors`, `CreatedView`, `ApiClient.patch`, `Contention` (Task 4); `CaseFixtures.sighting(String, GeoPoint, Instant, Instant, UUID, String, String, String)`.
- Produces: `record ModerateSightingRequest(Patch<Boolean> highlighted, Patch<Boolean> hidden)`; `SightingModerationService.moderate(String rawCode, String rawSightingId, UUID me, ModerateSightingRequest body) → CreatedView`; ceiling `PATCH /cases/{code}/sightings/{sightingId}` 3. `LostCaseQueries.sightingsQuery(code, Access.OWNER)` now filters `status IN ('visible','hidden_by_owner')` (inline literals).

- [ ] **Step 1: Write the failing tests**

`B/src/test/java/co/scuby/cases/SightingModerationTest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.cache.ClearableCache;
import co.scuby.platform.flags.FeatureFlags;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.Contention;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;

import javax.sql.DataSource;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static co.scuby.db.generated.Tables.SIGHTING;
import static org.assertj.core.api.Assertions.assertThat;

/** The owner moderates pins (docs/product/04 · sighting; spec §4.6). Includes its error order and the leak checks. */
@IntegrationTest
class SightingModerationTest {

    static final Instant NOW = MutableClock.START;
    static final String PATH = "/cases/{code}/sightings/{sightingId}";

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired DataSource dataSource;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient owner;
    ApiClient stranger;
    UUID carolina;
    UUID pin;

    @BeforeEach
    void setUp() {
        owner = clients.newBrowser();
        carolina = accounts.signIn(owner, "carolina@correo.co");
        stranger = clients.newBrowser();
        accounts.signIn(stranger, "stranger@correo.co");
        cases.luna(carolina);
        pin = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, NOW.minusSeconds(3600), NOW.minusSeconds(3600), null, "3".repeat(64),
                "+573001112233", "visible");
    }

    private ApiResponse moderate(ApiClient as, String code, Object id, String json) {
        return as.patch(PATH, json, code, id);
    }

    private Record row(UUID id) {
        return db.selectFrom(SIGHTING).where(SIGHTING.ID.eq(id)).fetchOne();
    }

    private ApiResponse cold(java.util.function.Supplier<ApiResponse> call) {
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        return call.get();
    }

    @Test
    void hidingTakesThePinOffThePublicViewsAndTheOwnerStillSeesItWithItsContact() {
        ApiResponse r = moderate(owner, "7K3PQ", pin, "{\"hidden\":true}");
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/id")).isEqualTo(pin.toString());
        assertThat(row(pin).get(SIGHTING.STATUS)).isEqualTo("hidden_by_owner");
        ApiResponse pub = clients.newBrowser().get("/cases/{code}", "7K3PQ");
        assertThat(pub.json().get("sightings")).isEmpty();
        assertThat(pub.body()).doesNotContain("3001112233");
        assertThat(clients.newBrowser().get("/feed").json().at("/items/0/sightings_count").asInt()).isZero();
        ApiResponse own = owner.get("/cases/{code}", "7K3PQ");
        assertThat(own.json().get("sightings")).hasSize(1);
        assertThat(own.json().at("/sightings/0/hidden").asBoolean()).isTrue();
        assertThat(own.str("/sightings/0/contact_phone")).isEqualTo("+573001112233");
    }

    @Test
    void unhidingBringsThePinBack() {
        moderate(owner, "7K3PQ", pin, "{\"hidden\":true}");
        assertThat(moderate(owner, "7K3PQ", pin, "{\"hidden\":false}").status()).isEqualTo(200);
        assertThat(row(pin).get(SIGHTING.STATUS)).isEqualTo("visible");
        assertThat(clients.newBrowser().get("/cases/{code}", "7K3PQ").json().get("sightings")).hasSize(1);
    }

    @Test
    void highlightAndHideAreIndependent() {
        moderate(owner, "7K3PQ", pin, "{\"hidden\":true}");
        assertThat(moderate(owner, "7K3PQ", pin, "{\"highlighted\":true}").status()).isEqualTo(200);
        assertThat(row(pin).get(SIGHTING.STATUS)).isEqualTo("hidden_by_owner");
        assertThat(row(pin).get(SIGHTING.HIGHLIGHTED_BY_OWNER)).isTrue();
        moderate(owner, "7K3PQ", pin, "{\"highlighted\":false,\"hidden\":false}");
        assertThat(row(pin).get(SIGHTING.STATUS)).isEqualTo("visible");
        assertThat(row(pin).get(SIGHTING.HIGHLIGHTED_BY_OWNER)).isFalse();
    }

    @Test
    void aHighlightShowsToEveryone() {
        moderate(owner, "7K3PQ", pin, "{\"highlighted\":true}");
        assertThat(clients.newBrowser().get("/cases/{code}", "7K3PQ").json().at("/sightings/0/highlighted_by_owner").asBoolean()).isTrue();
    }

    @Test
    void repeatingAValueIsIdempotent() {
        assertThat(moderate(owner, "7K3PQ", pin, "{\"hidden\":true,\"highlighted\":true}").status()).isEqualTo(200);
        assertThat(moderate(owner, "7K3PQ", pin, "{\"hidden\":true,\"highlighted\":true}").status()).isEqualTo(200);
        assertThat(row(pin).get(SIGHTING.STATUS)).isEqualTo("hidden_by_owner");
        assertThat(row(pin).get(SIGHTING.HIGHLIGHTED_BY_OWNER)).isTrue();
    }

    @Test
    void anEmptyBodyIsANoOpWithoutAWrite() {
        ApiResponse r = cold(() -> moderate(owner, "7K3PQ", pin, "{}"));
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/id")).isEqualTo(pin.toString());
        assertThat(r.statements()).as("%s", r.statements()).hasSize(2);   // session, pre-read
        assertThat(row(pin).get(SIGHTING.STATUS)).isEqualTo("visible");
    }

    @ParameterizedTest
    @CsvSource({"reunited", "expired", "cancelled"})
    void allowedOnAClosedCase(String status) {
        cases.close("7K3PQ", status, NOW.minus(Duration.ofDays(1)));
        assertThat(moderate(owner, "7K3PQ", pin, "{\"hidden\":true}").status()).isEqualTo(200);
        assertThat(row(pin).get(SIGHTING.STATUS)).isEqualTo("hidden_by_owner");
    }

    @ParameterizedTest
    @CsvSource({"removed_by_moderation", "deleted_by_reporter"})
    void aModeratedOrDeletedPinIsNotFoundEvenToTheOwnerAndStaysAsItIs(String status) {
        UUID gone = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, NOW.minusSeconds(60), NOW.minusSeconds(60), null, "4".repeat(64),
                "+573004445566", status);
        ApiResponse r = moderate(owner, "7K3PQ", gone, "{\"hidden\":false}");
        assertThat(r.status()).isEqualTo(404);
        assertThat(r.errorCode()).isEqualTo("not_found");
        assertThat(row(gone).get(SIGHTING.STATUS)).isEqualTo(status);
        ApiResponse own = owner.get("/cases/{code}", "7K3PQ");
        assertThat(own.json().get("sightings")).as("the owner's view lists only visible and hidden pins").hasSize(1);
        assertThat(own.body()).doesNotContain(gone.toString()).doesNotContain("3004445566");
    }

    @Test
    void aPinOfAnotherCaseAnUnknownIdOrAMalformedIdIsNotFound() {
        cases.lostCase(carolina, "OTH22", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "active", NOW.minusSeconds(7200));
        UUID other = cases.sighting("OTH22", CaseFixtures.MEDELLIN, NOW.minusSeconds(60), NOW.minusSeconds(60), null, "5".repeat(64), null, "visible");
        assertThat(moderate(owner, "7K3PQ", other, "{\"hidden\":true}").errorCode()).isEqualTo("not_found");
        assertThat(moderate(owner, "7K3PQ", UUID.randomUUID(), "{\"hidden\":true}").errorCode()).isEqualTo("not_found");
        assertThat(moderate(owner, "7K3PQ", "not-a-uuid", "{\"hidden\":true}").errorCode()).isEqualTo("not_found");
        assertThat(row(other).get(SIGHTING.STATUS)).isEqualTo("visible");
    }

    @Test
    void anExplicitNullIsValidationFailedNamingTheField() {
        ApiResponse r = moderate(owner, "7K3PQ", pin, "{\"hidden\":null}");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("hidden")).isTrue();
        assertThat(moderate(owner, "7K3PQ", pin, "{\"highlighted\":null}").json().at("/error/fields").has("highlighted")).isTrue();
        assertThat(row(pin).get(SIGHTING.STATUS)).isEqualTo("visible");
    }

    @Test
    void someoneElseIsForbiddenAndNobodyIsUnauthorized() {
        assertThat(moderate(stranger, "7K3PQ", pin, "{\"hidden\":true}").errorCode()).isEqualTo("forbidden");
        assertThat(moderate(clients.newBrowser(), "7K3PQ", pin, "{\"hidden\":true}").status()).isEqualTo(401);
        assertThat(row(pin).get(SIGHTING.STATUS)).isEqualTo("visible");
    }

    // --- error order: session → case not_found → forbidden → pin not_found → body (spec §4.6) ---

    @Test
    void anUnknownCaseBeatsForbiddenAndForbiddenBeatsAnUnknownPin() {
        assertThat(moderate(stranger, "ZZZZZ", pin, "{\"hidden\":null}").errorCode()).isEqualTo("not_found");
        assertThat(moderate(stranger, "7K3PQ", UUID.randomUUID(), "{\"hidden\":null}").errorCode()).isEqualTo("forbidden");
    }

    @Test
    void anUnknownPinBeatsABadBody() {
        assertThat(moderate(owner, "7K3PQ", UUID.randomUUID(), "{\"hidden\":null}").errorCode()).isEqualTo("not_found");
    }

    @Test
    void anUnreadableBodyIsAnsweredBeforeAnyLookup() {
        assertThat(moderate(stranger, "ZZZZZ", pin, "{\"hidden\":\"yes please\"}").errorCode()).isEqualTo("validation_failed");
    }

    @Test
    void theWorstPathIsThreeStatements() {
        ApiResponse r = cold(() -> moderate(owner, "7K3PQ", pin, "{\"hidden\":true,\"highlighted\":true}"));
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.statements()).as("%s", r.statements()).hasSize(3);   // session, pre-read (case + pin), update
    }

    /**
     * The pin is removed by moderation while the owner hides it: the hide passed its pre-read (visible), its UPDATE waits on
     * the uncommitted change, re-checks status IN ('visible','hidden_by_owner') after the commit and matches nothing:
     * not_found, the removal stands, still 3 statements.
     */
    @Test
    void aPinModeratedAwayDuringTheHideIsNotFoundAndStaysRemoved() throws Exception {
        try (Contention contention = new Contention(dataSource, db)) {
            contention.hold("UPDATE scuby.sighting SET status = 'removed_by_moderation' WHERE id = ?", pin);
            caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
            var pool = Executors.newSingleThreadExecutor();
            try {
                Future<ApiResponse> f = pool.submit(() -> moderate(owner, "7K3PQ", pin, "{\"hidden\":true}"));
                contention.awaitWaiters(1);
                contention.commit();
                ApiResponse r = f.get(30, TimeUnit.SECONDS);
                assertThat(r.status()).isEqualTo(404);
                assertThat(r.errorCode()).isEqualTo("not_found");
                assertThat(r.statements()).as("%s", r.statements()).hasSize(3);
                assertThat(row(pin).get(SIGHTING.STATUS)).isEqualTo("removed_by_moderation");
            } finally {
                pool.shutdownNow();
            }
        }
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `[mvn] test -Dtest=SightingModerationTest 2>&1 | tail -10`
Expected: FAIL — `no statement ceiling for PATCH /cases/{code}/sightings/{sightingId}`, and `aModeratedOrDeletedPin…` fails for `deleted_by_reporter` (the owner query still lists it).

- [ ] **Step 3: Implement**

`B/src/main/java/co/scuby/cases/ModerateSightingRequest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.web.Patch;

/** ModerateSightingRequest (web/src/contracts/owner.ts · moderateSighting). Both optional; null for either is validation_failed. */
record ModerateSightingRequest(Patch<Boolean> highlighted, Patch<Boolean> hidden) {}
```

`B/src/main/java/co/scuby/cases/SightingModerationService.java`:

```java
package co.scuby.cases;

import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.SIGHTING;

/**
 * The owner stars a pin or takes it off the public map (docs/product/04-lost-workflow.md · sighting; L1 design §4.6).
 * Order: case not_found → forbidden → the pin is on this case and visible or hidden_by_owner (else not_found: moderated and
 * deleted pins are invisible to the owner) → body. No case-status check. One UPDATE with only the sent flags, guarded by
 * the same status set; repeats are idempotent. Telling the reporter about a highlight is L2.
 */
@Service
class SightingModerationService {

    record Target(UUID createdBy, @Nullable UUID sightingId) {}

    private final DSLContext db;
    private final OwnerAccess owners;

    SightingModerationService(DSLContext db, OwnerAccess owners) {
        this.db = db;
        this.owners = owners;
    }

    CreatedView moderate(String rawCode, String rawSightingId, UUID me, ModerateSightingRequest body) {
        String code = OwnerAccess.code(rawCode);
        Optional<UUID> id = OwnerAccess.id(rawSightingId);
        Target target = owners.require(target(code, id), Target::createdBy, me);
        if (target.sightingId() == null) throw CaseErrors.notFound("sighting");
        Map<String, String> problems = new LinkedHashMap<>();
        if (body.highlighted().isPresent() && body.highlighted().value() == null) problems.put("highlighted", "true or false");
        if (body.hidden().isPresent() && body.hidden().value() == null) problems.put("hidden", "true or false");
        if (!problems.isEmpty()) throw CaseErrors.invalidFields(problems);

        Map<Field<?>, Object> set = new LinkedHashMap<>();
        if (body.highlighted().isPresent()) set.put(SIGHTING.HIGHLIGHTED_BY_OWNER, body.highlighted().value());
        if (body.hidden().isPresent()) set.put(SIGHTING.STATUS, DSL.inline(body.hidden().value() ? "hidden_by_owner" : "visible"));
        if (!set.isEmpty()) {
            int updated = db.update(SIGHTING).set(set)
                            .where(SIGHTING.ID.eq(target.sightingId()), SIGHTING.CASE_CODE.eq(code),
                                   SIGHTING.STATUS.in(DSL.inline("visible"), DSL.inline("hidden_by_owner")))
                            .execute();
            if (updated == 0) throw CaseErrors.notFound("sighting");   // moderated or deleted since the pre-read
        }
        return new CreatedView(target.sightingId().toString());
    }

    /** The case's owner and, when it is this case's and still the owner's to moderate, the pin's id (one statement). */
    private Optional<Target> target(String code, Optional<UUID> id) {
        return db.select(LOST_CASE.CREATED_BY, SIGHTING.ID)
                 .from(LOST_CASE)
                 .leftJoin(SIGHTING).on(SIGHTING.CASE_CODE.eq(LOST_CASE.CODE),
                         id.map(SIGHTING.ID::eq).orElse(DSL.falseCondition()),
                         SIGHTING.STATUS.in(DSL.inline("visible"), DSL.inline("hidden_by_owner")))
                 .where(LOST_CASE.CODE.eq(code))
                 .fetchOptional(r -> new Target(r.get(LOST_CASE.CREATED_BY), r.get(SIGHTING.ID)));
    }
}
```

`B/src/main/java/co/scuby/cases/SightingModerationController.java`:

```java
package co.scuby.cases;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Account;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** moderateSighting: 200 {id: the sighting id}. Session only for PATCH: DELETE on the same path is the reporter's, public. */
@ApiComponent
@RestController
class SightingModerationController {

    private final SightingModerationService service;

    SightingModerationController(SightingModerationService service) {
        this.service = service;
    }

    @PatchMapping("/cases/{code}/sightings/{sightingId}")
    CreatedView moderate(@PathVariable String code, @PathVariable String sightingId, Account account,
                         @RequestBody ModerateSightingRequest body) {
        return service.moderate(code, sightingId, account.personId(), body);
    }
}
```

In `B/src/main/java/co/scuby/cases/LostCaseQueries.java`, in `sightingsQuery`, replace

```java
        var visibility = access == Access.OWNER
                ? SIGHTING.STATUS.ne("removed_by_moderation")
                : SIGHTING.STATUS.eq("visible");
```

with

```java
        // Inline literals. Moderated and reporter-deleted pins reach nobody, the owner included (L1 design §2.2).
        var visibility = access == Access.OWNER
                ? SIGHTING.STATUS.in(DSL.inline("visible"), DSL.inline("hidden_by_owner"))
                : SIGHTING.STATUS.eq("visible");
```

and update the method's javadoc sentence to: `PUBLIC: only visible pins are queried, and reporters' numbers are selected as NULL; OWNER: visible and hidden pins (never moderated or deleted ones).`

In `CasesSecurityRules.authorize` add:

```java
        rules.requestMatchers(HttpMethod.PATCH, "/cases/*/sightings/*").authenticated();
```

In `StatementCeilings` add:

```java
            Map.entry("PATCH /cases/{code}/sightings/{sightingId}", 3),   // exactly 3 on a session-cache miss (SightingModerationTest): session, pre-read (case + pin), update; {} is 2
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `[mvn] test -Dtest='SightingModerationTest,CaseEndpointTest,CaseStatementsTest,CaseSightingsPlanTest,LostParityTest,ContractCoverageTest,RequiredFieldsTest' 2>&1 | tail -20`
Expected: PASS. `CaseSightingsPlanTest` must still show `sighting_by_case_recent_idx` for the owner query with the `IN` filter (status is INCLUDEd). `CaseStatementsTest.aPublicReadOnlyQueriesVisibleSightings` is unchanged (the public filter keeps its bind).

- [ ] **Step 5: Run the whole suite and commit**

Run: `[mvn] verify 2>&1 | tail -10` — Expected: `BUILD SUCCESS`.

```bash
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 add \
  backend/src/main/java/co/scuby/cases/ModerateSightingRequest.java backend/src/main/java/co/scuby/cases/SightingModerationService.java \
  backend/src/main/java/co/scuby/cases/SightingModerationController.java backend/src/main/java/co/scuby/cases/LostCaseQueries.java \
  backend/src/main/java/co/scuby/cases/CasesSecurityRules.java backend/src/test/java/co/scuby/support/StatementCeilings.java \
  backend/src/test/java/co/scuby/cases/SightingModerationTest.java
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 commit -m "feat: owner hides and highlights pins; moderated and deleted pins reach nobody"
```

---
### Task 7: The reporter's own pin — correction and delete — and the "mine" rule

`POST /cases/{code}/sightings/{sightingId}/correction` and `DELETE /cases/{code}/sightings/{sightingId}` (spec §4.7–4.8) are public. A pin is mine when its `reporter_person_id` is the session's person, **or** when it has no person and its `reporter_device_hash` is the caller's device (`docs/eng/api.md` · Device identity). So another person's pin is never mine on a shared device, and a passer-by who reported anonymously and then signs in to say «Lo tengo» keeps their pin (its correction window, and the claim's link to it). `LostCaseDerivation` changes `mine` from "person OR device" to that rule, so `mine`, `editable_until`, correction, delete and the claim's `from_sighting_id` (Task 9) agree. Delete is a status; a replayed «Lo vi» with the deleted pin's `client_id` answers that pin's id; the reporter's repeat delete of their own deleted pin answers `204` again with no write.

**Files:**
- Create: `B/src/main/java/co/scuby/platform/web/BodyValidation.java`; Test: `B/src/test/java/co/scuby/platform/web/BodyValidationTest.java`
- Modify: `B/src/main/java/co/scuby/platform/web/ApiErrorHandler.java` (`wirePath` from `private static` to package-private `static`)
- Modify: `B/src/main/java/co/scuby/cases/LostCaseDerivation.java` (`mine`, `editable`)
- Modify: `B/src/test/java/co/scuby/cases/LostCaseDerivationTest.java` (the `mine` table)
- Create: `B/src/main/java/co/scuby/cases/SightingCorrectionRequest.java`
- Modify: `B/src/main/java/co/scuby/cases/SightingQueries.java`, `SightingService.java`, `SightingController.java`
- Modify: `StatementCeilings`
- Test: `B/src/test/java/co/scuby/cases/SightingCorrectionTest.java`, `SightingDeleteTest.java`, `OwnPinPrecedenceTest.java`

**Interfaces:**
- Consumes: `OwnerAccess.code/id`, `CaseErrors`, `Contention`, `ApiClient.delete` (Task 4); `SightingRulesDerivation.check(Instant seenAt, Instant now, Instant lastSeenAt, double distanceM) → Optional<Refusal>`; `Spatial.distanceMeters`, `Spatial.geography`.
- Produces:
  - `platform.web.BodyValidation` (`@Component`, public): `void require(Object body)` — bean validation of a record bound without `@Valid`; `validation_failed` with wire-path fields (list indexes dropped: `photo_urls[2]` → `photo_urls`).
  - `LostCaseDerivation.mine(@Nullable UUID viewerPerson, String viewerDevice, @Nullable UUID reporterPerson, String reporterDevice) → boolean` (`viewerPerson` equals `reporterPerson`, or `reporterPerson` is null and the devices are equal; also consumed by Task 9's `from_sighting_id` link); `LostCaseDerivation.editable(boolean mine, boolean visible, Instant createdAt, Instant now) → boolean`.
  - `record SightingCorrectionRequest(PointInput point, OffsetDateTime seenAt, @Nullable String note)` (all three `@JsonProperty(required = true)`).
  - `SightingQueries.OwnPin(String status, Instant createdAt, @Nullable UUID reporterPersonId, String reporterDeviceHash, String caseStatus, Instant lastSeenAt, @Nullable Double distanceM)`; `Optional<OwnPin> ownPin(String code, UUID id, @Nullable GeoPoint point)`; `boolean correct(String code, UUID id, Caller caller, GeoPoint point, Instant seenAt, @Nullable String note, Instant now)`; `boolean deleteOwn(String code, UUID id, Caller caller, Instant now)`.
  - `SightingService.correct(String rawCode, String rawId, Caller caller, SightingCorrectionRequest body)`, `SightingService.delete(String rawCode, String rawId, Caller caller)`.
  - Ceilings: `POST /cases/{code}/sightings/{sightingId}/correction` 4, `DELETE /cases/{code}/sightings/{sightingId}` 4.

- [ ] **Step 1: Change the `mine` table first (it fails against the old OR rule)**

In `B/src/test/java/co/scuby/cases/LostCaseDerivationTest.java` replace the whole `mineAndTheCorrectionWindow` test (the `@ParameterizedTest` with its `@CsvSource` and method) with:

```java
    /** Another person, not the viewer (HELPER) and not the owner. */
    static final UUID SOMEONE_ELSE = UUID.fromString("00000000-0000-0000-0000-00000000000c");

    /**
     * "Mine" (docs/eng/api.md · Device identity): the viewer's person, or a pin with no person sent from the viewer's
     * device. Human review: this table is the rule. reporter = ME (the viewer's person, HELPER), OTHER (another person) or
     * NONE (an anonymous pin); sameDevice = the pin's device hash is the viewer's.
     */
    @ParameterizedTest(name = "{0}")
    @CsvSource({
            // case,                                                    viewerSignedIn, reporter, sameDevice, minutesAgo, hidden, mine,  editable
            "'person match, from another device',                        true,           ME,       false,      5,          false,  true,  true",
            "'person match, exactly 15 min ago',                         true,           ME,       false,      15,         false,  true,  false",
            "'anonymous pin from this device, the viewer now signed in', true,           NONE,     true,       5,          false,  true,  true",
            "'another person''s pin from this device',                   true,           OTHER,    true,       5,          false,  false, false",
            "'anonymous pin from another device, signed in',             true,           NONE,     false,      5,          false,  false, false",
            "'no session, anonymous pin from this device',               false,          NONE,     true,       5,          false,  true,  true",
            "'no session, anonymous pin from another device',            false,          NONE,     false,      5,          false,  false, false",
            "'no session, a signed-in pin from this device',             false,          ME,       true,       5,          false,  false, false",
            "'mine but hidden by the owner',                             true,           ME,       true,       5,          true,   true,  false",
            "'another person, another device',                           true,           OTHER,    false,      5,          false,  false, false",
    })
    void mineIsTheViewersPersonOrAnAnonymousPinFromTheirDevice(String label, boolean viewerSignedIn, String reporter, boolean sameDevice,
                                                               int minutesAgo, boolean hidden, boolean mine, boolean editable) {
        Instant created = NOW.minus(Duration.ofMinutes(minutesAgo));
        UUID reporterPerson = switch (reporter) {
            case "ME" -> HELPER;
            case "OTHER" -> SOMEONE_ELSE;
            default -> null;
        };
        var s = sighting("01", created, created, reporterPerson, sameDevice ? MY_DEVICE : OTHER_DEVICE, null, hidden);
        // A hidden pin reaches only the owner: in that row the viewer is the owner (but not the reporter).
        Viewer viewer = new Viewer(hidden ? Access.OWNER : Access.PUBLIC, viewerSignedIn ? HELPER : null, MY_DEVICE);
        var view = LostCaseDerivation.derive(luna(List.of(s)), viewer, NOW, ES).sightings().getFirst();
        assertThat(view.mine()).as(label).isEqualTo(mine);
        assertThat(view.editableUntil()).as(label).isEqualTo(editable ? created.plus(Duration.ofMinutes(15)) : null);
    }

    @Test
    void theWindowIsExclusiveAtFifteenMinutes() {
        Instant created = NOW.minus(Duration.ofMinutes(15));
        assertThat(LostCaseDerivation.editable(true, true, created.plusMillis(1), NOW)).isTrue();
        assertThat(LostCaseDerivation.editable(true, true, created, NOW)).isFalse();
        assertThat(LostCaseDerivation.editable(false, true, NOW, NOW)).isFalse();
        assertThat(LostCaseDerivation.editable(true, false, NOW, NOW)).isFalse();
        assertThat(LostCaseDerivation.mine(null, MY_DEVICE, null, MY_DEVICE)).isTrue();
        assertThat(LostCaseDerivation.mine(null, MY_DEVICE, HELPER, MY_DEVICE)).as("a signed-in pin is its person's").isFalse();
        assertThat(LostCaseDerivation.mine(HELPER, MY_DEVICE, null, MY_DEVICE)).as("an anonymous pin of my browser").isTrue();
        assertThat(LostCaseDerivation.mine(HELPER, MY_DEVICE, SOMEONE_ELSE, MY_DEVICE)).as("another person's, same device").isFalse();
        assertThat(LostCaseDerivation.mine(HELPER, OTHER_DEVICE, HELPER, MY_DEVICE)).isTrue();
    }
```

Run: `[mvn] test -Dtest=LostCaseDerivationTest 2>&1 | tail -10`
Expected: FAIL — `cannot find symbol: method editable` / `mine`; once those exist against the old OR rule, `another person's pin from this device` expects `mine` false and gets true.

- [ ] **Step 2: Implement the "mine" rule**

In `B/src/main/java/co/scuby/cases/LostCaseDerivation.java` add the import `java.util.UUID` and replace the `sighting` method with:

```java
    private static LostCaseView.SightingView sighting(LostCaseFacts.SightingFacts s, Viewer viewer, boolean owner, Instant now) {
        boolean mine = mine(viewer.personId(), viewer.deviceHash(), s.reporterPersonId(), s.reporterDeviceHash());
        Instant editableUntil = editable(mine, !s.hidden(), s.createdAt(), now) ? s.createdAt().plus(EDIT_WINDOW) : null;
        return new LostCaseView.SightingView(s.id().toString(), s.point(), s.seenAt(), s.note(), s.photoUrls(),
                s.reporterPersonId() != null ? "registered" : "anonymous", s.highlighted(),
                owner ? s.contactPhone() : null, owner && s.hidden(), mine, editableUntil);
    }

    /**
     * "Mine" (docs/eng/api.md · Device identity): the pin's reporter is the caller's person, or the pin has no person and
     * came from the caller's device. Another person's pin is never mine, whatever device sent it; an anonymous pin from
     * this browser stays mine after its reporter signs in (they may sign in to say «Lo tengo» and keep their pin).
     */
    static boolean mine(@Nullable UUID viewerPerson, String viewerDevice, @Nullable UUID reporterPerson, String reporterDevice) {
        return (viewerPerson != null && viewerPerson.equals(reporterPerson))
                || (reporterPerson == null && viewerDevice.equals(reporterDevice));
    }

    /** Correctable and deletable by its reporter: mine, visible, and now before created_at + 15 min (exclusive). */
    static boolean editable(boolean mine, boolean visible, Instant createdAt, Instant now) {
        return mine && visible && now.isBefore(createdAt.plus(EDIT_WINDOW));
    }
```

Run: `[mvn] test -Dtest='LostCaseDerivationTest,CaseEndpointTest' 2>&1 | tail -10`
Expected: PASS (`CaseEndpointTest.theDeviceThatReportedSeesItsPinAsMine` uses an anonymous reporter and an anonymous viewer: mine under both rules).

- [ ] **Step 3: Write the failing endpoint tests**

`B/src/test/java/co/scuby/platform/web/BodyValidationTest.java`:

```java
package co.scuby.platform.web;

import jakarta.validation.Valid;
import jakarta.validation.Validation;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class BodyValidationTest {

    record Point(@NotNull Double lat, @NotNull Double lng) {}

    record Body(@NotNull @Valid Point lastSeenPoint, @Size(max = 2) List<@NotBlank String> photoUrls) {}

    final BodyValidation validation = new BodyValidation(Validation.buildDefaultValidatorFactory().getValidator());

    @Test
    void aValidBodyPasses() {
        validation.require(new Body(new Point(1.0, 2.0), List.of("a")));
    }

    @Test
    void violationsAreValidationFailedNamedByWirePathWithoutListIndexes() {
        assertThatThrownBy(() -> validation.require(new Body(new Point(null, 2.0), List.of("a", " "))))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.code()).isEqualTo(ErrorCode.VALIDATION_FAILED);
                    @SuppressWarnings("unchecked")
                    var fields = (java.util.Map<String, String>) e.getBody().getProperties().get(ContractErrors.FIELDS);
                    assertThat(fields).containsOnlyKeys("last_seen_point.lat", "photo_urls");
                });
        assertThatThrownBy(() -> validation.require(new Body(null, List.of("a", "b", "c")))).isInstanceOf(ApiException.class);
    }
}
```

`B/src/test/java/co/scuby/cases/SightingCorrectionTest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.cache.ClearableCache;
import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.flags.FeatureFlags;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.Contention;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;

import javax.sql.DataSource;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static co.scuby.db.generated.Tables.SIGHTING;
import static org.assertj.core.api.Assertions.assertThat;

/** «Corregir» (docs/product/04 · Correction window; spec §4.7): the reporter moves their pin inside 15 minutes. */
@IntegrationTest
class SightingCorrectionTest {

    static final Instant NOW = MutableClock.START;
    static final Instant CREATED = NOW.minus(Duration.ofMinutes(5));
    static final String PATH = "/cases/{code}/sightings/{sightingId}/correction";
    static final String GOOD = "{\"point\":{\"lat\":6.25,\"lng\":-75.59},\"seen_at\":\"2026-10-14T16:50:00Z\",\"note\":\"En la esquina\"}";

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired MutableClock clock;
    @Autowired DataSource dataSource;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient reporter;          // anonymous: a device cookie only
    String device;
    UUID carolina;
    UUID pin;
    Contention contention;

    @BeforeEach
    void setUp() {
        contention = new Contention(dataSource, db);
        carolina = accounts.person("carolina@correo.co");
        cases.luna(carolina);
        reporter = clients.newBrowser();
        reporter.get("/config");
        device = Hashing.sha256Hex(reporter.cookie("device").orElseThrow());
        pin = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, null, device, "+573001112233", "visible");
        db.update(SIGHTING).set(SIGHTING.PHOTO_URLS, new String[] {"http://localhost/dev-media/" + "b".repeat(64) + ".jpg"})
          .set(SIGHTING.NOTE, "Corría").where(SIGHTING.ID.eq(pin)).execute();
    }

    @AfterEach
    void tearDown() throws Exception {
        contention.close();
    }

    private ApiResponse correct(ApiClient as, String code, Object id, String json) {
        return as.post(PATH, json, code, id);
    }

    private Record row() {
        return db.selectFrom(SIGHTING).where(SIGHTING.ID.eq(pin)).fetchOne();
    }

    private void assertUncorrected() {
        assertThat(row().get(SIGHTING.LAT)).isEqualTo(CaseFixtures.MEDELLIN.lat());
        assertThat(row().get(SIGHTING.NOTE)).isEqualTo("Corría");
    }

    @Test
    void theReporterMovesTheirPinAndItsTimeAndNoteButNotItsPhotosContactOrWindow() {
        ApiResponse r = correct(reporter, "7K3PQ", pin, GOOD);
        assertThat(r.status()).isEqualTo(204);
        assertThat(r.body()).isEmpty();
        Record s = row();
        assertThat(s.get(SIGHTING.LAT)).isEqualTo(6.25);
        assertThat(s.get(SIGHTING.LNG)).isEqualTo(-75.59);
        assertThat(s.get(SIGHTING.SEEN_AT).toInstant()).isEqualTo(Instant.parse("2026-10-14T16:50:00Z"));
        assertThat(s.get(SIGHTING.NOTE)).isEqualTo("En la esquina");
        assertThat(List.of(s.get(SIGHTING.PHOTO_URLS))).hasSize(1);
        assertThat(s.get(SIGHTING.CONTACT_PHONE)).isEqualTo("+573001112233");
        assertThat(s.get(SIGHTING.CREATED_AT).toInstant()).isEqualTo(CREATED);
        assertThat(reporter.get("/cases/{code}", "7K3PQ").str("/sightings/0/editable_until")).isEqualTo("2026-10-14T17:10:00Z");
    }

    @Test
    void aNullNoteClearsIt() {
        assertThat(correct(reporter, "7K3PQ", pin, GOOD.replace("\"En la esquina\"", "null")).status()).isEqualTo(204);
        assertThat(row().get(SIGHTING.NOTE)).isNull();
    }

    @Test
    void aSignedInReporterIsMatchedByAccountFromAnyDevice() {
        ApiClient helper = clients.newBrowser();
        UUID andres = accounts.signIn(helper, "andres@correo.co");
        UUID theirs = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, andres, "9".repeat(64), null, "visible");
        assertThat(correct(helper, "7K3PQ", theirs, GOOD).status()).isEqualTo(204);
    }

    @Test
    void anAnonymousPinStaysTheReportersAfterTheySignInOnTheSameBrowser() {
        accounts.signIn(reporter, "andres@correo.co");          // same browser, same device cookie, now signed in
        assertThat(reporter.get("/cases/{code}", "7K3PQ").json().at("/sightings/0/mine").asBoolean()).isTrue();
        assertThat(correct(reporter, "7K3PQ", pin, GOOD).status()).isEqualTo(204);
        assertThat(row().get(SIGHTING.NOTE)).isEqualTo("En la esquina");
    }

    @Test
    void anotherPersonsPinSentFromThisBrowserIsForbidden() {
        UUID laura = accounts.person("laura@correo.co");
        UUID lauras = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, laura, device, null, "visible");   // a shared device
        accounts.signIn(reporter, "andres@correo.co");
        ApiResponse r = correct(reporter, "7K3PQ", lauras, GOOD);
        assertThat(r.status()).isEqualTo(403);
        assertThat(r.errorCode()).isEqualTo("forbidden");
        assertThat(db.select(SIGHTING.NOTE).from(SIGHTING).where(SIGHTING.ID.eq(lauras)).fetchOne(SIGHTING.NOTE)).isNull();
    }

    @Test
    void aSignedInPinIsNotTheDevicesOnceItsReporterSignsOut() {
        UUID andres = accounts.person("andres@correo.co");
        UUID theirs = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, andres, device, null, "visible");
        ApiResponse r = correct(reporter, "7K3PQ", theirs, GOOD);   // the same device, no session: a person's pin is that person's
        assertThat(r.errorCode()).isEqualTo("forbidden");
    }

    @Test
    void someoneElsesPinIsForbidden() {
        ApiResponse r = correct(clients.newBrowser(), "7K3PQ", pin, GOOD);
        assertThat(r.status()).isEqualTo(403);
        assertUncorrected();
    }

    @Test
    void aPinTheOwnerHidIsForbiddenToItsReporter() {
        db.update(SIGHTING).set(SIGHTING.STATUS, "hidden_by_owner").where(SIGHTING.ID.eq(pin)).execute();
        assertThat(correct(reporter, "7K3PQ", pin, GOOD).errorCode()).isEqualTo("forbidden");
        assertUncorrected();
    }

    @ParameterizedTest
    @CsvSource({"removed_by_moderation", "deleted_by_reporter"})
    void aModeratedOrDeletedPinIsNotFound(String status) {
        db.update(SIGHTING).set(SIGHTING.STATUS, status).where(SIGHTING.ID.eq(pin)).execute();
        assertThat(correct(reporter, "7K3PQ", pin, GOOD).errorCode()).isEqualTo("not_found");
    }

    @Test
    void anUnknownCodeAnUnknownPinAMalformedIdOrAnotherCasesPinIsNotFound() {
        cases.lostCase(carolina, "OTH22", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "active", NOW.minusSeconds(7200));
        assertThat(correct(reporter, "ZZZZZ", pin, GOOD).errorCode()).isEqualTo("not_found");
        assertThat(correct(reporter, "OTH22", pin, GOOD).errorCode()).isEqualTo("not_found");
        assertThat(correct(reporter, "7K3PQ", UUID.randomUUID(), GOOD).errorCode()).isEqualTo("not_found");
        assertThat(correct(reporter, "7K3PQ", "x", GOOD).errorCode()).isEqualTo("not_found");
    }

    @Test
    void aClosedCaseIsInvalidTransition() {
        cases.close("7K3PQ", "reunited", NOW.minusSeconds(60));
        ApiResponse r = correct(reporter, "7K3PQ", pin, GOOD);
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("invalid_transition");
        assertUncorrected();
    }

    @Test
    void theWindowEndsExclusivelyAtFifteenMinutes() {
        clock.set(CREATED.plus(Duration.ofMinutes(15)).minusMillis(1));
        assertThat(correct(reporter, "7K3PQ", pin, GOOD).status()).isEqualTo(204);
        clock.set(CREATED.plus(Duration.ofMinutes(15)));
        ApiResponse late = correct(reporter, "7K3PQ", pin, GOOD.replace("En la esquina", "Tarde"));
        assertThat(late.status()).isEqualTo(403);
        assertThat(row().get(SIGHTING.NOTE)).isEqualTo("En la esquina");
    }

    @Test
    void theSightingRulesApplyInTheirOrder() {
        assertThat(correct(reporter, "7K3PQ", pin, GOOD.replace("2026-10-14T16:50:00Z", "2026-10-14T17:06:00Z")).errorCode())
                .isEqualTo("seen_at_in_future");
        assertThat(correct(reporter, "7K3PQ", pin, GOOD.replace("2026-10-14T16:50:00Z", "2026-10-11T16:00:00Z")).errorCode())
                .isEqualTo("seen_at_before_case");
        assertThat(correct(reporter, "7K3PQ", pin, GOOD.replace("\"lat\":6.25,\"lng\":-75.59", "\"lat\":4.711,\"lng\":-74.07")).errorCode())
                .isEqualTo("sighting_too_far");
        assertUncorrected();
    }

    @Test
    void theDistanceIsMeasuredFromTheSnappedPublicCenterNeverTheExactPoint() {
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        ApiResponse r = correct(reporter, "7K3PQ", pin, GOOD);
        assertThat(r.statements()).anyMatch(q -> q.contains("\"lost_case\".\"last_seen_public_point\""));
        assertThat(r.statements()).noneMatch(q -> q.contains("\"lost_case\".\"last_seen_lat\""));
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(delimiter = '|', value = {
            "{\"point\":null,\"seen_at\":\"2026-10-14T16:50:00Z\",\"note\":null}               | point",
            "{\"point\":{\"lat\":91,\"lng\":0},\"seen_at\":\"2026-10-14T16:50:00Z\",\"note\":null} | point.lat",
            "{\"point\":{\"lat\":6.25,\"lng\":-75.59},\"seen_at\":null,\"note\":null}           | seen_at",
    })
    void aBrokenFieldIsValidationFailedNamingIt(String json, String field) {
        ApiResponse r = correct(reporter, "7K3PQ", pin, json);
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has(field)).as(r.body()).isTrue();
        assertUncorrected();
    }

    @Test
    void aNoteLongerThan500CharactersIsRefused() {
        ApiResponse r = correct(reporter, "7K3PQ", pin, GOOD.replace("En la esquina", "a".repeat(501)));
        assertThat(r.json().at("/error/fields").has("note")).isTrue();
        assertUncorrected();
    }

    @Test
    void anAbsentRequiredFieldIsAJacksonErrorEvenOnAnUnknownPin() {
        ApiResponse r = correct(clients.newBrowser(), "ZZZZZ", UUID.randomUUID(), "{\"point\":{\"lat\":6.25,\"lng\":-75.59},\"seen_at\":\"2026-10-14T16:50:00Z\"}");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("note")).isTrue();
    }

    @Test
    void theHappyPathIsTwoStatementsAnonymousAndThreeSignedIn() {
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        ApiResponse r = correct(reporter, "7K3PQ", pin, GOOD);
        assertThat(r.statements()).as("%s", r.statements()).hasSize(2);   // anonymous: pre-read, update (no session lookup)
        ApiClient helper = clients.newBrowser();
        UUID andres = accounts.signIn(helper, "andres@correo.co");
        UUID theirs = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, andres, "9".repeat(64), null, "visible");
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        assertThat(correct(helper, "7K3PQ", theirs, GOOD).statements()).hasSize(3);   // session, pre-read, update
    }

    /**
     * The owner hides the pin while its reporter corrects it: the correction passed its pre-read, its UPDATE waits on the
     * owner's uncommitted change, re-checks status = 'visible' after the commit, matches nothing, re-reads and answers
     * forbidden. The longest path: session, pre-read, update, re-read = the ceiling, 4.
     */
    @Test
    void aHideCommittedDuringTheCorrectionMakesItForbiddenOnTheLongestPath() throws Exception {
        ApiClient helper = clients.newBrowser();
        UUID andres = accounts.signIn(helper, "andres@correo.co");
        UUID theirs = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, andres, "9".repeat(64), null, "visible");
        contention.hold("UPDATE scuby.sighting SET status = 'hidden_by_owner' WHERE id = ?", theirs);
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        var pool = Executors.newSingleThreadExecutor();
        try {
            Future<ApiResponse> f = pool.submit(() -> correct(helper, "7K3PQ", theirs, GOOD));
            contention.awaitWaiters(1);
            contention.commit();
            ApiResponse r = f.get(30, TimeUnit.SECONDS);
            assertThat(r.status()).isEqualTo(403);
            assertThat(r.statements()).as("%s", r.statements()).hasSize(4);
            assertThat(db.select(SIGHTING.LAT).from(SIGHTING).where(SIGHTING.ID.eq(theirs)).fetchOne(SIGHTING.LAT))
                    .isEqualTo(CaseFixtures.MEDELLIN.lat());
        } finally {
            pool.shutdownNow();
        }
    }
}
```

`B/src/test/java/co/scuby/cases/SightingDeleteTest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.cache.ClearableCache;
import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.flags.FeatureFlags;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.Contention;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;

import javax.sql.DataSource;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static co.scuby.db.generated.Tables.SIGHTING;
import static org.assertj.core.api.Assertions.assertThat;

/** «Borrar mi avistamiento» (spec §4.8): a status, never a hard delete; the replay key stays taken. */
@IntegrationTest
class SightingDeleteTest {

    static final Instant NOW = MutableClock.START;
    static final Instant CREATED = NOW.minus(Duration.ofMinutes(5));
    static final String PATH = "/cases/{code}/sightings/{sightingId}";

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired MutableClock clock;
    @Autowired DataSource dataSource;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient owner;
    ApiClient reporter;
    String device;
    UUID pin;
    Contention contention;

    @BeforeEach
    void setUp() {
        contention = new Contention(dataSource, db);
        owner = clients.newBrowser();
        cases.luna(accounts.signIn(owner, "carolina@correo.co"));
        reporter = clients.newBrowser();
        reporter.get("/config");
        device = Hashing.sha256Hex(reporter.cookie("device").orElseThrow());
        pin = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, null, device, "+573001112233", "visible");
    }

    @AfterEach
    void tearDown() throws Exception {
        contention.close();
    }

    private String status(UUID id) {
        return db.select(SIGHTING.STATUS).from(SIGHTING).where(SIGHTING.ID.eq(id)).fetchOne(SIGHTING.STATUS);
    }

    @Test
    void theReporterDeletesTheirPinAndItReachesNobodyButTheRowStays() {
        ApiResponse r = reporter.delete(PATH, "7K3PQ", pin);
        assertThat(r.status()).isEqualTo(204);
        assertThat(r.body()).isEmpty();
        assertThat(status(pin)).isEqualTo("deleted_by_reporter");
        assertThat(db.fetchCount(SIGHTING)).isEqualTo(1);
        for (ApiClient viewer : new ApiClient[] {owner, reporter, clients.newBrowser()}) {
            ApiResponse page = viewer.get("/cases/{code}", "7K3PQ");
            assertThat(page.json().get("sightings")).isEmpty();
            assertThat(page.body()).doesNotContain(pin.toString());
        }
        assertThat(clients.newBrowser().get("/feed").json().at("/items/0/sightings_count").asInt()).isZero();
    }

    @Test
    void aReplayOfTheDeletedPinsClientIdAnswersTheDeletedRowsId() {
        String body = "{\"point\":{\"lat\":6.2455,\"lng\":-75.5905},\"seen_at\":\"" + NOW + "\",\"note\":null,\"contact_phone\":null,\"client_id\":\"replay-after-delete\"}";
        String id = reporter.post("/cases/{code}/sightings", body, "7K3PQ").str("/id");
        assertThat(reporter.delete(PATH, "7K3PQ", id).status()).isEqualTo(204);
        ApiResponse again = reporter.post("/cases/{code}/sightings", body, "7K3PQ");
        assertThat(again.status()).isEqualTo(201);
        assertThat(again.str("/id")).isEqualTo(id);
        assertThat(status(UUID.fromString(id))).isEqualTo("deleted_by_reporter");
        assertThat(db.fetchCount(SIGHTING)).isEqualTo(2);       // the fixture pin and the deleted one; no new row
    }

    @Test
    void aClosedCaseStillLetsTheReporterDeleteInsideTheWindow() {
        cases.close("7K3PQ", "reunited", NOW.minusSeconds(60));
        assertThat(reporter.delete(PATH, "7K3PQ", pin).status()).isEqualTo(204);
        assertThat(status(pin)).isEqualTo("deleted_by_reporter");
    }

    @Test
    void theWindowEndsExclusivelyAtFifteenMinutes() {
        clock.set(CREATED.plus(Duration.ofMinutes(15)));
        assertThat(reporter.delete(PATH, "7K3PQ", pin).errorCode()).isEqualTo("forbidden");
        assertThat(status(pin)).isEqualTo("visible");
        clock.set(CREATED.plus(Duration.ofMinutes(15)).minusMillis(1));
        assertThat(reporter.delete(PATH, "7K3PQ", pin).status()).isEqualTo(204);
    }

    @Test
    void someoneElseTheOwnerIncludedIsForbidden() {
        assertThat(clients.newBrowser().delete(PATH, "7K3PQ", pin).errorCode()).isEqualTo("forbidden");
        assertThat(owner.delete(PATH, "7K3PQ", pin).errorCode()).isEqualTo("forbidden");
        assertThat(status(pin)).isEqualTo("visible");
    }

    @Test
    void anAnonymousPinStaysTheReportersToDeleteAfterTheySignIn() {
        accounts.signIn(reporter, "andres@correo.co");
        assertThat(reporter.delete(PATH, "7K3PQ", pin).status()).isEqualTo(204);
        assertThat(status(pin)).isEqualTo("deleted_by_reporter");
    }

    @Test
    void anotherPersonsPinSentFromThisBrowserIsForbidden() {
        UUID lauras = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, accounts.person("laura@correo.co"), device, null, "visible");
        accounts.signIn(reporter, "andres@correo.co");
        assertThat(reporter.delete(PATH, "7K3PQ", lauras).errorCode()).isEqualTo("forbidden");
        assertThat(status(lauras)).isEqualTo("visible");
    }

    @Test
    void aHiddenPinIsForbidden() {
        db.update(SIGHTING).set(SIGHTING.STATUS, "hidden_by_owner").where(SIGHTING.ID.eq(pin)).execute();
        assertThat(reporter.delete(PATH, "7K3PQ", pin).errorCode()).isEqualTo("forbidden");
        assertThat(status(pin)).isEqualTo("hidden_by_owner");
    }

    @Test
    void deletingTwiceAnswers204BothTimesEvenAfterTheWindowAndWritesNothingMore() {
        assertThat(reporter.delete(PATH, "7K3PQ", pin).status()).isEqualTo(204);
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        ApiResponse again = reporter.delete(PATH, "7K3PQ", pin);                      // a retry after a lost response
        assertThat(again.status()).isEqualTo(204);
        assertThat(again.statements()).as("answered by the pre-read: %s", again.statements()).hasSize(1);   // anonymous: the pre-read
        clock.set(CREATED.plus(Duration.ofHours(2)));
        assertThat(reporter.delete(PATH, "7K3PQ", pin).status()).as("already done: the window no longer matters").isEqualTo(204);
        assertThat(status(pin)).isEqualTo("deleted_by_reporter");
        assertThat(clients.newBrowser().delete(PATH, "7K3PQ", pin).errorCode()).as("someone else's deleted pin").isEqualTo("not_found");
        assertThat(owner.delete(PATH, "7K3PQ", pin).errorCode()).isEqualTo("not_found");
    }

    /** A double tap: the first delete is held uncommitted; the second waits, matches nothing, re-reads, finds it done: 204. */
    @Test
    void aDeleteThatMeetsTheFirstOneInFlightAnswers204() throws Exception {
        ApiClient helper = clients.newBrowser();
        UUID andres = accounts.signIn(helper, "andres@correo.co");
        UUID theirs = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, andres, "9".repeat(64), null, "visible");
        contention.hold("UPDATE scuby.sighting SET status = 'deleted_by_reporter' WHERE id = ?", theirs);
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        var pool = Executors.newSingleThreadExecutor();
        try {
            Future<ApiResponse> f = pool.submit(() -> helper.delete(PATH, "7K3PQ", theirs));
            contention.awaitWaiters(1);
            contention.commit();
            ApiResponse r = f.get(30, TimeUnit.SECONDS);
            assertThat(r.status()).isEqualTo(204);
            assertThat(r.statements()).as("%s", r.statements()).hasSize(4);   // session, pre-read, update (zero rows), re-read
            assertThat(status(theirs)).isEqualTo("deleted_by_reporter");
        } finally {
            pool.shutdownNow();
        }
    }

    @ParameterizedTest
    @CsvSource({"ZZZZZ", "bad!"})
    void anUnknownCodeIsNotFound(String code) {
        assertThat(reporter.delete(PATH, code, pin).errorCode()).isEqualTo("not_found");
        assertThat(reporter.delete(PATH, "7K3PQ", "not-a-uuid").errorCode()).isEqualTo("not_found");
    }

    @Test
    void theLongestPathIsFourStatementsWhenTheOwnerHidesThePinMeanwhile() throws Exception {
        ApiClient helper = clients.newBrowser();
        UUID andres = accounts.signIn(helper, "andres@correo.co");
        UUID theirs = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, andres, "9".repeat(64), null, "visible");
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        assertThat(helper.delete(PATH, "7K3PQ", theirs).statements()).as("happy path").hasSize(3);   // session, pre-read, update
        UUID another = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, andres, "9".repeat(64), null, "visible");
        contention.hold("UPDATE scuby.sighting SET status = 'hidden_by_owner' WHERE id = ?", another);
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        var pool = Executors.newSingleThreadExecutor();
        try {
            Future<ApiResponse> f = pool.submit(() -> helper.delete(PATH, "7K3PQ", another));
            contention.awaitWaiters(1);
            contention.commit();
            ApiResponse r = f.get(30, TimeUnit.SECONDS);
            assertThat(r.errorCode()).isEqualTo("forbidden");
            assertThat(r.statements()).as("%s", r.statements()).hasSize(4);
            assertThat(status(another)).isEqualTo("hidden_by_owner");
        } finally {
            pool.shutdownNow();
        }
    }
}
```

`B/src/test/java/co/scuby/cases/OwnPinPrecedenceTest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.crypto.Hashing;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** Correction: not_found → forbidden → invalid_transition → fields → seen_at_in_future → seen_at_before_case → too far (spec §4.7). */
@IntegrationTest
class OwnPinPrecedenceTest {

    static final Instant CREATED = MutableClock.START.minus(Duration.ofMinutes(5));
    static final String PATH = "/cases/{code}/sightings/{sightingId}/correction";

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;

    ApiClient reporter;
    UUID mine;
    UUID someoneElses;

    @BeforeEach
    void setUp() {
        UUID carolina = accounts.person("carolina@correo.co");
        cases.luna(carolina);
        cases.lostCase(carolina, "OTH22", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "active", MutableClock.START.minusSeconds(7200));
        reporter = clients.newBrowser();
        reporter.get("/config");
        String device = Hashing.sha256Hex(reporter.cookie("device").orElseThrow());
        mine = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, CREATED, CREATED, null, device, null, "visible");
        someoneElses = cases.sighting("OTH22", CaseFixtures.MEDELLIN, CREATED, CREATED, null, "7".repeat(64), null, "visible");
    }

    private String body(String point, String seenAt, String note) {
        return "{\"point\":" + point + ",\"seen_at\":\"" + seenAt + "\",\"note\":" + note + "}";
    }

    @Test
    void notFoundBeatsForbidden() {
        assertThat(reporter.post(PATH, body("{\"lat\":6.25,\"lng\":-75.59}", "2026-10-14T16:50:00Z", "null"), "7K3PQ", someoneElses).errorCode())
                .isEqualTo("not_found");
    }

    @Test
    void forbiddenBeatsAClosedCase() {
        cases.close("OTH22", "reunited", MutableClock.START.minusSeconds(60));
        assertThat(reporter.post(PATH, body("{\"lat\":6.25,\"lng\":-75.59}", "2026-10-14T16:50:00Z", "null"), "OTH22", someoneElses).errorCode())
                .isEqualTo("forbidden");
    }

    @Test
    void aClosedCaseBeatsABrokenField() {
        cases.close("7K3PQ", "reunited", MutableClock.START.minusSeconds(60));
        assertThat(reporter.post(PATH, body("null", "2026-10-14T16:50:00Z", "null"), "7K3PQ", mine).errorCode()).isEqualTo("invalid_transition");
    }

    @Test
    void aBrokenFieldBeatsTheSightingRules() {
        var r = reporter.post(PATH, body("{\"lat\":4.711,\"lng\":-74.07}", "2026-10-15T17:00:00Z", "\"" + "a".repeat(501) + "\""), "7K3PQ", mine);
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has("note")).isTrue();
    }

    @Test
    void futureBeatsBeforeCaseAndBeforeCaseBeatsTooFar() {
        assertThat(reporter.post(PATH, body("{\"lat\":4.711,\"lng\":-74.07}", "2026-10-15T17:00:00Z", "null"), "7K3PQ", mine).errorCode())
                .isEqualTo("seen_at_in_future");
        assertThat(reporter.post(PATH, body("{\"lat\":4.711,\"lng\":-74.07}", "2026-10-01T17:00:00Z", "null"), "7K3PQ", mine).errorCode())
                .isEqualTo("seen_at_before_case");
    }
}
```

Run: `[mvn] test -Dtest='BodyValidationTest,SightingCorrectionTest,SightingDeleteTest,OwnPinPrecedenceTest' 2>&1 | tail -15`
Expected: FAIL — `cannot find symbol: class BodyValidation`; then `no statement ceiling for POST /cases/{code}/sightings/{sightingId}/correction`.

- [ ] **Step 4: Implement `BodyValidation`**

In `B/src/main/java/co/scuby/platform/web/ApiErrorHandler.java` change `private static String wirePath(String javaPath)` to `static String wirePath(String javaPath)` (package-private, reused by `BodyValidation`).

`B/src/main/java/co/scuby/platform/web/BodyValidation.java`:

```java
package co.scuby.platform.web;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * Bean validation of a request record the controller bound WITHOUT @Valid, run by the service at the point the endpoint's
 * error order says (docs/eng/backend.md · Request validation; e.g. after the owner check). Fields are wire paths, as
 * ApiErrorHandler names them; a list element's violation is named by its list (photo_urls, not photo_urls[2]).
 */
@Component
public class BodyValidation {

    private final Validator validator;

    public BodyValidation(Validator validator) {
        this.validator = validator;
    }

    public void require(Object body) {
        Set<ConstraintViolation<Object>> found = validator.validate(body);
        if (found.isEmpty()) return;
        Map<String, String> fields = new TreeMap<>();
        for (ConstraintViolation<Object> v : found) {
            String path = v.getPropertyPath().toString();
            int index = path.indexOf('[');
            fields.putIfAbsent(ApiErrorHandler.wirePath(index >= 0 ? path.substring(0, index) : path), v.getMessage());
        }
        throw new ApiException(ErrorCode.VALIDATION_FAILED, "request does not match the contract", fields, Map.of());
    }
}
```

- [ ] **Step 5: Implement correction and delete**

`B/src/main/java/co/scuby/cases/SightingCorrectionRequest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.web.CodePoints;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.jspecify.annotations.Nullable;

import java.time.OffsetDateTime;

/**
 * SightingCorrectionRequest (web/src/contracts/actions.ts). All three required (absent = a Jackson error before any lookup);
 * point and seen_at not null and note ≤ 500 are checked by BodyValidation after the pin, owner and case checks (spec §4.7).
 */
record SightingCorrectionRequest(@JsonProperty(required = true) @NotNull @Valid PointInput point,
                                 @JsonProperty(required = true) @NotNull OffsetDateTime seenAt,
                                 @JsonProperty(required = true) @Nullable @CodePoints(max = 500) String note) {}
```

In `B/src/main/java/co/scuby/cases/SightingQueries.java` add the imports `org.jooq.Condition`, `org.jooq.Field`, `org.jooq.impl.SQLDataType`, and inside the class:

```java
    /** The reporter's pin with what correction and delete classify: its status, age and reporter, its case's status and time. */
    record OwnPin(String status, Instant createdAt, @Nullable UUID reporterPersonId, String reporterDeviceHash,
                  String caseStatus, Instant lastSeenAt, @Nullable Double distanceM) {}

    /**
     * One read: the pin on this case, joined to its case, and — when the body carries a usable point — that point's
     * distance from the case's SNAPPED public center (decision #69), never from the exact point.
     */
    Optional<OwnPin> ownPin(String code, UUID id, @Nullable GeoPoint point) {
        Field<Double> distance = point == null
                ? DSL.inline((Double) null, SQLDataType.DOUBLE).as("distance_m")
                : Spatial.distanceMeters(LOST_CASE.LAST_SEEN_PUBLIC_POINT, Spatial.geography(point)).as("distance_m");
        return db.select(SIGHTING.STATUS, SIGHTING.CREATED_AT, SIGHTING.REPORTER_PERSON_ID, SIGHTING.REPORTER_DEVICE_HASH,
                         LOST_CASE.STATUS, LOST_CASE.LAST_SEEN_AT, distance)
                 .from(SIGHTING).join(LOST_CASE).on(LOST_CASE.CODE.eq(SIGHTING.CASE_CODE))
                 .where(SIGHTING.ID.eq(id), SIGHTING.CASE_CODE.eq(code))
                 .fetchOptional(r -> new OwnPin(r.value1(), r.value2().toInstant(), r.value3(), r.value4(), r.value5(),
                         r.value6().toInstant(), r.value7()));
    }

    /**
     * "Mine" in SQL, as LostCaseDerivation.mine: the caller's person, or a pin with no person from the caller's device
     * (docs/eng/api.md · Device identity). Another person's pin never matches, whatever device sent it.
     */
    private static Condition reportedBy(Caller caller) {
        Condition anonymousFromThisDevice = SIGHTING.REPORTER_PERSON_ID.isNull().and(SIGHTING.REPORTER_DEVICE_HASH.eq(caller.deviceHash()));
        return caller.personId() == null
                ? anonymousFromThisDevice
                : SIGHTING.REPORTER_PERSON_ID.eq(caller.personId()).or(anonymousFromThisDevice);
    }

    /** Visible and inside the 15-minute window: created_at > now − 15 min (exclusive, as LostCaseDerivation.editable). */
    private static Condition stillEditable(Instant now) {
        return SIGHTING.STATUS.eq(DSL.inline("visible"))
                .and(SIGHTING.CREATED_AT.gt(now.minus(LostCaseDerivation.EDIT_WINDOW).atOffset(ZoneOffset.UTC)));
    }

    /** Moves the pin, its time and note; photos, contact and created_at stay. The guard repeats every check, the case's status included. */
    boolean correct(String code, UUID id, Caller caller, GeoPoint point, Instant seenAt, @Nullable String note, Instant now) {
        return db.update(SIGHTING)
                 .set(SIGHTING.LAT, point.lat())
                 .set(SIGHTING.LNG, point.lng())
                 .set(SIGHTING.SEEN_AT, seenAt.atOffset(ZoneOffset.UTC))
                 .set(SIGHTING.NOTE, note)
                 .where(SIGHTING.ID.eq(id), SIGHTING.CASE_CODE.eq(code), stillEditable(now), reportedBy(caller),
                        DSL.exists(DSL.selectOne().from(LOST_CASE)
                                .where(LOST_CASE.CODE.eq(code), LOST_CASE.STATUS.eq(DSL.inline("active")))))
                 .execute() == 1;
    }

    /** Delete is a status: the row and its (case_code, client_id) replay key stay. No case-status guard (spec §4.8). */
    boolean deleteOwn(String code, UUID id, Caller caller, Instant now) {
        return db.update(SIGHTING)
                 .set(SIGHTING.STATUS, DSL.inline("deleted_by_reporter"))
                 .where(SIGHTING.ID.eq(id), SIGHTING.CASE_CODE.eq(code), stillEditable(now), reportedBy(caller))
                 .execute() == 1;
    }
```

In `B/src/main/java/co/scuby/cases/SightingService.java`: add the imports `co.scuby.platform.web.BodyValidation`, `org.jspecify.annotations.Nullable`; add the field `private final BodyValidation validation;`, add `BodyValidation validation` as the last constructor parameter and assign it; then add these methods before `notFound()`:

```java
    /**
     * «Corregir» (L1 design §4.7). Order: the pin is on this case and not moderated or deleted (not_found) → mine, visible,
     * inside the window (forbidden) → the case is active (invalid_transition) → the fields → the «Lo vi» rules, the
     * distance from the snapped center. One conditional UPDATE repeats every guard; zero rows → re-read and re-classify.
     */
    public void correct(String rawCode, String rawId, Caller caller, SightingCorrectionRequest body) {
        String code = CaseCodes.normalize(rawCode).orElseThrow(SightingService::notFound);
        UUID id = OwnerAccess.id(rawId).orElseThrow(SightingService::noSuchSighting);
        Instant now = clock.instant();
        SightingQueries.OwnPin pin = queries.ownPin(code, id, usable(body.point())).orElseThrow(SightingService::noSuchSighting);
        classify(pin, caller, now, true);
        validation.require(body);
        Instant seenAt = body.seenAt().toInstant();
        SightingRulesDerivation.check(seenAt, now, pin.lastSeenAt(), pin.distanceM()).ifPresent(refusal -> {
            throw new ApiException(ErrorCode.valueOf(refusal.name()), refusal.name().toLowerCase());
        });
        if (queries.correct(code, id, caller, body.point().toGeoPoint(), seenAt, body.note(), now)) return;
        classify(queries.ownPin(code, id, null).orElseThrow(SightingService::noSuchSighting), caller, now, true);
        throw new ApiException(ErrorCode.INVALID_TRANSITION, "the case is not active");
    }

    /**
     * «Borrar» (L1 design §4.8): as correct without the case-status check; a status, never a hard delete. Idempotent: the
     * caller's own pin already deleted_by_reporter answers 204 again with no write (a retry after a lost response, or a
     * double tap whose first delete won the race); someone else's deleted pin stays not_found.
     */
    public void delete(String rawCode, String rawId, Caller caller) {
        String code = CaseCodes.normalize(rawCode).orElseThrow(SightingService::notFound);
        UUID id = OwnerAccess.id(rawId).orElseThrow(SightingService::noSuchSighting);
        Instant now = clock.instant();
        SightingQueries.OwnPin pin = queries.ownPin(code, id, null).orElseThrow(SightingService::noSuchSighting);
        if (deletedByCaller(pin, caller)) return;
        classify(pin, caller, now, false);
        if (queries.deleteOwn(code, id, caller, now)) return;
        SightingQueries.OwnPin after = queries.ownPin(code, id, null).orElseThrow(SightingService::noSuchSighting);
        if (deletedByCaller(after, caller)) return;
        classify(after, caller, now, false);
        throw new ApiException(ErrorCode.FORBIDDEN, "this pin can no longer be deleted");
    }

    /** Already in the delete's target state, and the caller's: nothing to do. */
    private static boolean deletedByCaller(SightingQueries.OwnPin pin, Caller caller) {
        return "deleted_by_reporter".equals(pin.status())
                && LostCaseDerivation.mine(caller.personId(), caller.deviceHash(), pin.reporterPersonId(), pin.reporterDeviceHash());
    }

    private static void classify(SightingQueries.OwnPin pin, Caller caller, Instant now, boolean needsActiveCase) {
        if ("removed_by_moderation".equals(pin.status()) || "deleted_by_reporter".equals(pin.status())) throw noSuchSighting();
        boolean mine = LostCaseDerivation.mine(caller.personId(), caller.deviceHash(), pin.reporterPersonId(), pin.reporterDeviceHash());
        if (!LostCaseDerivation.editable(mine, "visible".equals(pin.status()), pin.createdAt(), now)) {
            throw new ApiException(ErrorCode.FORBIDDEN, "only its reporter, while it is visible and inside its 15 minutes");
        }
        if (needsActiveCase && !"active".equals(pin.caseStatus())) {
            throw new ApiException(ErrorCode.INVALID_TRANSITION, "the case is not active");
        }
    }

    /** A point good enough to measure (the field rules refuse the others later, in their order). */
    private static @Nullable GeoPoint usable(@Nullable PointInput p) {
        if (p == null || p.lat() == null || p.lng() == null) return null;
        if (p.lat() < -90 || p.lat() > 90 || p.lng() < -180 || p.lng() > 180) return null;
        return p.toGeoPoint();
    }

    private static ApiException noSuchSighting() {
        return new ApiException(ErrorCode.NOT_FOUND, "no such sighting");
    }
```

In `B/src/main/java/co/scuby/cases/SightingController.java` add the imports `org.springframework.web.bind.annotation.DeleteMapping`; and, after `report`:

```java
    /** correctSighting: 204. Public (the caller's person, or an anonymous pin from their device). Bound without @Valid: the order of spec §4.7 decides. */
    @PostMapping("/cases/{code}/sightings/{sightingId}/correction")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void correct(@PathVariable String code, @PathVariable String sightingId, Caller caller, @RequestBody SightingCorrectionRequest body) {
        service.correct(code, sightingId, caller, body);
    }

    /** deleteSighting: 204. Public; the owner's PATCH on the same path needs a session (CasesSecurityRules names the method). */
    @DeleteMapping("/cases/{code}/sightings/{sightingId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void delete(@PathVariable String code, @PathVariable String sightingId, Caller caller) {
        service.delete(code, sightingId, caller);
    }
```

In `StatementCeilings` add:

```java
            Map.entry("POST /cases/{code}/sightings/{sightingId}/correction", 4),   // longest path, SightingCorrectionTest: session, pre-read (pin + case + distance), update (zero rows), re-read; 3 signed in, 2 anonymous
            Map.entry("DELETE /cases/{code}/sightings/{sightingId}", 4),            // as correction (SightingDeleteTest: the hide race and the double-tap race); a repeat of a done delete is the pre-read only
```

`CasesSecurityRules` gets no line: both routes are public.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `[mvn] test -Dtest='BodyValidationTest,SightingCorrectionTest,SightingDeleteTest,OwnPinPrecedenceTest,SightingEndpointTest,SightingPrecedenceTest,SightingRaceTest,LostCaseDerivationTest,ContractCoverageTest,RequiredFieldsTest,ArchitectureTest' 2>&1 | tail -20`
Expected: PASS. `ContractCoverageTest` does not list correction or delete among session routes (they are public in the contract).

- [ ] **Step 7: Run the whole suite and commit**

Run: `[mvn] verify 2>&1 | tail -10` — Expected: `BUILD SUCCESS`; PIT still ≥ 80 % with the new `mine`/`editable` rows (a surviving mutant of either `mine` clause means a missing row: add it).

```bash
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 add \
  backend/src/main/java/co/scuby/platform/web/BodyValidation.java backend/src/main/java/co/scuby/platform/web/ApiErrorHandler.java \
  backend/src/test/java/co/scuby/platform/web/BodyValidationTest.java \
  backend/src/main/java/co/scuby/cases/LostCaseDerivation.java backend/src/test/java/co/scuby/cases/LostCaseDerivationTest.java \
  backend/src/main/java/co/scuby/cases/SightingCorrectionRequest.java backend/src/main/java/co/scuby/cases/SightingQueries.java \
  backend/src/main/java/co/scuby/cases/SightingService.java backend/src/main/java/co/scuby/cases/SightingController.java \
  backend/src/test/java/co/scuby/support/StatementCeilings.java \
  backend/src/test/java/co/scuby/cases/SightingCorrectionTest.java backend/src/test/java/co/scuby/cases/SightingDeleteTest.java \
  backend/src/test/java/co/scuby/cases/OwnPinPrecedenceTest.java
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 commit -m "feat: a reporter corrects or deletes their own pin; mine is their person or an anonymous pin from their device"
```

---
### Task 8: The contract change — owner-only claim badge, «Lo tengo» needs a session, `active_case_exists` on reopen and claims

**The only task that edits `web/`.** The backend owns this change (spec §6): it edits `web/src/contracts`, regenerates `docs/eng/openapi.json` with `pnpm openapi`, brings the client mock to the same behaviour, moves `@LINK-001`'s «Posible hallazgo» assertion to the owner, and gives `@HELP-002` and `@HELP-005` the sign-in step a claim now needs (they would otherwise break web CI, which runs `pnpm e2e` against the mock). Only the badge was a product decision (decision row #76, Task 14); the `claimRecovery` and `reopenCase` rows make the contract list the auth and the codes the decided behaviour answers (rows #75 and #71). Without them `ApiClient` refuses `claimRecovery`'s `401`/`403`/`410` in Task 9 (those statuses are not listed for the route yet) and `ContractCoverageTest` fails; reopen's `409` is already listed, so Task 4's tests pass before this task — the code is added for the client.

**Files (all under `W/web/` except the regenerated document):**
- Modify: `src/contracts/case.ts`, `src/contracts/feed.ts`, `src/contracts/endpoints/helpers.ts`, `src/contracts/endpoints/lost.ts`, `src/domain/lost/actions.ts`
- Modify: `src/mocks/serialize.ts`, `src/mocks/api/reads.ts`, `src/mocks/fixtures.ts`, `src/mocks/api/helpers.ts`, `src/mocks/backend.test.ts`
- Modify: `src/features/lost/LostCasePage.test.tsx` (a helper no longer sees the badge)
- Modify: `e2e/lost-case.spec.ts`, `e2e/helper-actions.spec.ts` (a claim signs in first; the claimant never sees the badge)
- Regenerated: `W/docs/eng/openapi.json`

**Interfaces:**
- Consumes: nothing from earlier tasks (the backend still answers `open_claim_count: 0` and `possible_find: false`, which the widened contract accepts).
- Produces (the wire every later task is validated against):
  - `LostCase.open_claim_count`: `integer ≥ 0 | null`; `FeedItem.possible_find`: `boolean | null`.
  - `POST /cases/{code}/recovery-claims`: `security: session`; responses `201, 401, 403, 404, 409, 410, 422, 429, 500` (errors `not_found, forbidden, invalid_transition, active_case_exists, gone`).
  - `POST /cases/{code}/reopen`: errors `not_found, forbidden, invalid_transition, active_case_exists` (409 lists both).
  - TS: `LostCase.openClaimCount: number | null`, `FeedItem.possibleFind: boolean | null`, `hasPossibleFind(openClaimCount: number | null): boolean`.

- [ ] **Step 1: Install the client's dependencies**

Run: `cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1/web && if command -v pnpm >/dev/null 2>&1; then P=pnpm; else P="npx --yes pnpm@10.27.0"; fi && $P install --frozen-lockfile 2>&1 | tail -3 && $P test 2>&1 | tail -5`
Expected: install ends without error; `pnpm test` (Vitest) passes on the unchanged tree (`Test Files … passed`). Record the counts. Use the same `$P` in every later step of this task (prefix each command with the same `if … fi` line).

- [ ] **Step 2: Write the failing mock-backend expectations**

In `W/web/src/mocks/backend.test.ts`:

(a) in `a stranger gets no claims, no reporters’ numbers, no hidden pins, no check-in`, replace

```ts
    expect(luna.openClaimCount).toBe(1)
```

with

```ts
    // Owner-only: a claim must never reduce reach (docs/product/04 · Rule: a recovery claim must never reduce reach).
    expect(luna.openClaimCount).toBeNull()
```

(b) in `the owner gets all of it`, after

```ts
    expect(luna.claims.map((c) => c.phone)).toEqual(['+573114829017'])
```

add

```ts
    expect(luna.openClaimCount).toBe(1)
```

(c) in `a claim asks the owner at +24 h; «sí, es ella» confirms it and closes the case`, replace

```ts
  it('a claim asks the owner at +24 h; «sí, es ella» confirms it and closes the case', async () => {
    const claim = (await call(
```

with

```ts
  it('a claim asks the owner at +24 h; «sí, es ella» confirms it and closes the case', async () => {
    await asNewcomer('pedro.ruiz@correo.co') // «Lo tengo» needs a session (decision #75)
    const claim = (await call(
```

(d) in `two unanswered time-based check-ins expire the case; the claim goes stale on its own`, replace

```ts
    const code = await publishKira()
    await call(api.claimRecovery, { params: { code }, body: { phone: '+573001112233' } }, asIs)
```

with

```ts
    const code = await publishKira()
    await asNewcomer('pedro.ruiz@correo.co') // the owner cannot claim their own case; a claim needs a session
    await call(api.claimRecovery, { params: { code }, body: { phone: '+573001112233' } }, asIs)
    await asNewcomer('ana.gomez@correo.co') // back to the owner: only she sees the claims and the inbox
```

(e) append a new `describe` at the end of the file:

```ts
describe('«Lo tengo» (04 · recovery_claim; decisions #75, #76)', () => {
  const claim = (code: string) =>
    call(api.claimRecovery, { params: { code }, body: { phone: '+573001112233' } }, asIs) as Promise<{
      id: string
      whatsapp_url: string | null
    }>

  it('needs a session', async () => {
    expect((await failure(claim('7K3PQ'))).code).toBe('unauthorized')
  })

  it('the owner cannot claim their own case', async () => {
    await asCarolina()
    expect((await failure(claim('7K3PQ'))).code).toBe('forbidden')
  })

  it('a purged code is `gone`', async () => {
    await asNewcomer('pedro.ruiz@correo.co')
    expect((await failure(claim('GONE5'))).code).toBe('gone')
  })

  it('a repeat refreshes the open claim: same id, the new phone, one row', async () => {
    const pedro = await asNewcomer('pedro.ruiz@correo.co')
    const first = await claim('7K3PQ')
    const again = (await call(
      api.claimRecovery,
      { params: { code: '7K3PQ' }, body: { phone: '+573009998877' } },
      asIs,
    )) as { id: string }
    expect(again.id).toBe(first.id)
    const mine = db.recoveryClaims.filter((c) => c.case_code === '7K3PQ' && c.claimant_id === pedro.id)
    expect(mine).toHaveLength(1)
    expect(mine[0]?.phone).toBe('+573009998877')
    expect(mine[0]?.status).toBe('open')
  })

  it('the badge is null in the feed for everyone but the publisher', async () => {
    const anonymous = await call(api.getFeed, { query: {} }, parseFeed)
    expect(anonymous.items.every((i) => i.possibleFind === null)).toBe(true)
    await asCarolina()
    const mine = await call(api.getFeed, { query: {} }, parseFeed)
    expect(mine.items.find((i) => i.code === '7K3PQ')?.possibleFind).toBe(true)
  })
})
```

(f) in `W/web/src/features/lost/LostCasePage.test.tsx`, replace the test

```tsx
  it('shows the possible-find badge while a claim is open, and keeps the actions', () => {
    show(lostCase('7K3PQ'))
    expect(screen.getByText('Posible hallazgo.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /La vi/ })).toBeTruthy()
  })
```

with

```tsx
  it('a helper never sees the possible-find badge (it is the owner’s, decision #76), and keeps the actions', () => {
    show(lostCase('7K3PQ'))
    expect(screen.queryByText('Posible hallazgo.')).toBeNull()
    expect(screen.getByRole('button', { name: /La vi/ })).toBeTruthy()
  })
```

(the page itself is not changed: it already shows the owner the claims list «Posibles hallazgos» instead of the public badge — the test `sees who says they have her … instead of the public badge` stays as it is).

Run: `$P test src/mocks/backend.test.ts src/features/lost/LostCasePage.test.tsx 2>&1 | tail -15`
Expected: FAIL — the stranger's `openClaimCount` is `1` (not null), `needs a session` gets a claim instead of `unauthorized`, `a repeat refreshes the open claim` finds two rows, the feed's `possibleFind` is `false`/`true` for anonymous callers, and the page still shows a helper «Posible hallazgo.».

- [ ] **Step 3: Change the contract**

`W/web/src/contracts/case.ts` — replace

```ts
  open_claim_count: z.int().check(z.nonnegative()),
```

with

```ts
  /**
   * Only the owner receives it (null otherwise): a claim must never reduce reach (docs/product/04 · Rule: a recovery
   * claim must never reduce reach). Open, non-stale claims on an active case; 0 once the case is closed.
   */
  open_claim_count: z.nullable(z.int().check(z.nonnegative())),
```

and in the `LostCase` type replace `  openClaimCount: number` with `  openClaimCount: number | null`.

`W/web/src/contracts/feed.ts` — replace

```ts
  possible_find: z.boolean(),
```

with

```ts
  /**
   * Only the item's publisher receives it (null otherwise): a claim must never reduce reach (docs/product/04 · Rule: a
   * recovery claim must never reduce reach).
   */
  possible_find: z.nullable(z.boolean()),
```

and in the `FeedItem` type replace `  possibleFind: boolean` with `  possibleFind: boolean | null`.

`W/web/src/contracts/endpoints/helpers.ts` — replace the whole `claimRecovery` entry with:

```ts
export const claimRecovery = endpoint({
  method: 'POST',
  path: '/cases/:code/recovery-claims',
  summary:
    '«Lo tengo» on a lost case. Needs a session: the claimant is a person, for the owner’s safety (say so in the UI). ' +
    'The case’s owner cannot claim it. Creates the claim, then answers the channel to the owner; a repeated claim by ' +
    'the same person refreshes their open one (the new phone, photos and pin; it counts as fresh again) and answers ' +
    'its id. A `from_sighting_id` that is not the caller’s own visible pin of the last 24 hours is ignored, never ' +
    'refused. On a case archived less than 30 days ago it reactivates it first (decision #29), unless the pet has ' +
    'another active case (`active_case_exists`).',
  auth: 'session',
  body: recoveryClaimRequest,
  status: 201,
  response: claimWire,
  errors: ['not_found', 'forbidden', 'invalid_transition', 'active_case_exists', 'gone'],
})
```

`W/web/src/contracts/endpoints/lost.ts` — in `reopenCase`, replace

```ts
    'an adoption listing up to 90 (adoption timelines are months).',
  auth: 'session',
  response: createdWire,
  errors: OWNER_ONLY,
```

with

```ts
    'an adoption listing up to 90 (adoption timelines are months). `active_case_exists` when the pet has another active case.',
  auth: 'session',
  response: createdWire,
  errors: [...OWNER_ONLY, 'active_case_exists'],
```

`W/web/src/domain/lost/actions.ts` — replace

```ts
export function hasPossibleFind(openClaimCount: number): boolean {
  return openClaimCount > 0
}
```

with

```ts
export function hasPossibleFind(openClaimCount: number | null): boolean {
  // null: the viewer is not the owner, who alone sees the badge (decision #76).
  return (openClaimCount ?? 0) > 0
}
```

- [ ] **Step 4: Bring the mock to the same behaviour**

`W/web/src/mocks/serialize.ts`:

(a) in `lostView`, replace

```ts
    last_seen: row.last_seen,
    open_claim_count: claims.filter((c) => c.status === 'open').length,
```

with

```ts
    last_seen: row.last_seen,
    // Owner-only (decision #76): null for everyone else; 0 once the case is closed.
    open_claim_count: owner
      ? row.status === 'active'
        ? claims.filter((c) => c.status === 'open').length
        : 0
      : null,
```

(b) replace `function feedItem(t: Tables, row: CaseRow): FeedItem | null {` and the line after it, `  if (row.status !== 'active') return null`, with

```ts
function feedItem(t: Tables, row: CaseRow, viewerId: string | null): FeedItem | null {
  if (row.status !== 'active') return null
  // The badge reaches only the item's publisher (decision #76).
  const mine = viewerId !== null && row.created_by === viewerId
```

(c) replace each of the three lines `      possible_find: false,` (the help, adoption and found items) with `      possible_find: mine ? false : null,`

(d) replace

```ts
    possible_find: t.recoveryClaims.some((c) => c.case_code === row.code && c.status === 'open'),
```

with

```ts
    possible_find: mine
      ? t.recoveryClaims.some((c) => c.case_code === row.code && c.status === 'open')
      : null,
```

(e) replace `export function feedView(t: Tables, near: Point | null): FeedWire {` with `export function feedView(t: Tables, near: Point | null, viewerId: string | null): FeedWire {`, and in its body `    (row) => feedItem(t, row) ?? [],` with `    (row) => feedItem(t, row, viewerId) ?? [],`.

`W/web/src/mocks/api/reads.ts` — replace

```ts
  route(api.getFeed, ({ query }) => {
    const near =
      query.lat !== undefined && query.lng !== undefined ? { lat: query.lat, lng: query.lng } : null
    const feed = feedView(db, near)
```

with

```ts
  route(api.getFeed, ({ query, user }) => {
    const near =
      query.lat !== undefined && query.lng !== undefined ? { lat: query.lat, lng: query.lng } : null
    const feed = feedView(db, near, user?.id ?? null)
```

`W/web/src/mocks/fixtures.ts` — replace `  return feedView(seed(), null).items` with `  return feedView(seed(), null, null).items`.

`W/web/src/mocks/api/helpers.ts` — replace the whole `route(api.claimRecovery, …)` entry (from `  route(api.claimRecovery, ({ params, body, user }) => {` through its closing `  }),`) with:

```ts
  route(api.claimRecovery, ({ params, body, user }) => {
    const code = params.code.toUpperCase()
    if (db.purged.includes(code)) fail('gone')
    const row = findCase(code) ?? fail('not_found')
    if (row.vertical !== 'lost') fail('not_found')
    // A session is required (the route wrapper answered `unauthorized`); the owner cannot claim their own case.
    if (row.created_by === user.id) fail('forbidden')
    // Someone holding the animal is stronger evidence of a live search than the owner tapping
    // «reabrir» (decision #29): inside the 30-day window, a claim reactivates an archived case —
    // unless the pet already has another active case.
    const reopens =
      row.status === 'expired' &&
      row.resolved_at !== null &&
      Date.now() - ms(row.resolved_at) <= REOPEN_WINDOW
    if (row.status !== 'active' && !reopens) fail('invalid_transition')
    if (reopens) {
      const other = Object.values(db.cases).find(
        (c) =>
          c.vertical === 'lost' && c.pet_id === row.pet_id && c.code !== row.code && c.status === 'active',
      )
      if (other) fail('active_case_exists', { case_code: other.code })
    }
    const whatsapp = row.contact_prefs.expose_whatsapp && row.phone_has_whatsapp
    const whatsappUrl = whatsapp ? `https://wa.me/${row.contact_phone.replace('+', '')}` : null
    if (reopens) {
      row.status = 'active'
      row.resolved_at = null
      row.resolution = null
      onOwnerInteraction(row.code)
    }
    // One open claim per person per case: a repeat refreshes the open one, a stale one included — the
    // new phone, and it counts as fresh again (decision #75).
    const open = db.recoveryClaims.find(
      (c) =>
        c.case_code === row.code &&
        c.claimant_id === user.id &&
        (c.status === 'open' || c.status === 'stale'),
    )
    if (open) {
      open.phone = body.phone
      open.status = 'open'
      open.stale_at = iso(Date.now() + 7 * DAY)
      return { id: open.id, whatsapp_url: whatsappUrl }
    }
    const id = newId('claim-')
    const staleAt = onClaimOpened(row.code, id)
    db.recoveryClaims.push({
      id,
      case_code: row.code,
      phone: body.phone,
      claimant_id: user.id,
      created_at: iso(Date.now()),
      status: 'open',
      stale_at: staleAt,
    })
    const name = db.pets.find((p) => p.id === row.pet_id)?.name ?? 'tu mascota'
    notify(
      row.created_by,
      'recovery_claim.opened',
      `Alguien dice que tiene a ${name}. Ábrelo para contactar.`,
      row.code,
    )
    return { id, whatsapp_url: whatsappUrl }
  }),
```

- [ ] **Step 5: Move `@LINK-001`'s badge assertion to the owner**

In `W/web/e2e/lost-case.spec.ts`, inside the `@LINK-001` test:

(a) replace the FIRST occurrence of `  async ({ casePage }) => {` (the `@LINK-001` test's parameter list; later tests keep theirs) with `  async ({ casePage, profile }) => {`;

(b) delete the line `      await expect(casePage.possibleFind).toBeVisible()` from the first step (a stranger no longer sees the badge);

(c) after the step `'the map loads after the page, on its own, and the family is reachable'` (before the test's closing `  },`), add:

```ts

    await test.step('its owner, signed in, sees the possible find', async () => {
      await profile.open()
      await profile.signIn.withEmailCode('carolina@correo.co')
      await expect(profile.email('carolina@correo.co')).toBeVisible()
      await casePage.open('7K3PQ')
      // The owner's «Posible hallazgo» is the claims list (the page shows it instead of the public badge).
      await expect(casePage.claims).toBeVisible()
      await expect(casePage.claims.getByText('+573114829017')).toBeVisible()
      await expect(casePage.possibleFind).toHaveCount(0)
    })
```

- [ ] **Step 5b: Give `@HELP-002` and `@HELP-005` a sign-in step**

Both claim as a stranger and then expect the public «Posible hallazgo.» notice. After this task the mock answers an anonymous claim `401` and sends the badge to nobody but the owner, so both would fail in web CI. The claimant signs in first the way `@LINK-001` (above) and `found.spec.ts` do — the `profile` fixture's email-code sign-in — as a newcomer (`pedro.ruiz@correo.co`, the account `publish-found.spec.ts` creates the same way), and the last assertion becomes the badge's absence: the claimant's feedback is the claim sheet's own success state, which `casePage.claimRecovery` already waits for («Ya le avisamos a su familia.»).

In `W/web/e2e/helper-actions.spec.ts`:

(a) in the `@HELP-002` test, replace

```ts
  async ({ casePage }) => {
    await test.step('nobody has said they have Milo', async () => {
```

with

```ts
  async ({ casePage, profile }) => {
    await test.step('«Lo tengo» needs an account: the helper signs in first (decision #75)', async () => {
      await profile.open()
      await profile.signIn.withEmailCode('pedro.ruiz@correo.co')
      await expect(profile.email('pedro.ruiz@correo.co')).toBeVisible()
    })

    await test.step('nobody has said they have Milo', async () => {
```

and replace

```ts
    await test.step('the claim exists whatever happens in WhatsApp: the page says so', async () => {
      await expect(casePage.possibleFind).toBeVisible()
    })
```

with

```ts
    await test.step('the claim exists whatever happens in WhatsApp; the badge is the family’s only', async () => {
      // The claim sheet's «Ya le avisamos a su familia.» (checked inside claimRecovery) is the claimant's
      // feedback; «Posible hallazgo» never reaches anyone but the owner (decision #76).
      await expect(casePage.possibleFind).toHaveCount(0)
    })
```

(b) in the `@HELP-005` test, replace

```ts
  async ({ casePage }) => {
    await test.step('Kira’s notice was archived: no sighting, but «La tengo» is there', async () => {
```

with

```ts
  async ({ casePage, profile }) => {
    await test.step('«Lo tengo» needs an account: the helper signs in first (decision #75)', async () => {
      await profile.open()
      await profile.signIn.withEmailCode('pedro.ruiz@correo.co')
      await expect(profile.email('pedro.ruiz@correo.co')).toBeVisible()
    })

    await test.step('Kira’s notice was archived: no sighting, but «La tengo» is there', async () => {
```

and replace

```ts
      await expect(casePage.text('Este aviso fue archivado.')).toHaveCount(0)
      await expect(casePage.possibleFind).toBeVisible()
```

with

```ts
      await expect(casePage.text('Este aviso fue archivado.')).toHaveCount(0)
      // Active again for everyone; the badge stays the owner's (decision #76).
      await expect(casePage.possibleFind).toHaveCount(0)
```

- [ ] **Step 6: Regenerate the contract and run the client's checks**

Run, in `W/web`:

```bash
$P openapi 2>&1 | tail -3
$P exec biome check --write src/contracts/case.ts src/contracts/feed.ts src/contracts/endpoints/helpers.ts src/contracts/endpoints/lost.ts \
  src/domain/lost/actions.ts src/mocks/serialize.ts src/mocks/api/reads.ts src/mocks/fixtures.ts src/mocks/api/helpers.ts \
  src/mocks/backend.test.ts src/features/lost/LostCasePage.test.tsx e2e/lost-case.spec.ts e2e/helper-actions.spec.ts
$P typecheck 2>&1 | tail -5
$P test 2>&1 | tail -8
$P lint 2>&1 | tail -3
```

Expected: `openapi` rewrites `docs/eng/openapi.json`; `typecheck` prints no errors; `test` passes (the new `«Lo tengo»` describe included; the file count equals Step 1's plus none new); `lint` clean.

Then run the three changed e2e specs against the mock, as web CI does (`.github/workflows/web.yml` runs the `e2e` script, `playwright test`, whose web server builds and serves the app with `VITE_API_MOCK=true`). Locally the config drives the installed Google Chrome (`channel: 'chrome'`); the web server runs `pnpm exec vite …`, so `pnpm` must be on the PATH it inherits — `npx --yes pnpm@10.27.0` puts it there when `pnpm` is not installed:

Run: `cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1/web && if command -v pnpm >/dev/null 2>&1; then P=pnpm; else P="npx --yes pnpm@10.27.0"; fi && $P e2e --grep "@HELP-002|@HELP-005|@LINK-001" 2>&1 | tail -15`
Expected: the list reporter prints one `✓` line per test — `[mobile] › helper-actions.spec.ts … @HELP-002`, `[mobile] › helper-actions.spec.ts … @HELP-005`, `[mobile] › lost-case.spec.ts … @LINK-001` — and ends with `3 passed`. If Chrome is not installed, run `$P exec playwright install chromium` and repeat with `CI=1` in front (CI uses Playwright's Chromium). Record the output in the report.

Then check the regenerated document says what the backend will answer:

Run: `python3 -I -c "import json;d=json.load(open('/Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1/docs/eng/openapi.json'));o=d['paths']['/cases/{code}/recovery-claims']['post'];print(o['security'],sorted(o['responses']));print(d['components']['schemas']['LostCase']['properties']['open_claim_count']);print(d['paths']['/cases/{code}/reopen']['post']['responses']['409']['description'])"`
Expected: `[{'session': []}] ['201', '401', '403', '404', '409', '410', '422', '429', '500']`, an `anyOf` with `{"type": "null"}`, and a 409 description naming both `invalid_transition` and `active_case_exists`.

- [ ] **Step 7: The backend still conforms**

Run: `[mvn] test -Dtest='ContractCoverageTest,RequiredFieldsTest,ContractValidatorTest,CaseEndpointTest,FeedEndpointTest,LostParityTest,CaseLifecycleTest' 2>&1 | tail -10`
Expected: PASS (the backend still answers `0` and `false`, which the widened schema accepts; `claimRecovery` is not implemented yet, so the coverage test does not call it).

- [ ] **Step 8: Commit (web/ and the regenerated document only)**

Run: `git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 status --porcelain` — Expected: only the 13 `web/` files above and `docs/eng/openapi.json` modified (no `node_modules`, no `dist-e2e*`, no `test-results/`, no lockfile change). If the lockfile changed, `git checkout -- web/pnpm-lock.yaml` (Step 1 used `--frozen-lockfile`, so it must not).

```bash
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 add \
  web/src/contracts/case.ts web/src/contracts/feed.ts web/src/contracts/endpoints/helpers.ts web/src/contracts/endpoints/lost.ts \
  web/src/domain/lost/actions.ts web/src/mocks/serialize.ts web/src/mocks/api/reads.ts web/src/mocks/fixtures.ts \
  web/src/mocks/api/helpers.ts web/src/mocks/backend.test.ts web/src/features/lost/LostCasePage.test.tsx \
  web/e2e/lost-case.spec.ts web/e2e/helper-actions.spec.ts docs/eng/openapi.json
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 commit -m "feat: contract — owner-only claim badge, «Lo tengo» needs a session, active_case_exists on reopen and claims"
```

---
### Task 9: «Lo tengo» — `POST /cases/{code}/recovery-claims`

A signed-in helper says they have the animal (spec §4.9). One open claim per person per case is enforced by `recovery_claim_one_open_per_claimant` with ONE statement, `INSERT … SELECT … FROM lost_case WHERE status = 'active' ON CONFLICT (case_code, claimant_person_id) WHERE status = 'open' DO UPDATE`: a repeat by the same person while their claim is open (stale included) refreshes it — the repeat's phone, photos, point and `from_sighting_id`, and `last_active_at = now` — and returns its id, so a person still holding the dog whose owner never answered can come back with a new number and the claim counts again. Because the statement only writes while the case is active, a repeat on a case that is not active answers the case's refusal (`invalid_transition`, or `active_case_exists` when the pet has another active case), never the old claim. On an expired case inside the window the reactivation (the reopen `UPDATE` without the owner guard) and the write run in one transaction. `from_sighting_id` is a link, never a refusal: an ineligible one (another case, older than 24 h, not the caller's, not visible, unknown, not a UUID — the contract types it as a plain string) is dropped and the claim is stored without it. The answer carries the owner's WhatsApp link with the prefilled text only under the public-contact rule. No rate limit, notification, check-in or outbox row.

**Files:**
- Create: `B/src/main/java/co/scuby/cases/RecoveryClaimRequest.java`, `ClaimCreatedView.java`, `WhatsappLinks.java`, `RecoveryClaimQueries.java`, `RecoveryClaimService.java`, `RecoveryClaimController.java`
- Modify: `B/src/test/java/co/scuby/support/CaseFixtures.java` (add `claim`)
- Modify: `CasesSecurityRules`, `StatementCeilings`
- Test: `B/src/test/java/co/scuby/cases/WhatsappLinksTest.java`, `RecoveryClaimTest.java`, `RecoveryClaimPrecedenceTest.java`, `RecoveryClaimRaceTest.java`

**Interfaces:**
- Consumes: the regenerated contract (Task 8); `ClaimDerivation`, `LostLifecycleDerivation` (Task 2); `LifecycleQueries.reopen/load/activeCodeFor/ACTIVE_PER_PET`, `OwnerAccess`, `CaseErrors`, `CaseAccessPolicy.isOwner`, `UniqueViolation`, `Contention`, `CaseFixtures.close/lostCaseForPet/petOf` (Task 4); `BodyValidation`, `LostCaseDerivation.mine` (Task 7); `Photos.uploaded` (Task 5); `PhoneNumbers.requireMobile(String, String)`; `PhotoAttachments.requireAttachable`; `LostCaseQueries.isPurged`; `PublicTextDerivation.whatsappUrl(String)`; `PublishBodies.withPetId(String, String)`.
- Produces:
  - `record RecoveryClaimRequest(@JsonProperty(required = true) @Nullable String phone, @Nullable @Size(max = 5) List<@NotBlank String> photoUrls, @Nullable String fromSightingId)` with `List<String> photos()`.
  - `record ClaimCreatedView(String id, @Nullable String whatsappUrl)` — the contract's `Claim`.
  - `WhatsappLinks.withText(String e164, String text) → String`.
  - `RecoveryClaimQueries`: `record ClaimCase(String code, UUID createdBy, UUID petId, @Nullable String petName, String status, @Nullable Instant resolvedAt, ClaimDerivation.ContactFlags flags, @Nullable String publicPhone)`; `record PinForClaim(ClaimDerivation.SightingLink link, GeoPoint point)`; `Optional<ClaimCase> caseForClaim(String code)`; `Optional<PinForClaim> pin(String code, UUID id)`; `Optional<UUID> upsertIfActive(String code, UUID claimant, String phone, List<String> photos, @Nullable GeoPoint point, @Nullable UUID fromSighting, Instant now)` (the new claim's id, or the refreshed open claim's id; empty when the case is not active).
  - `RecoveryClaimService.claim(String rawCode, Account account, Caller caller, RecoveryClaimRequest body) → ClaimCreatedView`.
  - `CaseFixtures.claim(String code, UUID claimant, String phone, Instant createdAt, String status) → UUID` (last_active_at = created_at; answered_at = created + 1 h unless open) and `CaseFixtures.claim(String code, UUID claimant, String phone, Instant createdAt, Instant lastActiveAt, String status) → UUID` (a claim a repeat refreshed).
  - Ceiling `POST /cases/{code}/recovery-claims` 8.

- [ ] **Step 1: Write the failing tests**

Add to `B/src/test/java/co/scuby/support/CaseFixtures.java` (import `static co.scuby.db.generated.Tables.RECOVERY_CLAIM`):

```java
    /** A recovery claim as «Lo tengo» stores it, never repeated (last active when made); answered an hour after it was made unless it is open. */
    public UUID claim(String code, UUID claimant, String phone, Instant createdAt, String status) {
        return claim(code, claimant, phone, createdAt, createdAt, status);
    }

    /** As above, with the claimant's last «Lo tengo» on it at {@code lastActiveAt} (a repeat refreshed it). */
    public UUID claim(String code, UUID claimant, String phone, Instant createdAt, Instant lastActiveAt, String status) {
        UUID id = UUID.randomUUID();
        db.insertInto(RECOVERY_CLAIM)
          .set(RECOVERY_CLAIM.ID, id).set(RECOVERY_CLAIM.CASE_CODE, code).set(RECOVERY_CLAIM.CLAIMANT_PERSON_ID, claimant)
          .set(RECOVERY_CLAIM.PHONE, phone).set(RECOVERY_CLAIM.STATUS, status)
          .set(RECOVERY_CLAIM.CREATED_AT, createdAt.atOffset(ZoneOffset.UTC))
          .set(RECOVERY_CLAIM.LAST_ACTIVE_AT, lastActiveAt.atOffset(ZoneOffset.UTC))
          .set(RECOVERY_CLAIM.ANSWERED_AT, "open".equals(status) ? null : createdAt.plusSeconds(3600).atOffset(ZoneOffset.UTC))
          .execute();
        return id;
    }
```

`B/src/test/java/co/scuby/cases/WhatsappLinksTest.java`:

```java
package co.scuby.cases;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class WhatsappLinksTest {

    @Test
    void theNumberWithoutItsPlusAndTheTextPercentEncodedWithSpacesAsPercent20() {
        assertThat(WhatsappLinks.withText("+573114829017", ClaimDerivation.whatsappText("Luna", "7K3PQ")))
                .isEqualTo("https://wa.me/573114829017?text=Hola%2C%20vi%20tu%20aviso%20de%20Luna%20en%20Scuby%20%287K3PQ%29%20y%20creo%20que%20lo%20tengo.");
    }

    @Test
    void aLiteralPlusAndAccentsSurviveTheEncoding() {
        assertThat(WhatsappLinks.withText("+573114829017", "Ñoño + 1")).isEqualTo("https://wa.me/573114829017?text=%C3%91o%C3%B1o%20%2B%201");
    }
}
```

`B/src/test/java/co/scuby/cases/RecoveryClaimTest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.cache.ClearableCache;
import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.flags.FeatureFlags;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.Photos;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.OUTBOX_EVENTS;
import static co.scuby.db.generated.Tables.RECOVERY_CLAIM;
import static co.scuby.db.generated.Tables.SIGHTING;
import static org.assertj.core.api.Assertions.assertThat;

/** «Lo tengo» (docs/product/04 · recovery_claim; spec §4.9). */
@IntegrationTest
class RecoveryClaimTest {

    static final Instant NOW = MutableClock.START;
    static final String PATH = "/cases/{code}/recovery-claims";
    static final String LUNA_URL = "https://wa.me/573114829017?text=Hola%2C%20vi%20tu%20aviso%20de%20Luna%20en%20Scuby%20%287K3PQ%29%20y%20creo%20que%20lo%20tengo.";

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired MutableClock clock;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient owner;
    ApiClient helper;
    UUID carolina;
    UUID andres;
    String helperDevice;

    @BeforeEach
    void setUp() {
        owner = clients.newBrowser();
        carolina = accounts.signIn(owner, "carolina@correo.co");
        helper = clients.newBrowser();
        andres = accounts.signIn(helper, "andres@correo.co");
        helper.get("/config");
        helperDevice = Hashing.sha256Hex(helper.cookie("device").orElseThrow());
        cases.luna(carolina);
    }

    private ApiResponse claim(ApiClient as, String code, String json) {
        return as.post(PATH, json, code);
    }

    private ApiResponse claim(String extra) {
        return claim(helper, "7K3PQ", "{\"phone\":\"+573001112233\"" + extra + "}");
    }

    private Record theClaim() {
        return db.selectFrom(RECOVERY_CLAIM).fetchOne();
    }

    private Record luna() {
        return db.selectFrom(LOST_CASE).where(LOST_CASE.CODE.eq("7K3PQ")).fetchOne();
    }

    private ApiResponse cold(java.util.function.Supplier<ApiResponse> call) {
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        return call.get();
    }

    @Test
    void aSignedInHelperClaimsAndGetsTheOwnersWhatsappWithThePrefilledText() {
        ApiResponse r = claim("");
        assertThat(r.status()).isEqualTo(201);
        assertThat(r.str("/whatsapp_url")).isEqualTo(LUNA_URL);
        Record c = theClaim();
        assertThat(r.str("/id")).isEqualTo(c.get(RECOVERY_CLAIM.ID).toString());
        assertThat(c.get(RECOVERY_CLAIM.CASE_CODE)).isEqualTo("7K3PQ");
        assertThat(c.get(RECOVERY_CLAIM.CLAIMANT_PERSON_ID)).isEqualTo(andres);
        assertThat(c.get(RECOVERY_CLAIM.PHONE)).isEqualTo("+573001112233");
        assertThat(c.get(RECOVERY_CLAIM.STATUS)).isEqualTo("open");
        assertThat(c.get(RECOVERY_CLAIM.CREATED_AT).toInstant()).isEqualTo(NOW);
        assertThat(c.get(RECOVERY_CLAIM.LAST_ACTIVE_AT).toInstant()).isEqualTo(NOW);
        assertThat(c.get(RECOVERY_CLAIM.ANSWERED_AT)).isNull();
        assertThat(c.get(RECOVERY_CLAIM.LAT)).isNull();
        assertThat(c.get(RECOVERY_CLAIM.PHOTO_URLS)).isEmpty();
        assertThat(luna().get(LOST_CASE.STATUS)).isEqualTo("active");
        assertThat(db.fetchCount(OUTBOX_EVENTS)).as("L1 writes no outbox row").isZero();
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource({"expose_whatsapp = false", "phone_has_whatsapp = false", "contact_phone_verified = false", "in_app_only = true"})
    void withoutThePublicContactRuleThereIsNoWhatsappUrlButTheClaimIsStored(String assignment) {
        db.execute("UPDATE scuby.lost_case SET " + assignment + " WHERE code = '7K3PQ'");
        ApiResponse r = claim("");
        assertThat(r.status()).isEqualTo(201);
        assertThat(r.isNull("/whatsapp_url")).isTrue();
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isEqualTo(1);
    }

    @Test
    void theOwnerCannotClaimTheirOwnCase() {
        ApiResponse r = claim(owner, "7K3PQ", "{\"phone\":\"+573001112233\"}");
        assertThat(r.status()).isEqualTo(403);
        assertThat(r.errorCode()).isEqualTo("forbidden");
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isZero();
    }

    @Test
    void aRepeatRefreshesTheOpenClaimWithTheNewPhonePhotosAndPin() {
        String first = claim("").str("/id");
        clock.advance(Duration.ofHours(1));
        UUID pin = cases.sighting("7K3PQ", new co.scuby.platform.db.GeoPoint(6.25, -75.59), NOW, NOW, andres, "9".repeat(64), null, "visible");
        String photo = Photos.uploaded(helper, "claim", "repeat-photo");
        ApiResponse again = claim(helper, "7K3PQ", "{\"phone\":\"+573009998877\",\"photo_urls\":[\"" + photo + "\"],\"from_sighting_id\":\"" + pin + "\"}");
        assertThat(again.status()).as("the contract's only success status for claimRecovery").isEqualTo(201);
        assertThat(again.str("/id")).isEqualTo(first);
        assertThat(again.str("/whatsapp_url")).isEqualTo(LUNA_URL);
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isEqualTo(1);
        Record c = theClaim();
        assertThat(c.get(RECOVERY_CLAIM.PHONE)).as("the claimant's current number").isEqualTo("+573009998877");
        assertThat(List.of(c.get(RECOVERY_CLAIM.PHOTO_URLS))).containsExactly(photo);
        assertThat(c.get(RECOVERY_CLAIM.FROM_SIGHTING_ID)).isEqualTo(pin);
        assertThat(c.get(RECOVERY_CLAIM.LAT)).isEqualTo(6.25);
        assertThat(c.get(RECOVERY_CLAIM.LAST_ACTIVE_AT).toInstant()).isEqualTo(NOW.plus(Duration.ofHours(1)));
        assertThat(c.get(RECOVERY_CLAIM.CREATED_AT).toInstant()).as("the claim keeps its birth").isEqualTo(NOW);
        assertThat(c.get(RECOVERY_CLAIM.STATUS)).isEqualTo("open");
    }

    @Test
    void aRepeatTakesTheRepeatsValuesSoAPlainRepeatClearsTheEarlierPhotosAndLink() {
        UUID pin = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, NOW.minusSeconds(600), NOW.minusSeconds(600), andres, "9".repeat(64), null, "visible");
        String photo = Photos.uploaded(helper, "claim", "first-photo");
        claim(",\"photo_urls\":[\"" + photo + "\"],\"from_sighting_id\":\"" + pin + "\"");
        assertThat(claim("").status()).isEqualTo(201);
        Record c = theClaim();
        assertThat(c.get(RECOVERY_CLAIM.PHOTO_URLS)).isEmpty();
        assertThat(c.get(RECOVERY_CLAIM.FROM_SIGHTING_ID)).isNull();
        assertThat(c.get(RECOVERY_CLAIM.LAT)).isNull();
    }

    @Test
    void aRepeatMakesAStaleClaimFreshAgainUnderTheSameId() {
        UUID stale = cases.claim("7K3PQ", andres, "+573001112233", NOW.minus(Duration.ofDays(8)), "open");
        ApiResponse r = claim(helper, "7K3PQ", "{\"phone\":\"+573009998877\"}");
        assertThat(r.status()).isEqualTo(201);
        assertThat(r.str("/id")).isEqualTo(stale.toString());
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isEqualTo(1);
        assertThat(theClaim().get(RECOVERY_CLAIM.LAST_ACTIVE_AT).toInstant()).isEqualTo(NOW);
        assertThat(theClaim().get(RECOVERY_CLAIM.PHONE)).isEqualTo("+573009998877");
        assertThat(ClaimDerivation.isStale("open", theClaim().get(RECOVERY_CLAIM.LAST_ACTIVE_AT).toInstant(), NOW)).isFalse();
    }

    @Test
    void aRepeatOnAnExpiredCaseInsideTheWindowReactivatesItAndRefreshesTheClaim() {
        UUID stale = cases.claim("7K3PQ", andres, "+573001112233", NOW.minus(Duration.ofDays(9)), "open");
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(2)));
        ApiResponse r = claim("");
        assertThat(r.status()).isEqualTo(201);
        assertThat(r.str("/id")).isEqualTo(stale.toString());
        assertThat(luna().get(LOST_CASE.STATUS)).isEqualTo("active");
        assertThat(theClaim().get(RECOVERY_CLAIM.LAST_ACTIVE_AT).toInstant()).isEqualTo(NOW);
    }

    /**
     * The claimant comes back from the old poster, but the case expired and the family published a new case for the pet:
     * the repeat answers active_case_exists naming the live case (where the family is looking), never the old claim, and
     * hands out no WhatsApp link. The old claim is left exactly as it was.
     */
    @Test
    void aRepeatOnAnExpiredCaseWhosePetHasAnotherActiveCaseIsActiveCaseExistsNeverTheOldClaim() {
        UUID old = cases.claim("7K3PQ", andres, "+573001112233", NOW.minus(Duration.ofDays(5)), "open");
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(3)));
        cases.lostCaseForPet(carolina, cases.petOf("7K3PQ"), "NEW22", "active", NOW.minus(Duration.ofDays(1)));
        ApiResponse r = claim(helper, "7K3PQ", "{\"phone\":\"+573009998877\"}");
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("active_case_exists");
        assertThat(r.str("/error/details/case_code")).isEqualTo("NEW22");
        assertThat(r.body()).doesNotContain(old.toString()).doesNotContain("wa.me");
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isEqualTo(1);
        assertThat(theClaim().get(RECOVERY_CLAIM.PHONE)).isEqualTo("+573001112233");
        assertThat(theClaim().get(RECOVERY_CLAIM.LAST_ACTIVE_AT).toInstant()).isEqualTo(NOW.minus(Duration.ofDays(5)));
        assertThat(luna().get(LOST_CASE.STATUS)).isEqualTo("expired");
    }

    @Test
    void aRepeatOnAReunitedCaseIsInvalidTransitionNeverTheOldClaim() {
        UUID old = cases.claim("7K3PQ", andres, "+573001112233", NOW.minus(Duration.ofDays(1)), "open");
        cases.close("7K3PQ", "reunited", NOW.minusSeconds(60));
        ApiResponse r = claim("");
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("invalid_transition");
        assertThat(r.body()).doesNotContain(old.toString()).doesNotContain("wa.me");
        assertThat(theClaim().get(RECOVERY_CLAIM.LAST_ACTIVE_AT).toInstant()).isEqualTo(NOW.minus(Duration.ofDays(1)));
    }

    @Test
    void afterTheOwnerAnsweredANewClaimIsANewRow() {
        UUID dismissed = cases.claim("7K3PQ", andres, "+573001112233", NOW.minus(Duration.ofDays(1)), "dismissed");
        String id = claim("").str("/id");
        assertThat(id).isNotEqualTo(dismissed.toString());
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isEqualTo(2);
    }

    @Test
    void anotherPersonsClaimIsTheirOwnRow() {
        claim("");
        ApiClient other = clients.newBrowser();
        accounts.signIn(other, "laura@correo.co");
        assertThat(claim(other, "7K3PQ", "{\"phone\":\"+573001112244\"}").status()).isEqualTo(201);
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isEqualTo(2);
    }

    @Test
    void anExpiredCaseInsideTheWindowIsReactivatedAndClaimed() {
        Instant published = luna().get(LOST_CASE.PUBLISHED_AT).toInstant();
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(3)));
        ApiResponse r = claim("");
        assertThat(r.status()).isEqualTo(201);
        assertThat(r.str("/whatsapp_url")).as("evaluated after the reactivation").isEqualTo(LUNA_URL);
        Record c = luna();
        assertThat(c.get(LOST_CASE.STATUS)).isEqualTo("active");
        assertThat(c.get(LOST_CASE.RESOLVED_AT)).isNull();
        assertThat(c.get(LOST_CASE.RESOLUTION)).isNull();
        assertThat(c.get(LOST_CASE.PUBLISHED_AT).toInstant()).isEqualTo(published);
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isEqualTo(1);
    }

    @Test
    void theWindowIsThirtyDaysInclusiveAndOneMillisecondMoreIsInvalidTransition() {
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(30)));
        assertThat(claim("").status()).isEqualTo(201);
        cases.lostCase(carolina, "OLD22", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "active", NOW.minus(Duration.ofDays(60)));
        cases.close("OLD22", "expired", NOW.minus(Duration.ofDays(30)).minusMillis(1));
        ApiResponse late = claim(helper, "OLD22", "{\"phone\":\"+573001112233\"}");
        assertThat(late.status()).isEqualTo(409);
        assertThat(late.errorCode()).isEqualTo("invalid_transition");
        assertThat(db.fetchCount(RECOVERY_CLAIM, RECOVERY_CLAIM.CASE_CODE.eq("OLD22"))).isZero();
    }

    @ParameterizedTest
    @CsvSource({"reunited", "cancelled"})
    void aReunitedOrCancelledCaseTakesNoClaim(String status) {
        cases.close("7K3PQ", status, NOW.minus(Duration.ofDays(1)));
        ApiResponse r = claim("");
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("invalid_transition");
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isZero();
    }

    @Test
    void aReactivationThatWouldMakeASecondActiveCaseIsActiveCaseExists() {
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(3)));
        cases.lostCaseForPet(carolina, cases.petOf("7K3PQ"), "NEW22", "active", NOW.minus(Duration.ofDays(1)));
        ApiResponse r = claim("");
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("active_case_exists");
        assertThat(r.str("/error/details/case_code")).isEqualTo("NEW22");
        assertThat(luna().get(LOST_CASE.STATUS)).isEqualTo("expired");
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isZero();
    }

    @Test
    void fromTheCallersOwnPinTheClaimCopiesItsPointNeverItsPhotos() {
        UUID pin = cases.sighting("7K3PQ", new co.scuby.platform.db.GeoPoint(6.25, -75.59), NOW.minusSeconds(3600), NOW.minusSeconds(3600),
                andres, "9".repeat(64), null, "visible");
        db.update(SIGHTING).set(SIGHTING.PHOTO_URLS, new String[] {"http://localhost/dev-media/" + "b".repeat(64) + ".jpg"})
          .where(SIGHTING.ID.eq(pin)).execute();
        assertThat(claim(",\"from_sighting_id\":\"" + pin + "\"").status()).isEqualTo(201);
        Record c = theClaim();
        assertThat(c.get(RECOVERY_CLAIM.FROM_SIGHTING_ID)).isEqualTo(pin);
        assertThat(c.get(RECOVERY_CLAIM.LAT)).isEqualTo(6.25);
        assertThat(c.get(RECOVERY_CLAIM.LNG)).isEqualTo(-75.59);
        assertThat(c.get(RECOVERY_CLAIM.PHOTO_URLS)).isEmpty();
    }

    @Test
    void anAnonymousPinFromTheCallersBrowserStaysTheirsAfterTheySignIn() {
        // The passer-by reported «Lo vi» without an account, caught the dog, and signed in to say «Lo tengo».
        UUID pin = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, NOW.minusSeconds(600), NOW.minusSeconds(600), null, helperDevice, null, "visible");
        assertThat(claim(",\"from_sighting_id\":\"" + pin + "\"").status()).isEqualTo(201);
        assertThat(theClaim().get(RECOVERY_CLAIM.FROM_SIGHTING_ID)).isEqualTo(pin);
        assertThat(theClaim().get(RECOVERY_CLAIM.LAT)).isEqualTo(CaseFixtures.MEDELLIN.lat());
    }

    /** The link is attribution, never a reason to lose a claim: an ineligible pin is dropped and the claim is stored without it. */
    @ParameterizedTest(name = "{0}")
    @CsvSource({
            // label,                                  reporter, sameDevice, status,              ageMinutes, onThisCase
            "'an anonymous pin from another device',   NONE,     false,      visible,             60,         true",
            "'another person''s pin from this device', OTHER,    true,       visible,             60,         true",
            "'hidden by the owner',                    HELPER,   false,      hidden_by_owner,     60,         true",
            "'deleted by its reporter',                HELPER,   false,      deleted_by_reporter, 5,          true",
            "'exactly 24 h old',                       HELPER,   false,      visible,             1440,       true",
            "'on another case',                        HELPER,   false,      visible,             60,         false",
    })
    void aPinThatIsNotTheCallersRecentVisibleOneHereIsIgnoredAndTheClaimIsStored(String label, String reporter, boolean sameDevice,
                                                                                  String status, int ageMinutes, boolean onThisCase) {
        cases.lostCase(carolina, "OTH22", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "active", NOW.minusSeconds(7200));
        Instant at = NOW.minus(Duration.ofMinutes(ageMinutes));
        UUID reporterPerson = switch (reporter) {
            case "HELPER" -> andres;
            case "OTHER" -> accounts.person("laura@correo.co");
            default -> null;
        };
        UUID pin = cases.sighting(onThisCase ? "7K3PQ" : "OTH22", CaseFixtures.MEDELLIN, at, at, reporterPerson,
                sameDevice ? helperDevice : "8".repeat(64), null, status);
        ApiResponse r = claim(",\"from_sighting_id\":\"" + pin + "\"");
        assertThat(r.status()).as(label).isEqualTo(201);
        assertThat(r.str("/whatsapp_url")).as(label).isEqualTo(LUNA_URL);
        Record c = theClaim();
        assertThat(c.get(RECOVERY_CLAIM.FROM_SIGHTING_ID)).as(label).isNull();
        assertThat(c.get(RECOVERY_CLAIM.LAT)).as(label).isNull();
        assertThat(c.get(RECOVERY_CLAIM.LNG)).as(label).isNull();
    }

    @ParameterizedTest
    @CsvSource({"not-a-uuid", "00000000-0000-0000-0000-000000000099"})
    void anUnknownOrNonUuidFromSightingIdIsIgnored(String id) {
        // The contract types from_sighting_id as a plain string, so a non-UUID is an unknown pin, not a malformed field.
        ApiResponse r = claim(",\"from_sighting_id\":\"" + id + "\"");
        assertThat(r.status()).isEqualTo(201);
        assertThat(theClaim().get(RECOVERY_CLAIM.FROM_SIGHTING_ID)).isNull();
    }

    @Test
    void photosMustBeTheCallersClaimUploadsAndAtMostFive() {
        String mine = Photos.uploaded(helper, "claim", "claim-photo-1");
        assertThat(claim(",\"photo_urls\":[\"" + mine + "\"]").status()).isEqualTo(201);
        assertThat(List.of(theClaim().get(RECOVERY_CLAIM.PHOTO_URLS))).containsExactly(mine);
        db.deleteFrom(RECOVERY_CLAIM).execute();
        String forASighting = Photos.uploaded(helper, "sighting", "claim-photo-2");
        assertThat(claim(",\"photo_urls\":[\"" + forASighting + "\"]").json().at("/error/fields").has("photo_urls")).isTrue();
        String six = String.join(",", java.util.Collections.nCopies(6, "\"" + mine + "\""));
        assertThat(claim(",\"photo_urls\":[" + six + "]").json().at("/error/fields").has("photo_urls")).isTrue();
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isZero();
    }

    @ParameterizedTest(name = "phone {0}")
    @CsvSource(nullValues = "null", value = {"null", "+5716012345", "3001112233", "+999123"})
    void thePhoneIsRequiredAndASupportedMobile(String phone) {
        ApiResponse r = claim(helper, "7K3PQ", "{\"phone\":" + (phone == null ? "null" : "\"" + phone + "\"") + "}");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("phone")).isTrue();
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isZero();
    }

    @Test
    void anAbsentPhoneIsAJacksonErrorBeforeAnyLookup() {
        ApiResponse r = claim(helper, "ZZZZZ", "{}");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("phone")).isTrue();
    }

    @Test
    void aPurgedCodeIsGoneAndAnUnknownOneNotFound() {
        cases.purge("GONE5");
        assertThat(claim(helper, "GONE5", "{\"phone\":\"+573001112233\"}").errorCode()).isEqualTo("gone");
        assertThat(claim(helper, "ZZZZZ", "{\"phone\":\"+573001112233\"}").errorCode()).isEqualTo("not_found");
        assertThat(claim(helper, "bad!", "{\"phone\":\"+573001112233\"}").errorCode()).isEqualTo("not_found");
    }

    @Test
    void withoutASessionItIsUnauthorizedAndNothingIsStored() {
        ApiResponse r = claim(clients.newBrowser(), "7K3PQ", "{\"phone\":\"+573001112233\"}");
        assertThat(r.status()).isEqualTo(401);
        assertThat(r.errorCode()).isEqualTo("unauthorized");
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isZero();
    }

    @Test
    void theHappyPathIsFourStatementsARepeatTooAndTheWorstPathEight() {
        ApiResponse plain = cold(() -> claim(""));
        assertThat(plain.statements()).as("%s", plain.statements()).hasSize(4);   // session, pre-read, supported_countries, upsert
        ApiResponse repeat = cold(() -> claim(""));
        assertThat(repeat.statements()).as("the refresh is the same one statement: %s", repeat.statements()).hasSize(4);
        db.deleteFrom(RECOVERY_CLAIM).execute();
        // Worst: expired inside the window, the pet has another active case, a linked pin and a photo.
        cases.close("7K3PQ", "expired", NOW.minus(Duration.ofDays(3)));
        cases.lostCaseForPet(carolina, cases.petOf("7K3PQ"), "NEW22", "active", NOW.minus(Duration.ofDays(1)));
        UUID pin = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, NOW.minusSeconds(600), NOW.minusSeconds(600), andres, "9".repeat(64), null, "visible");
        String photo = Photos.uploaded(helper, "claim", "worst-path");
        ApiResponse worst = cold(() -> claim(",\"from_sighting_id\":\"" + pin + "\",\"photo_urls\":[\"" + photo + "\"]"));
        assertThat(worst.errorCode()).isEqualTo("active_case_exists");
        // session, pre-read, supported_countries, pin read, upload lookup, reactivation (0 rows), upsert (empty), re-read
        assertThat(worst.statements()).as("%s", worst.statements()).hasSize(8);
    }
}
```

`B/src/test/java/co/scuby/cases/RecoveryClaimPrecedenceTest.java`:

```java
package co.scuby.cases;

import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** session → not_found / gone → forbidden (the owner) → body (phone, photos; from_sighting_id is never an error) → status (spec §4.9, assumption 3). */
@IntegrationTest
class RecoveryClaimPrecedenceTest {

    static final String PATH = "/cases/{code}/recovery-claims";

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;

    ApiClient owner;
    ApiClient helper;
    UUID carolina;

    @BeforeEach
    void setUp() {
        owner = clients.newBrowser();
        carolina = accounts.signIn(owner, "carolina@correo.co");
        helper = clients.newBrowser();
        accounts.signIn(helper, "andres@correo.co");
        cases.luna(carolina);
        cases.purge("GONE5");
    }

    @Test
    void unauthorizedBeatsAnUnreadableBody() {
        assertThat(clients.newBrowser().post(PATH, "{", "ZZZZZ").errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void notFoundAndGoneBeatForbiddenAndABadBody() {
        assertThat(owner.post(PATH, "{\"phone\":null}", "ZZZZZ").errorCode()).isEqualTo("not_found");
        assertThat(helper.post(PATH, "{\"phone\":null}", "GONE5").errorCode()).isEqualTo("gone");
    }

    @Test
    void forbiddenBeatsABadBody() {
        assertThat(owner.post(PATH, "{\"phone\":null}", "7K3PQ").errorCode()).isEqualTo("forbidden");
    }

    @Test
    void aBadBodyBeatsAClosedCase() {
        cases.close("7K3PQ", "reunited", MutableClock.START.minus(Duration.ofDays(1)));
        assertThat(helper.post(PATH, "{\"phone\":\"+5716012345\"}", "7K3PQ").errorCode()).isEqualTo("validation_failed");
    }

    @Test
    void aBadPhoneIsTheOnlyFieldNamedAnIneligibleLinkIsNeverAnError() {
        var r = helper.post(PATH, "{\"phone\":\"+5716012345\",\"from_sighting_id\":\"x\"}", "7K3PQ");
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has("phone")).isTrue();
        assertThat(r.json().at("/error/fields").has("from_sighting_id")).isFalse();
    }

    @Test
    void invalidTransitionBeatsActiveCaseExists() {
        cases.close("7K3PQ", "expired", MutableClock.START.minus(Duration.ofDays(31)));
        cases.lostCaseForPet(carolina, cases.petOf("7K3PQ"), "NEW22", "active", MutableClock.START);
        assertThat(helper.post(PATH, "{\"phone\":\"+573001112233\"}", "7K3PQ").errorCode()).isEqualTo("invalid_transition");
    }
}
```

`B/src/test/java/co/scuby/cases/RecoveryClaimRaceTest.java`:

```java
package co.scuby.cases;

import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.Contention;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.PublishBodies;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import javax.sql.DataSource;
import java.time.Duration;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PERSON;
import static co.scuby.db.generated.Tables.RECOVERY_CLAIM;
import static org.assertj.core.api.Assertions.assertThat;

/** The claim races of spec §7.2: invariants under a barrier or a held row; never a 500. */
@IntegrationTest
class RecoveryClaimRaceTest {

    static final String PATH = "/cases/{code}/recovery-claims";
    static final String BODY = "{\"phone\":\"+573001112233\"}";

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired DataSource dataSource;

    ExecutorService pool = Executors.newFixedThreadPool(4);
    Contention contention;
    ApiClient owner;
    UUID carolina;

    @BeforeEach
    void setUp() {
        contention = new Contention(dataSource, db);
    }

    @AfterEach
    void tearDown() throws Exception {
        contention.close();
        pool.shutdownNow();
    }

    /** A fresh round: Luna, expired two days ago unless {@code active}. */
    private void round(int n, boolean active) {
        testDb.reset();
        owner = clients.newBrowser();
        carolina = accounts.signIn(owner, "carolina" + n + "@correo.co");
        cases.luna(carolina);
        if (!active) cases.close("7K3PQ", "expired", MutableClock.START.minus(Duration.ofDays(2)));
    }

    private ApiClient signedIn(String email) {
        ApiClient c = clients.newBrowser();
        accounts.signIn(c, email);
        return c;
    }

    private ApiClient twinOf(ApiClient browser) {
        ApiClient twin = clients.newBrowser();
        twin.setCookie("__Host-session", browser.cookie("__Host-session").orElseThrow());
        return twin;
    }

    private static Callable<ApiResponse> together(CyclicBarrier barrier, Callable<ApiResponse> call) {
        return () -> { barrier.await(10, TimeUnit.SECONDS); return call.call(); };
    }

    private long activeCasesOf(UUID pet) {
        return db.fetchCount(LOST_CASE, LOST_CASE.PET_ID.eq(pet).and(LOST_CASE.STATUS.eq("active")));
    }

    @Test
    void theSamePersonClaimingTwiceAtOnceGetsOneRowAndItsIdTwice() throws Exception {
        for (int n = 0; n < 8; n++) {
            round(n, true);
            ApiClient a = signedIn("andres" + n + "@correo.co");
            ApiClient b = twinOf(a);
            var barrier = new CyclicBarrier(2);
            Future<ApiResponse> fa = pool.submit(together(barrier, () -> a.post(PATH, BODY, "7K3PQ")));
            Future<ApiResponse> fb = pool.submit(together(barrier, () -> b.post(PATH, "{\"phone\":\"+573009998877\"}", "7K3PQ")));
            ApiResponse ra = fa.get(30, TimeUnit.SECONDS);
            ApiResponse rb = fb.get(30, TimeUnit.SECONDS);
            assertThat(List.of(ra.status(), rb.status())).as("round %d", n).containsOnly(201);
            assertThat(ra.str("/id")).isEqualTo(rb.str("/id"));
            assertThat(db.fetchCount(RECOVERY_CLAIM)).isEqualTo(1);
            assertThat(db.select(RECOVERY_CLAIM.PHONE).from(RECOVERY_CLAIM).fetchOne(RECOVERY_CLAIM.PHONE))
                    .as("the later of the two writes").isIn("+573001112233", "+573009998877");
        }
    }

    /**
     * Deterministic double tap: the first «Lo tengo» is held uncommitted; the second's upsert waits on the first's entry in
     * recovery_claim_one_open_per_claimant, then takes the DO UPDATE branch on the committed row: one row, the same id, the
     * second tap's phone, never a 500.
     */
    @Test
    void aSecondTapThatMeetsTheFirstInFlightRefreshesTheSameRow() throws Exception {
        round(0, true);
        ApiClient helper = clients.newBrowser();
        UUID andres = accounts.signIn(helper, "andres@correo.co");
        UUID first = UUID.randomUUID();
        contention.hold("INSERT INTO scuby.recovery_claim (id, case_code, claimant_person_id, phone, status, created_at, last_active_at) "
                + "VALUES (?, '7K3PQ', ?, '+573001112233', 'open', now(), now())", first, andres);
        Future<ApiResponse> f = pool.submit(() -> helper.post(PATH, "{\"phone\":\"+573009998877\"}", "7K3PQ"));
        contention.awaitWaiters(1);
        contention.commit();
        ApiResponse r = f.get(30, TimeUnit.SECONDS);
        assertThat(r.status()).isEqualTo(201);
        assertThat(r.str("/id")).isEqualTo(first.toString());
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isEqualTo(1);
        assertThat(db.select(RECOVERY_CLAIM.PHONE).from(RECOVERY_CLAIM).fetchOne(RECOVERY_CLAIM.PHONE)).isEqualTo("+573009998877");
    }

    @Test
    void twoClaimantsOnOneExpiredCaseReactivateItOnceAndBothClaimsAreStored() throws Exception {
        for (int n = 0; n < 8; n++) {
            round(n, false);
            ApiClient a = signedIn("andres" + n + "@correo.co");
            ApiClient b = signedIn("laura" + n + "@correo.co");
            var barrier = new CyclicBarrier(2);
            Future<ApiResponse> fa = pool.submit(together(barrier, () -> a.post(PATH, BODY, "7K3PQ")));
            Future<ApiResponse> fb = pool.submit(together(barrier, () -> b.post(PATH, BODY, "7K3PQ")));
            assertThat(List.of(fa.get(30, TimeUnit.SECONDS).status(), fb.get(30, TimeUnit.SECONDS).status())).as("round %d", n).containsOnly(201);
            assertThat(db.fetchCount(RECOVERY_CLAIM)).isEqualTo(2);
            assertThat(db.select(LOST_CASE.STATUS).from(LOST_CASE).where(LOST_CASE.CODE.eq("7K3PQ")).fetchOne(LOST_CASE.STATUS)).isEqualTo("active");
            assertThat(activeCasesOf(cases.petOf("7K3PQ"))).isEqualTo(1);
        }
    }

    @Test
    void aClaimAgainstAPublishForTheSamePetLeavesExactlyOneActiveCase() throws Exception {
        for (int n = 0; n < 6; n++) {
            round(n, false);
            UUID pet = cases.petOf("7K3PQ");
            db.update(PERSON).set(PERSON.PHONE, "+573114829017")
              .set(PERSON.PHONE_VERIFIED_AT, MutableClock.START.atOffset(ZoneOffset.UTC)).where(PERSON.ID.eq(carolina)).execute();
            ApiClient helper = signedIn("andres" + n + "@correo.co");
            var barrier = new CyclicBarrier(2);
            ApiClient publisher = owner;
            Future<ApiResponse> fp = pool.submit(together(barrier, () -> publisher.post("/lost-cases", PublishBodies.withPetId(pet.toString(), null))));
            Future<ApiResponse> fc = pool.submit(together(barrier, () -> helper.post(PATH, BODY, "7K3PQ")));
            ApiResponse published = fp.get(30, TimeUnit.SECONDS);
            ApiResponse claimed = fc.get(30, TimeUnit.SECONDS);
            assertThat(activeCasesOf(pet)).as("round %d", n).isEqualTo(1);
            assertThat(published.status() == 200).as("exactly one of them wins (round %d): %s / %s", n, published.body(), claimed.body())
                    .isNotEqualTo(claimed.status() == 201);
            ApiResponse loser = published.status() == 200 ? claimed : published;
            assertThat(loser.status()).isEqualTo(409);
            assertThat(loser.errorCode()).isEqualTo("active_case_exists");
        }
    }

    @Test
    void aClaimAgainstTheOwnersReopenEndsActiveWithTheClaimStored() throws Exception {
        for (int n = 0; n < 6; n++) {
            round(n, false);
            ApiClient helper = signedIn("andres" + n + "@correo.co");
            ApiClient reopener = owner;
            var barrier = new CyclicBarrier(2);
            Future<ApiResponse> fr = pool.submit(together(barrier, () -> reopener.post("/cases/{code}/reopen", null, "7K3PQ")));
            Future<ApiResponse> fc = pool.submit(together(barrier, () -> helper.post(PATH, BODY, "7K3PQ")));
            ApiResponse reopened = fr.get(30, TimeUnit.SECONDS);
            ApiResponse claimed = fc.get(30, TimeUnit.SECONDS);
            assertThat(claimed.status()).as("round %d: %s", n, claimed.body()).isEqualTo(201);
            // Reopen is idempotent: whoever made the case active first, the owner asked for active and got it.
            assertThat(reopened.status()).as("round %d: %s", n, reopened.body()).isEqualTo(200);
            assertThat(db.fetchCount(RECOVERY_CLAIM)).isEqualTo(1);
            assertThat(db.select(LOST_CASE.STATUS).from(LOST_CASE).where(LOST_CASE.CODE.eq("7K3PQ")).fetchOne(LOST_CASE.STATUS)).isEqualTo("active");
        }
    }

    /** Deterministic: the reactivation waits on an uncommitted publish's index entry, then fails on it: 409, no claim, never a 500. */
    @Test
    void aReactivationThatLosesToAnUncommittedPublishIsActiveCaseExistsAndStoresNoClaim() throws Exception {
        round(0, false);
        UUID pet = cases.petOf("7K3PQ");
        ApiClient helper = signedIn("andres@correo.co");
        contention.hold("INSERT INTO scuby.lost_case (code, pet_id, created_by, status, published_at, contact_phone, contact_phone_verified, "
                + "phone_has_whatsapp, expose_whatsapp, expose_email, in_app_only, last_seen_lat, last_seen_lng, last_seen_public_lat, "
                + "last_seen_public_lng, last_seen_radius_m, last_seen_at) VALUES ('RIVAL', ?, ?, 'active', now(), '+573114829017', true, "
                + "true, true, false, false, 6.2442, -75.5812, 6.2442, -75.580392, 300, now())", pet, carolina);
        Future<ApiResponse> f = pool.submit(() -> helper.post(PATH, BODY, "7K3PQ"));
        contention.awaitWaiters(1);
        contention.commit();
        ApiResponse r = f.get(30, TimeUnit.SECONDS);
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("active_case_exists");
        assertThat(r.str("/error/details/case_code")).isEqualTo("RIVAL");
        assertThat(db.fetchCount(RECOVERY_CLAIM)).isZero();
        assertThat(db.select(LOST_CASE.STATUS).from(LOST_CASE).where(LOST_CASE.CODE.eq("7K3PQ")).fetchOne(LOST_CASE.STATUS)).isEqualTo("expired");
    }
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `[mvn] test -Dtest='WhatsappLinksTest,RecoveryClaimTest,RecoveryClaimPrecedenceTest,RecoveryClaimRaceTest' 2>&1 | tail -15`
Expected: FAIL — `cannot find symbol: class WhatsappLinks`; then `no statement ceiling for POST /cases/{code}/recovery-claims`.

- [ ] **Step 3: Implement**

`B/src/main/java/co/scuby/cases/RecoveryClaimRequest.java`:

```java
package co.scuby.cases;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.jspecify.annotations.Nullable;

import java.util.List;

/**
 * RecoveryClaimRequest (web/src/contracts/actions.ts). phone is required (absent = a Jackson error; null and a number that
 * is not a supported mobile are validation_failed {phone}); photo_urls ≤ 5, stored and not exposed (O36); from_sighting_id
 * links the claim to the caller's own recent visible pin on this case when it is one, and is ignored otherwise (a plain
 * string in the contract: never a field error). Bound without @Valid: the order of spec §4.9 decides.
 */
record RecoveryClaimRequest(@JsonProperty(required = true) @Nullable String phone,
                            @Nullable @Size(max = 5) List<@NotBlank String> photoUrls,
                            @Nullable String fromSightingId) {

    List<String> photos() {
        return photoUrls == null ? List.of() : photoUrls;
    }
}
```

`B/src/main/java/co/scuby/cases/ClaimCreatedView.java`:

```java
package co.scuby.cases;

import org.jspecify.annotations.Nullable;

/** The contract's Claim: the claim's id and, under the public-contact rule, the owner's WhatsApp link with the prefilled text. */
record ClaimCreatedView(String id, @Nullable String whatsappUrl) {}
```

`B/src/main/java/co/scuby/cases/WhatsappLinks.java`:

```java
package co.scuby.cases;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/** A wa.me link with a prefilled text. Not a derivation: it encodes with java.net (the rule of what to send is ClaimDerivation's). */
final class WhatsappLinks {

    private WhatsappLinks() {}

    /** https://wa.me/&lt;digits&gt;?text=&lt;UTF-8, percent-encoded; spaces as %20&gt;. */
    static String withText(String e164, String text) {
        return PublicTextDerivation.whatsappUrl(e164) + "?text=" + URLEncoder.encode(text, StandardCharsets.UTF_8).replace("+", "%20");
    }
}
```

`B/src/main/java/co/scuby/cases/RecoveryClaimQueries.java`:

```java
package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.RECOVERY_CLAIM;
import static co.scuby.db.generated.Tables.SIGHTING;

/** The statements of «Lo tengo». cases is the only writer of recovery_claim. */
@Component
class RecoveryClaimQueries {

    record ClaimCase(String code, UUID createdBy, UUID petId, @Nullable String petName, String status, @Nullable Instant resolvedAt,
                     ClaimDerivation.ContactFlags flags, @Nullable String publicPhone) {}

    record PinForClaim(ClaimDerivation.SightingLink link, GeoPoint point) {}

    /**
     * The publisher's number only when the case's contact preferences make it public — the case status left out on purpose,
     * since a claim may reactivate an expired case and the link is computed after that. A private number is never loaded.
     */
    static final Field<String> PUBLIC_PHONE = DSL.when(DSL.condition(LOST_CASE.EXPOSE_WHATSAPP).and(LOST_CASE.PHONE_HAS_WHATSAPP)
                    .and(LOST_CASE.CONTACT_PHONE_VERIFIED).and(LOST_CASE.IN_APP_ONLY.isFalse()), LOST_CASE.CONTACT_PHONE)
            .as("public_phone");

    private final DSLContext db;

    RecoveryClaimQueries(DSLContext db) {
        this.db = db;
    }

    Optional<ClaimCase> caseForClaim(String code) {
        return db.select(LOST_CASE.CODE, LOST_CASE.CREATED_BY, LOST_CASE.PET_ID, PET.NAME, LOST_CASE.STATUS, LOST_CASE.RESOLVED_AT,
                         LOST_CASE.EXPOSE_WHATSAPP, LOST_CASE.PHONE_HAS_WHATSAPP, LOST_CASE.CONTACT_PHONE_VERIFIED, LOST_CASE.IN_APP_ONLY,
                         PUBLIC_PHONE)
                 .from(LOST_CASE).join(PET).on(PET.ID.eq(LOST_CASE.PET_ID))
                 .where(LOST_CASE.CODE.eq(code))
                 .fetchOptional(r -> new ClaimCase(r.get(LOST_CASE.CODE), r.get(LOST_CASE.CREATED_BY), r.get(LOST_CASE.PET_ID), r.get(PET.NAME),
                         r.get(LOST_CASE.STATUS), r.get(LOST_CASE.RESOLVED_AT) == null ? null : r.get(LOST_CASE.RESOLVED_AT).toInstant(),
                         new ClaimDerivation.ContactFlags(r.get(LOST_CASE.EXPOSE_WHATSAPP), r.get(LOST_CASE.PHONE_HAS_WHATSAPP),
                                 r.get(LOST_CASE.CONTACT_PHONE_VERIFIED), r.get(LOST_CASE.IN_APP_ONLY)),
                         r.get(PUBLIC_PHONE)));
    }

    /** The pin a claim says it grew out of, on this case. */
    Optional<PinForClaim> pin(String code, UUID id) {
        return db.select(SIGHTING.STATUS, SIGHTING.REPORTER_PERSON_ID, SIGHTING.REPORTER_DEVICE_HASH, SIGHTING.CREATED_AT, SIGHTING.LAT, SIGHTING.LNG)
                 .from(SIGHTING).where(SIGHTING.ID.eq(id), SIGHTING.CASE_CODE.eq(code))
                 .fetchOptional(r -> new PinForClaim(
                         new ClaimDerivation.SightingLink(r.value1(), r.value2(), r.value3(), r.value4().toInstant()),
                         new GeoPoint(r.value5(), r.value6())));
    }

    /**
     * One statement (no lock): the claim is written only while the case is active. ON CONFLICT on the partial unique index
     * (one open claim per claimant per case; the predicate is the same inline literal) the caller's open claim — a stale
     * one included — is refreshed instead: the repeat's phone, photos, point and link, and last_active_at = now; its id,
     * created_at and status stay. A double tap serializes on the index entry and refreshes the one row. Returns the new or
     * refreshed claim's id; empty when the case is not active (the caller re-reads it to say why), so a claim on a case
     * that is not active is never answered.
     */
    Optional<UUID> upsertIfActive(String code, UUID claimant, String phone, List<String> photos, @Nullable GeoPoint point,
                                  @Nullable UUID fromSighting, Instant now) {
        UUID id = UUID.randomUUID();
        return db.insertInto(RECOVERY_CLAIM, RECOVERY_CLAIM.ID, RECOVERY_CLAIM.CASE_CODE, RECOVERY_CLAIM.CLAIMANT_PERSON_ID,
                         RECOVERY_CLAIM.PHONE, RECOVERY_CLAIM.PHOTO_URLS, RECOVERY_CLAIM.LAT, RECOVERY_CLAIM.LNG,
                         RECOVERY_CLAIM.FROM_SIGHTING_ID, RECOVERY_CLAIM.STATUS, RECOVERY_CLAIM.CREATED_AT, RECOVERY_CLAIM.LAST_ACTIVE_AT)
                 .select(db.select(DSL.val(id, RECOVERY_CLAIM.ID), LOST_CASE.CODE, DSL.val(claimant, RECOVERY_CLAIM.CLAIMANT_PERSON_ID),
                                   DSL.val(phone, RECOVERY_CLAIM.PHONE), DSL.val(photos.toArray(String[]::new), RECOVERY_CLAIM.PHOTO_URLS),
                                   DSL.val(point == null ? null : point.lat(), RECOVERY_CLAIM.LAT),
                                   DSL.val(point == null ? null : point.lng(), RECOVERY_CLAIM.LNG),
                                   DSL.val(fromSighting, RECOVERY_CLAIM.FROM_SIGHTING_ID), DSL.inline("open", RECOVERY_CLAIM.STATUS),
                                   DSL.val(now.atOffset(ZoneOffset.UTC), RECOVERY_CLAIM.CREATED_AT),
                                   DSL.val(now.atOffset(ZoneOffset.UTC), RECOVERY_CLAIM.LAST_ACTIVE_AT))
                           .from(LOST_CASE)
                           .where(LOST_CASE.CODE.eq(code), LOST_CASE.STATUS.eq(DSL.inline("active"))))
                 .onConflict(RECOVERY_CLAIM.CASE_CODE, RECOVERY_CLAIM.CLAIMANT_PERSON_ID)
                 .where(RECOVERY_CLAIM.STATUS.eq(DSL.inline("open")))
                 .doUpdate()
                 .set(RECOVERY_CLAIM.PHONE, DSL.excluded(RECOVERY_CLAIM.PHONE))
                 .set(RECOVERY_CLAIM.PHOTO_URLS, DSL.excluded(RECOVERY_CLAIM.PHOTO_URLS))
                 .set(RECOVERY_CLAIM.LAT, DSL.excluded(RECOVERY_CLAIM.LAT))
                 .set(RECOVERY_CLAIM.LNG, DSL.excluded(RECOVERY_CLAIM.LNG))
                 .set(RECOVERY_CLAIM.FROM_SIGHTING_ID, DSL.excluded(RECOVERY_CLAIM.FROM_SIGHTING_ID))
                 .set(RECOVERY_CLAIM.LAST_ACTIVE_AT, DSL.excluded(RECOVERY_CLAIM.LAST_ACTIVE_AT))
                 .returning(RECOVERY_CLAIM.ID)
                 .fetchOptional(r -> r.get(RECOVERY_CLAIM.ID));
    }
}
```

`B/src/main/java/co/scuby/cases/RecoveryClaimService.java`:

```java
package co.scuby.cases;

import co.scuby.cases.LifecycleQueries.LifecycleRow;
import co.scuby.cases.LostLifecycleDerivation.Action;
import co.scuby.cases.LostLifecycleDerivation.Outcome;
import co.scuby.identity.PhoneNumbers;
import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.db.UniqueViolation;
import co.scuby.platform.security.Account;
import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.BodyValidation;
import co.scuby.uploads.PhotoAttachments;
import co.scuby.uploads.UploadPurpose;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * «Lo tengo» (docs/product/04-lost-workflow.md · recovery_claim; L1 design §4.9). Order: the code exists (not_found; a
 * purged one gone) → the caller is not the owner (forbidden) → the body: phone, photo count, then the photos (S3 in
 * staging: outside any transaction) → the status. from_sighting_id is a link, never an error: kept (with the pin's point)
 * only when it is the caller's own visible pin on this case from the last 24 h, else dropped. Then one transaction: the
 * reactivation of an expired case (decision #29; zero rows is not an error, a concurrent claim may have done it) and the
 * one-statement upsert, which inserts the claim or refreshes the caller's open one (a repeat). Empty upsert → the case is
 * not active, and a re-read says why (invalid_transition, active_case_exists): an old claim is never answered on a case
 * that is not active. No rate limit (as #54), no notification, no check-in, no outbox row (L2 derives them from rows).
 */
@Service
class RecoveryClaimService {

    private final RecoveryClaimQueries queries;
    private final LifecycleQueries lifecycle;
    private final LostCaseQueries cases;
    private final CaseAccessPolicy policy;
    private final PhoneNumbers phones;
    private final PhotoAttachments photos;
    private final BodyValidation validation;
    private final TransactionTemplate tx;
    private final Clock clock;

    RecoveryClaimService(RecoveryClaimQueries queries, LifecycleQueries lifecycle, LostCaseQueries cases, CaseAccessPolicy policy,
                         PhoneNumbers phones, PhotoAttachments photos, BodyValidation validation, TransactionTemplate tx, Clock clock) {
        this.queries = queries;
        this.lifecycle = lifecycle;
        this.cases = cases;
        this.policy = policy;
        this.phones = phones;
        this.photos = photos;
        this.validation = validation;
        this.tx = tx;
        this.clock = clock;
    }

    ClaimCreatedView claim(String rawCode, Account account, Caller caller, RecoveryClaimRequest body) {
        String code = OwnerAccess.code(rawCode);
        UUID me = account.personId();
        Instant now = clock.instant();
        RecoveryClaimQueries.ClaimCase found = queries.caseForClaim(code)
                .orElseThrow(() -> cases.isPurged(code) ? CaseErrors.gone() : CaseErrors.notFound());
        if (policy.isOwner(found.createdBy(), me)) throw CaseErrors.forbidden("the owner cannot claim their own case");

        if (body.phone() == null) throw CaseErrors.invalidField("phone", "required");
        String phone = phones.requireMobile(body.phone(), "phone");
        validation.require(body);
        Optional<RecoveryClaimQueries.PinForClaim> link = linkedPin(code, body.fromSightingId(), caller, now);
        photos.requireAttachable(body.photos(), UploadPurpose.claim, caller, "photo_urls");

        Outcome outcome = LostLifecycleDerivation.check(Action.CLAIM, found.status(), found.resolvedAt(), now);
        if (outcome == Outcome.INVALID_TRANSITION) throw CaseErrors.invalidTransition();
        GeoPoint claimPoint = link.map(RecoveryClaimQueries.PinForClaim::point).orElse(null);
        UUID claimFrom = link.isPresent() ? UUID.fromString(body.fromSightingId()) : null;
        Optional<UUID> written;
        try {
            written = tx.execute(status -> {
                if (outcome == Outcome.REACTIVATE) lifecycle.reopen(code, null, now);
                return queries.upsertIfActive(code, me, phone, body.photos(), claimPoint, claimFrom, now);
            });
        } catch (RuntimeException e) {
            if (!UniqueViolation.on(e, LifecycleQueries.ACTIVE_PER_PET)) throw e;
            throw lifecycle.activeCodeFor(found.petId()).map(CaseErrors::activeCaseExists).orElseGet(CaseErrors::invalidTransition);
        }
        // A row came back, so the case was active when it was written: the link follows the contact rule on an active case.
        UUID id = written.orElseThrow(() -> refusalAfterEmptyWrite(code, now));
        String wa = ClaimDerivation.whatsappPhone(found.flags(), "active", found.publicPhone());
        return new ClaimCreatedView(id.toString(),
                wa == null ? null : WhatsappLinks.withText(wa, ClaimDerivation.whatsappText(found.petName(), code)));
    }

    /**
     * The pin the claim grew out of, when it is the caller's own (LostCaseDerivation.mine: their person, or an anonymous pin
     * from their device), visible, on this case and from the last 24 h; empty otherwise — absent, not a UUID, unknown, or
     * ineligible. Never an error: the claim is what matters, the link is attribution.
     */
    private Optional<RecoveryClaimQueries.PinForClaim> linkedPin(String code, @Nullable String rawId, Caller caller, Instant now) {
        if (rawId == null) return Optional.empty();
        return OwnerAccess.id(rawId).flatMap(id -> queries.pin(code, id)).filter(pin -> ClaimDerivation.prefillEligible(pin.link(),
                LostCaseDerivation.mine(caller.personId(), caller.deviceHash(), pin.link().reporterPersonId(), pin.link().reporterDeviceHash()),
                now));
    }

    /** Nothing written: the case is not active (and could not be reactivated); say why. */
    private ApiException refusalAfterEmptyWrite(String code, Instant now) {
        LifecycleRow row = lifecycle.load(code).orElse(null);
        if (row == null) return CaseErrors.notFound();
        if (LostLifecycleDerivation.check(Action.CLAIM, row.status(), row.resolvedAt(), now) == Outcome.INVALID_TRANSITION) {
            return CaseErrors.invalidTransition();
        }
        if (row.otherActiveCode() != null) return CaseErrors.activeCaseExists(row.otherActiveCode());
        return CaseErrors.invalidTransition();
    }
}
```

`B/src/main/java/co/scuby/cases/RecoveryClaimController.java`:

```java
package co.scuby.cases;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Account;
import co.scuby.platform.security.Caller;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** claimRecovery: 201 {id, whatsapp_url}, also for a repeat (the refreshed open claim; 201 is the contract's only success status). A session is required (contract, decision #75). */
@ApiComponent
@RestController
class RecoveryClaimController {

    private final RecoveryClaimService service;

    RecoveryClaimController(RecoveryClaimService service) {
        this.service = service;
    }

    @PostMapping("/cases/{code}/recovery-claims")
    @ResponseStatus(HttpStatus.CREATED)
    ClaimCreatedView claim(@PathVariable String code, Account account, Caller caller, @RequestBody RecoveryClaimRequest body) {
        return service.claim(code, account, caller, body);
    }
}
```

In `CasesSecurityRules.authorize` add:

```java
        rules.requestMatchers(HttpMethod.POST, "/cases/*/recovery-claims").authenticated();
```

In `StatementCeilings` add:

```java
            Map.entry("POST /cases/{code}/recovery-claims", 8),   // worst path, RecoveryClaimTest: session, pre-read (case + pet name + contact), supported_countries, from-sighting read, upload lookup, reactivation, upsert (insert or refresh), status re-read; the plain claim and a plain repeat are 4
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `[mvn] test -Dtest='WhatsappLinksTest,RecoveryClaimTest,RecoveryClaimPrecedenceTest,RecoveryClaimRaceTest,ContractCoverageTest,RequiredFieldsTest,ArchitectureTest' 2>&1 | tail -20`
Expected: PASS. `ContractCoverageTest` now runs `POST /cases/{code}/recovery-claims` anonymously → `401` (the contract of Task 8 marks it `session`). `ArchitectureTest` accepts `WhatsappLinks` (not a derivation) using `java.net`.

- [ ] **Step 5: Run the whole suite and commit**

Run: `[mvn] verify 2>&1 | tail -10` — Expected: `BUILD SUCCESS`.

```bash
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 add \
  backend/src/main/java/co/scuby/cases/RecoveryClaimRequest.java backend/src/main/java/co/scuby/cases/ClaimCreatedView.java \
  backend/src/main/java/co/scuby/cases/WhatsappLinks.java backend/src/main/java/co/scuby/cases/RecoveryClaimQueries.java \
  backend/src/main/java/co/scuby/cases/RecoveryClaimService.java backend/src/main/java/co/scuby/cases/RecoveryClaimController.java \
  backend/src/main/java/co/scuby/cases/CasesSecurityRules.java backend/src/test/java/co/scuby/support/CaseFixtures.java \
  backend/src/test/java/co/scuby/support/StatementCeilings.java backend/src/test/java/co/scuby/cases/WhatsappLinksTest.java \
  backend/src/test/java/co/scuby/cases/RecoveryClaimTest.java backend/src/test/java/co/scuby/cases/RecoveryClaimPrecedenceTest.java \
  backend/src/test/java/co/scuby/cases/RecoveryClaimRaceTest.java
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 commit -m "feat: «Lo tengo» — one open claim per person per case, a repeat refreshes it, reactivation in the same transaction, WhatsApp link under the contact rule"
```

---
### Task 10: The owner's answer to a claim, and the claims on the owner's case page

`POST /cases/{code}/claims/{claimId}` (spec §4.10): revisable, idempotent, any case status, never closes the case. `GET /cases/{code}` (spec §4.13) gives the owner the newest 50 claims with their wire status and the open non-stale count — one more query, only for the owner (a non-owner gets `claims: []`, `open_claim_count: null`, and the claims are never queried for them). The plan check of Task 1 is pointed at the production query.

**Files:**
- Create: `B/src/main/java/co/scuby/cases/ClaimAnswerRequest.java`
- Modify: `RecoveryClaimQueries.java` (answer target, answer), `RecoveryClaimService.java` (`answer`), `RecoveryClaimController.java` (route)
- Modify: `LostCaseFacts.java`, `LostCaseQueries.java`, `CaseReads.java`, `LostCaseView.java`, `LostCaseDerivation.java`
- Modify: `CasesSecurityRules`, `StatementCeilings` (`GET /cases/{code}` 3 → 4; answer 3)
- Modify tests: `LostCaseDerivationTest.java`, `CaseStatementsTest.java`, `CaseEndpointTest.java` (the owner-only null count, and the owner read's statement count 3 → 4), `LostParityTest.java`, `RecoveryClaimPlanTest.java`
- Test: `B/src/test/java/co/scuby/cases/ClaimAnswerTest.java`, `ClaimLeakTest.java`

**Interfaces:**
- Consumes: `ClaimDerivation.wireStatus/openClaimCount/staleCutoff/isAnswer/answerChanges` (Task 2); `OwnerAccess`, `CaseErrors`, `CreatedView` (Task 4); `CaseFixtures.claim` (Task 9).
- Produces:
  - `record ClaimAnswerRequest(@JsonProperty(required = true) @Nullable String status)`; `RecoveryClaimService.answer(String rawCode, String rawClaimId, UUID me, ClaimAnswerRequest body) → CreatedView`.
  - `LostCaseFacts` gains a last component `@Nullable ClaimFacts claims` and `withClaims(ClaimFacts)`; nested `record ClaimFacts(List<ClaimRow> newest, int openNonStale)`, `record ClaimRow(UUID id, String phone, Instant createdAt, Instant lastActiveAt, String status)` (stale is derived from `lastActiveAt`).
  - `LostCaseQueries.MAX_CLAIMS_SHOWN = 50`; `Select<? extends Record> claimsQuery(String code, Instant now)`; `LostCaseFacts.ClaimFacts claims(String code, Instant now)`.
  - `LostCaseView.openClaimCount` becomes `@Nullable Integer`; `claims` becomes `List<LostCaseView.ClaimView>` with `record ClaimView(String id, String phone, Instant createdAt, String status)`.
  - Ceilings: `GET /cases/{code}` 4 (owner), `POST /cases/{code}/claims/{claimId}` 3.

- [ ] **Step 1: Write the failing derivation rows**

In `B/src/test/java/co/scuby/cases/LostCaseDerivationTest.java`:

(a) in `facts(...)`, replace `"Carolina Mejía", whatsappPhone, sightings);` with `"Carolina Mejía", whatsappPhone, sightings, null);`; in `anUnnamedPublisherShowsTheGenericNameNotAnythingFromTheirEmail`, replace `new GeoPoint(6.2442, -75.5812), 100, NOW, null, null, WA, List.of());` with `new GeoPoint(6.2442, -75.5812), 100, NOW, null, null, WA, List.of(), null);`;

(b) in `aStrangerGetsNoHiddenPinsAndNoReportersNumbersEvenIfTheFactsHadThem`, replace `        assertThat(view.openClaimCount()).isZero();` with `        assertThat(view.openClaimCount()).isNull();`;

(c) add at the end of the class:

```java
    static LostCaseFacts.ClaimRow claim(String id, Duration age, String status) {
        return claim(id, age, age, status);
    }

    /** A claim made {@code age} ago whose claimant last said «Lo tengo» {@code idle} ago. */
    static LostCaseFacts.ClaimRow claim(String id, Duration age, Duration idle, String status) {
        return new LostCaseFacts.ClaimRow(UUID.fromString("00000000-0000-0000-0000-0000000000" + id), "+573001112233", NOW.minus(age),
                NOW.minus(idle), status);
    }

    static final LostCaseFacts.ClaimFacts THREE_CLAIMS = new LostCaseFacts.ClaimFacts(List.of(
            claim("c1", Duration.ofHours(1), "open"),
            claim("c2", Duration.ofDays(8), "open"),
            claim("c3", Duration.ofDays(2), "confirmed")), 1);

    @Test
    void theOwnerGetsTheClaimsWithTheirWireStatusAndTheOpenCountOnAnActiveCase() {
        LostCaseView view = LostCaseDerivation.derive(luna(List.of()).withClaims(THREE_CLAIMS), OWNER_VIEW, NOW, ES);
        assertThat(view.claims()).extracting(LostCaseView.ClaimView::status).containsExactly("open", "stale", "confirmed");
        assertThat(view.claims()).extracting(LostCaseView.ClaimView::id).containsExactly(
                "00000000-0000-0000-0000-0000000000c1", "00000000-0000-0000-0000-0000000000c2", "00000000-0000-0000-0000-0000000000c3");
        assertThat(view.claims().getFirst().phone()).isEqualTo("+573001112233");
        assertThat(view.claims().getFirst().createdAt()).isEqualTo(NOW.minus(Duration.ofHours(1)));
        assertThat(view.openClaimCount()).isEqualTo(1);
    }

    @Test
    void theOwnerOfAClosedCaseStillSeesTheClaimsAndACountOfZero() {
        var closed = facts("reunited", 100, null, "Luna", null, List.of()).withClaims(THREE_CLAIMS);
        LostCaseView view = LostCaseDerivation.derive(closed, OWNER_VIEW, NOW, ES);
        assertThat(view.claims()).hasSize(3);
        assertThat(view.openClaimCount()).isZero();
    }

    @Test
    void aNonOwnerGetsNoClaimsAndANullCountEvenIfTheFactsHadThem() {
        LostCaseView view = LostCaseDerivation.derive(luna(List.of()).withClaims(THREE_CLAIMS), STRANGER, NOW, ES);
        assertThat(view.claims()).isEmpty();
        assertThat(view.openClaimCount()).isNull();
    }

    @Test
    void aClaimIsStaleByItsLastActivityNotByWhenItWasMade() {
        var refreshed = new LostCaseFacts.ClaimFacts(List.of(
                claim("d1", Duration.ofDays(9), Duration.ofHours(1), "open"),      // made 9 days ago, repeated an hour ago
                claim("d2", Duration.ofDays(2), Duration.ofDays(8), "open")), 1);  // (not producible, but proves the field read)
        LostCaseView view = LostCaseDerivation.derive(luna(List.of()).withClaims(refreshed), OWNER_VIEW, NOW, ES);
        assertThat(view.claims()).extracting(LostCaseView.ClaimView::status).containsExactly("open", "stale");
        assertThat(view.claims().getFirst().createdAt()).as("the wire keeps when the claim was made").isEqualTo(NOW.minus(Duration.ofDays(9)));
    }

    @Test
    void anOwnerWithNoClaimsLoadedGetsAnEmptyListAndZero() {
        LostCaseView view = LostCaseDerivation.derive(luna(List.of()).withClaims(new LostCaseFacts.ClaimFacts(List.of(), 0)), OWNER_VIEW, NOW, ES);
        assertThat(view.claims()).isEmpty();
        assertThat(view.openClaimCount()).isZero();
    }
```

Run: `[mvn] test -Dtest=LostCaseDerivationTest 2>&1 | tail -10`
Expected: FAIL — compilation: `LostCaseFacts` takes 12 arguments, `cannot find symbol: ClaimRow / ClaimFacts / withClaims / ClaimView`.

- [ ] **Step 2: Carry claims through facts, query, derivation and view**

`B/src/main/java/co/scuby/cases/LostCaseFacts.java` — replace the record header and `withSightings` with:

```java
record LostCaseFacts(String code, String status, @Nullable Instant resolvedAt, UUID createdBy, PetFacts pet,
                     GeoPoint center, double radiusM, Instant lastSeenAt, @Nullable String placeName,
                     @Nullable String publisherName, @Nullable String whatsappPhone, List<SightingFacts> sightings,
                     @Nullable ClaimFacts claims) {
```

(keep `PetFacts` and `SightingFacts` as they are) and add, inside the record:

```java
    /** The owner's claims: the newest MAX_CLAIMS_SHOWN of every status, and the open non-stale count over all of them. Null for a non-owner: not queried. */
    record ClaimFacts(List<ClaimRow> newest, int openNonStale) {}

    /** lastActiveAt: the claimant's last «Lo tengo» on it (stale is derived from it); createdAt: when it was first made. */
    record ClaimRow(UUID id, String phone, Instant createdAt, Instant lastActiveAt, String status) {}

    LostCaseFacts withSightings(List<SightingFacts> loaded) {
        return new LostCaseFacts(code, status, resolvedAt, createdBy, pet, center, radiusM, lastSeenAt, placeName,
                publisherName, whatsappPhone, List.copyOf(loaded), claims);
    }

    LostCaseFacts withClaims(ClaimFacts loaded) {
        return new LostCaseFacts(code, status, resolvedAt, createdBy, pet, center, radiusM, lastSeenAt, placeName,
                publisherName, whatsappPhone, sightings, loaded);
    }
```

and update its javadoc: `What the database says about a lost case, loaded according to the viewer's access. The publisher's number is present only when it is public (whatsappPhone); claims are loaded only for the owner.`

`B/src/main/java/co/scuby/cases/LostCaseQueries.java` — add the imports `java.time.Instant`, `java.time.ZoneOffset`, `static co.scuby.db.generated.Tables.RECOVERY_CLAIM`; in `loadCase` replace `r.get(LOST_CASE.PLACE_NAME), r.get(PUBLISHER_NAME), r.get(WHATSAPP_PHONE), List.of()));` with `r.get(LOST_CASE.PLACE_NAME), r.get(PUBLISHER_NAME), r.get(WHATSAPP_PHONE), List.of(), null));`; and add:

```java
    /**
     * The owner's claim list shows at most this many: the newest by when each claim was made (L1 design §4.13). Accepted
     * limit: with more than 50 newer claims, an older open claim (a refreshed one included: a repeat does not move
     * created_at) is counted in open_claim_count but not listed. Realistic only under spam; ordering open claims first
     * would lose the index order, so measure the plan before changing it.
     */
    static final int MAX_CLAIMS_SHOWN = 50;

    /**
     * The owner's claims in one query: the newest MAX_CLAIMS_SHOWN of every status, newest first, each row carrying the count
     * of open, non-stale claims of the whole case (non-stale by last_active_at; a window over every matching row, computed
     * before the LIMIT). Read through recovery_claim_by_case_recent_idx (RecoveryClaimPlanTest). Owner only: CaseReads never
     * calls it for anyone else.
     */
    Select<? extends Record> claimsQuery(String code, Instant now) {
        Field<Integer> openNonStale = DSL.count()
                .filterWhere(RECOVERY_CLAIM.STATUS.eq(DSL.inline("open"))
                        .and(RECOVERY_CLAIM.LAST_ACTIVE_AT.ge(ClaimDerivation.staleCutoff(now).atOffset(ZoneOffset.UTC))))
                .over().as("open_non_stale");
        return db.select(RECOVERY_CLAIM.ID, RECOVERY_CLAIM.PHONE, RECOVERY_CLAIM.CREATED_AT, RECOVERY_CLAIM.LAST_ACTIVE_AT,
                         RECOVERY_CLAIM.STATUS, openNonStale)
                 .from(RECOVERY_CLAIM)
                 .where(RECOVERY_CLAIM.CASE_CODE.eq(code))
                 .orderBy(RECOVERY_CLAIM.CREATED_AT.desc(), RECOVERY_CLAIM.ID.desc())
                 .limit(MAX_CLAIMS_SHOWN);
    }

    LostCaseFacts.ClaimFacts claims(String code, Instant now) {
        var rows = claimsQuery(code, now).fetch();
        int open = rows.isEmpty() ? 0 : rows.getFirst().get("open_non_stale", Integer.class);
        return new LostCaseFacts.ClaimFacts(rows.map(r -> new LostCaseFacts.ClaimRow(r.get(RECOVERY_CLAIM.ID), r.get(RECOVERY_CLAIM.PHONE),
                r.get(RECOVERY_CLAIM.CREATED_AT).toInstant(), r.get(RECOVERY_CLAIM.LAST_ACTIVE_AT).toInstant(), r.get(RECOVERY_CLAIM.STATUS))), open);
    }
```

`B/src/main/java/co/scuby/cases/CaseReads.java` — replace the last three lines of `view` (from `Access access = …` to the `return`) with:

```java
        Access access = policy.accessFor(found.createdBy(), caller);
        Instant now = clock.instant();
        LostCaseFacts facts = found.withSightings(queries.sightings(code, access));
        // Private facts are not even queried for a non-owner (the claims and their count are owner-only, decision #76).
        if (access == Access.OWNER) facts = facts.withClaims(queries.claims(code, now));
        return LostCaseDerivation.derive(facts, new Viewer(access, caller.personId(), caller.deviceHash()), now, locale);
```

(add the import `java.time.Instant`; update the class javadoc to `Access → facts → derivation for GET /cases/{code}. No transaction: autocommit reads (case, sightings, and the claims for the owner only).`)

`B/src/main/java/co/scuby/cases/LostCaseView.java` — replace the record header with:

```java
record LostCaseView(String code, String vertical, String status, @Nullable Instant resolvedAt, String viewer,
                    PetView pet, LastSeenView lastSeen, @Nullable Integer openClaimCount, List<SightingView> sightings,
                    List<ClaimView> claims, @Nullable Object pendingCheckin, @Nullable ContactView contact) {
```

and add the nested record:

```java
    /** One claim as the owner sees it; status is the wire status (stale derived). Phone only: evidence is not exposed (O36). */
    record ClaimView(String id, String phone, Instant createdAt, String status) {}
```

`B/src/main/java/co/scuby/cases/LostCaseDerivation.java` — in `derive`, replace

```java
                0, sightings, List.of(), null, contact(facts, locale));
```

with

```java
                ClaimDerivation.openClaimCount(owner, facts.status(), facts.claims() == null ? 0 : facts.claims().openNonStale()),
                sightings, claims(facts, owner, now), null, contact(facts, locale));
```

and add:

```java
    /** Owner only, in the query's order (newest first); a non-owner gets [] whatever the facts hold. */
    private static List<LostCaseView.ClaimView> claims(LostCaseFacts facts, boolean owner, Instant now) {
        if (!owner || facts.claims() == null) return List.of();
        return facts.claims().newest().stream()
                .map(c -> new LostCaseView.ClaimView(c.id().toString(), c.phone(), c.createdAt(),
                        ClaimDerivation.wireStatus(c.status(), c.lastActiveAt(), now)))
                .toList();
    }
```

Run: `[mvn] test -Dtest='LostCaseDerivationTest,ArchitectureTest' 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 3: Write the failing endpoint and leak tests**

In `B/src/test/java/co/scuby/cases/CaseStatementsTest.java` replace

```java
    void ownerReadIsSessionLookupCaseAndSightings() {
        assertThat(cold(owner).statements()).hasSize(3);
    }
```

with

```java
    void ownerReadIsSessionLookupCaseSightingsAndClaims() {
        assertThat(cold(owner).statements()).hasSize(4);
    }

    @Test
    void aNonOwnerReadNeverQueriesTheClaims() {
        ApiClient stranger = clients.newBrowser();
        accounts.signIn(stranger, "stranger@correo.co");
        assertThat(cold(stranger).statements()).noneMatch(s -> s.contains("recovery_claim"));
        assertThat(cold(clients.newBrowser()).statements()).noneMatch(s -> s.contains("recovery_claim"));
        assertThat(cold(owner).statements()).anyMatch(s -> s.contains("\"recovery_claim\""));
    }
```

In `B/src/test/java/co/scuby/cases/CaseEndpointTest.java`:

(a) in `assertNothingOwnerOnly`, after `        assertThat(r.json().get("claims")).isEmpty();` add `        assertThat(r.isNull("/open_claim_count")).isTrue();`;

(b) in `theStatementCountDoesNotGrowWithSightings` (the owner's read on a cold session cache, now one query more), replace

```java
        ApiResponse r = owner.get("/cases/{code}", "7K3PQ");    // ApiClient enforces the ceiling (3)
        assertThat(r.json().get("sightings")).hasSize(28);
        assertThat(r.statements()).hasSizeLessThanOrEqualTo(3);
```

with

```java
        ApiResponse r = owner.get("/cases/{code}", "7K3PQ");    // ApiClient enforces the ceiling (4: + the owner's claims)
        assertThat(r.json().get("sightings")).hasSize(28);
        assertThat(r.statements()).hasSize(4);                   // session, case, sightings, claims — whatever the sighting count
```

In `B/src/test/java/co/scuby/cases/LostParityTest.java` replace

```java
        assertThat(luna.json().get("open_claim_count").asInt()).isZero();       // override: no claims in the slice (the mock seeds one)
```

with

```java
        assertThat(luna.isNull("/open_claim_count")).isTrue();                 // owner-only since L1 (decision #76), as the mock
```

In `B/src/test/java/co/scuby/cases/RecoveryClaimPlanTest.java`: add `@Autowired LostCaseQueries queries;`, replace `var q = ownerClaimList(code);` with `var q = queries.claimsQuery(code, MutableClock.START);`, delete the `ownerClaimList` method and the now-unused imports (`Select`, `DSL`, `Duration`, `ZoneOffset`, `RECOVERY_CLAIM`), and change the class javadoc's last sentence to `The production query (LostCaseQueries.claimsQuery) is the one checked.`

`B/src/test/java/co/scuby/cases/ClaimAnswerTest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.cache.ClearableCache;
import co.scuby.platform.flags.FeatureFlags;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.RECOVERY_CLAIM;
import static org.assertj.core.api.Assertions.assertThat;

/** The owner's verdict on a claim (spec §4.10): revisable, idempotent, any case status, never closes the case. */
@IntegrationTest
class ClaimAnswerTest {

    static final Instant NOW = MutableClock.START;
    static final String PATH = "/cases/{code}/claims/{claimId}";

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired MutableClock clock;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient owner;
    ApiClient claimant;
    UUID carolina;
    UUID andres;
    UUID claim;
    UUID other;

    @BeforeEach
    void setUp() {
        owner = clients.newBrowser();
        carolina = accounts.signIn(owner, "carolina@correo.co");
        claimant = clients.newBrowser();
        andres = accounts.signIn(claimant, "andres@correo.co");
        cases.luna(carolina);
        claim = cases.claim("7K3PQ", andres, "+573001112233", NOW.minus(Duration.ofHours(2)), "open");
        other = cases.claim("7K3PQ", accounts.person("laura@correo.co"), "+573001112244", NOW.minus(Duration.ofHours(1)), "open");
    }

    private ApiResponse answer(ApiClient as, String code, Object id, String status) {
        return as.post(PATH, "{\"status\":" + (status == null ? "null" : "\"" + status + "\"") + "}", code, id);
    }

    private Record row(UUID id) {
        return db.selectFrom(RECOVERY_CLAIM).where(RECOVERY_CLAIM.ID.eq(id)).fetchOne();
    }

    private ApiResponse cold(java.util.function.Supplier<ApiResponse> call) {
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        return call.get();
    }

    @Test
    void confirmingStoresTheAnswerAndNeverClosesTheCaseOrTouchesOtherClaims() {
        ApiResponse r = answer(owner, "7K3PQ", claim, "confirmed");
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/id")).isEqualTo(claim.toString());
        assertThat(row(claim).get(RECOVERY_CLAIM.STATUS)).isEqualTo("confirmed");
        assertThat(row(claim).get(RECOVERY_CLAIM.ANSWERED_AT).toInstant()).isEqualTo(NOW);
        assertThat(row(other).get(RECOVERY_CLAIM.STATUS)).isEqualTo("open");
        assertThat(db.select(LOST_CASE.STATUS).from(LOST_CASE).fetchOne(LOST_CASE.STATUS)).isEqualTo("active");
        ApiResponse page = owner.get("/cases/{code}", "7K3PQ");
        assertThat(page.str("/claims/1/status")).isEqualTo("confirmed");      // newest first: the other claim is /claims/0
        assertThat(page.json().get("open_claim_count").asInt()).isEqualTo(1);
    }

    @Test
    void answersAreRevisableAndEachChangeIsTimed() {
        answer(owner, "7K3PQ", claim, "confirmed");
        clock.advance(Duration.ofHours(1));
        assertThat(answer(owner, "7K3PQ", claim, "dismissed").status()).isEqualTo(200);
        assertThat(row(claim).get(RECOVERY_CLAIM.STATUS)).isEqualTo("dismissed");
        assertThat(row(claim).get(RECOVERY_CLAIM.ANSWERED_AT).toInstant()).isEqualTo(NOW.plus(Duration.ofHours(1)));
        clock.advance(Duration.ofHours(1));
        assertThat(answer(owner, "7K3PQ", claim, "confirmed").status()).isEqualTo(200);
        assertThat(row(claim).get(RECOVERY_CLAIM.STATUS)).isEqualTo("confirmed");
    }

    @Test
    void repeatingTheCurrentAnswerIsANoOpWithoutAWrite() {
        answer(owner, "7K3PQ", claim, "dismissed");
        clock.advance(Duration.ofHours(3));
        ApiResponse again = cold(() -> answer(owner, "7K3PQ", claim, "dismissed"));
        assertThat(again.status()).isEqualTo(200);
        assertThat(again.str("/id")).isEqualTo(claim.toString());
        assertThat(again.statements()).as("%s", again.statements()).hasSize(2);   // session, pre-read
        assertThat(row(claim).get(RECOVERY_CLAIM.ANSWERED_AT).toInstant()).isEqualTo(NOW);
    }

    @Test
    void aStaleClaimCanBeAnsweredAndSeveralClaimsMayBeConfirmed() {
        UUID stale = cases.claim("7K3PQ", accounts.person("pedro@correo.co"), "+573001112255", NOW.minus(Duration.ofDays(9)), "open");
        assertThat(answer(owner, "7K3PQ", stale, "confirmed").status()).isEqualTo(200);
        assertThat(answer(owner, "7K3PQ", claim, "confirmed").status()).isEqualTo(200);
        assertThat(db.fetchCount(RECOVERY_CLAIM, RECOVERY_CLAIM.STATUS.eq("confirmed"))).isEqualTo(2);
    }

    @ParameterizedTest
    @CsvSource({"reunited", "expired", "cancelled"})
    void allowedInEveryCaseStatus(String status) {
        cases.close("7K3PQ", status, NOW.minus(Duration.ofDays(1)));
        assertThat(answer(owner, "7K3PQ", claim, "dismissed").status()).isEqualTo(200);
        assertThat(row(claim).get(RECOVERY_CLAIM.STATUS)).isEqualTo("dismissed");
    }

    @Test
    void anUnknownMalformedOrForeignClaimIsNotFound() {
        cases.lostCase(carolina, "OTH22", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "active", NOW.minusSeconds(7200));
        UUID foreign = cases.claim("OTH22", andres, "+573001112233", NOW.minusSeconds(60), "open");
        assertThat(answer(owner, "7K3PQ", foreign, "confirmed").errorCode()).isEqualTo("not_found");
        assertThat(answer(owner, "7K3PQ", UUID.randomUUID(), "confirmed").errorCode()).isEqualTo("not_found");
        assertThat(answer(owner, "7K3PQ", "x", "confirmed").errorCode()).isEqualTo("not_found");
        assertThat(row(foreign).get(RECOVERY_CLAIM.STATUS)).isEqualTo("open");
    }

    @Test
    void anUnknownOrPurgedCaseIsNotFound() {
        cases.purge("GONE5");
        assertThat(answer(owner, "ZZZZZ", claim, "confirmed").errorCode()).isEqualTo("not_found");
        assertThat(answer(owner, "GONE5", claim, "confirmed").errorCode()).isEqualTo("not_found");
    }

    @Test
    void theClaimantAndStrangersAreForbiddenNobodyIsUnauthorized() {
        assertThat(answer(claimant, "7K3PQ", claim, "confirmed").errorCode()).isEqualTo("forbidden");
        ApiClient stranger = clients.newBrowser();
        accounts.signIn(stranger, "stranger@correo.co");
        assertThat(answer(stranger, "7K3PQ", claim, "confirmed").errorCode()).isEqualTo("forbidden");
        assertThat(answer(clients.newBrowser(), "7K3PQ", claim, "confirmed").status()).isEqualTo(401);
        assertThat(row(claim).get(RECOVERY_CLAIM.STATUS)).isEqualTo("open");
    }

    @ParameterizedTest(name = "status «{0}»")
    @CsvSource(nullValues = "null", value = {"open", "stale", "null", "CONFIRMED"})
    void onlyConfirmedOrDismissedIsAnAnswer(String status) {
        ApiResponse r = answer(owner, "7K3PQ", claim, status);
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("status")).isTrue();
        assertThat(row(claim).get(RECOVERY_CLAIM.STATUS)).isEqualTo("open");
    }

    // --- error order: session → case not_found → forbidden → claim not_found → body ---

    @Test
    void theErrorOrder() {
        assertThat(clients.newBrowser().post(PATH, "{", "ZZZZZ", claim).errorCode()).isEqualTo("unauthorized");
        assertThat(claimant.post(PATH, "{}", "ZZZZZ", claim).errorCode()).as("Jackson first").isEqualTo("validation_failed");
        assertThat(answer(claimant, "ZZZZZ", claim, "open").errorCode()).isEqualTo("not_found");
        assertThat(answer(claimant, "7K3PQ", UUID.randomUUID(), "open").errorCode()).isEqualTo("forbidden");
        assertThat(answer(owner, "7K3PQ", UUID.randomUUID(), "open").errorCode()).isEqualTo("not_found");
    }

    @Test
    void theWorstPathIsThreeStatements() {
        ApiResponse r = cold(() -> answer(owner, "7K3PQ", claim, "confirmed"));
        assertThat(r.statements()).as("%s", r.statements()).hasSize(3);   // session, pre-read (case + claim), update
    }
}
```

`B/src/test/java/co/scuby/cases/ClaimLeakTest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.cache.ClearableCache;
import co.scuby.platform.flags.FeatureFlags;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Leak test (spec §7.1): the claims, their count, reporters' numbers and hidden pins reach the owner only — not an
 * anonymous visitor, not a signed-in stranger, not the claimant. A reporter-deleted pin reaches nobody.
 */
@IntegrationTest
class ClaimLeakTest {

    static final Instant NOW = MutableClock.START;

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient owner;
    ApiClient stranger;
    ApiClient claimant;
    ApiClient laura;             // the stale claim's claimant
    UUID deleted;

    @BeforeEach
    void setUp() {
        owner = clients.newBrowser();
        UUID carolina = accounts.signIn(owner, "carolina@correo.co");
        stranger = clients.newBrowser();
        accounts.signIn(stranger, "stranger@correo.co");
        claimant = clients.newBrowser();
        UUID andres = accounts.signIn(claimant, "andres@correo.co");
        laura = clients.newBrowser();
        UUID lauraId = accounts.signIn(laura, "laura@correo.co");
        cases.luna(carolina);
        cases.claim("7K3PQ", andres, "+573114440001", NOW.minus(Duration.ofHours(1)), "open");
        cases.claim("7K3PQ", lauraId, "+573114440002", NOW.minus(Duration.ofDays(10)), "open");
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, NOW.minusSeconds(7200), NOW.minusSeconds(7200), null, "3".repeat(64), "+573114440003", "visible");
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, NOW.minusSeconds(3600), NOW.minusSeconds(3600), null, "4".repeat(64), "+573114440004", "hidden_by_owner");
        deleted = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, NOW.minusSeconds(600), NOW.minusSeconds(600), andres, "5".repeat(64), "+573114440005", "deleted_by_reporter");
    }

    private void assertNoPrivateFacts(ApiResponse r, String who) {
        assertThat(r.status()).as(who).isEqualTo(200);
        assertThat(r.str("/viewer")).as(who).isEqualTo("public");
        // The public zone only: the snapped center and the widened radius, never the exact point (decision #69).
        assertThat(r.json().at("/last_seen/radius_m").asDouble()).as(who).isEqualTo(200.0);
        assertThat(r.json().at("/last_seen/center/lng").asDouble()).as(who).isEqualTo(-75.580392);
        assertThat(r.json().get("claims")).as(who).isEmpty();
        assertThat(r.isNull("/open_claim_count")).as(who).isTrue();
        assertThat(r.json().get("sightings")).as(who).hasSize(1);
        r.json().get("sightings").forEach(s -> {
            assertThat(s.get("contact_phone").isNull()).as(who).isTrue();
            assertThat(s.get("hidden").asBoolean()).as(who).isFalse();
        });
        assertThat(r.body()).as(who).doesNotContain("311444000").doesNotContain(deleted.toString());
    }

    @Test
    void nobodyButTheOwnerSeesClaimsCountsNumbersOrHiddenPins() {
        assertNoPrivateFacts(clients.newBrowser().get("/cases/{code}", "7K3PQ"), "anonymous");
        assertNoPrivateFacts(stranger.get("/cases/{code}", "7K3PQ"), "signed-in stranger");
        assertNoPrivateFacts(claimant.get("/cases/{code}", "7K3PQ"), "the claimant");
    }

    @Test
    void theOwnerSeesTheClaimsNewestFirstTheCountTheNumbersAndTheHiddenPinButNotTheDeletedOne() {
        ApiResponse r = owner.get("/cases/{code}", "7K3PQ");
        assertThat(r.json().get("claims")).hasSize(2);
        assertThat(r.str("/claims/0/phone")).isEqualTo("+573114440001");
        assertThat(r.str("/claims/0/status")).isEqualTo("open");
        assertThat(r.str("/claims/1/status")).isEqualTo("stale");
        assertThat(r.json().get("open_claim_count").asInt()).as("the stale claim does not count").isEqualTo(1);
        assertThat(r.json().get("sightings")).hasSize(2);
        assertThat(r.body()).contains("+573114440003").contains("+573114440004").doesNotContain("+573114440005").doesNotContain(deleted.toString());
    }

    @Test
    void theOwnerOfAClosedCaseSeesTheClaimsAndZero() {
        cases.close("7K3PQ", "reunited", NOW.minusSeconds(60));
        ApiResponse r = owner.get("/cases/{code}", "7K3PQ");
        assertThat(r.json().get("claims")).hasSize(2);
        assertThat(r.json().get("open_claim_count").asInt()).isZero();
    }

    /**
     * Laura's claim went stale (10 days without an answer); she still has the dog and taps «Lo tengo» again with a new
     * number: the same claim becomes fresh, the owner sees it as open with the new number, and the badge counts it again.
     */
    @Test
    void aRepeatClaimMakesAStaleClaimFreshAndTheOwnersCountIncludesItAgain() {
        ApiResponse before = owner.get("/cases/{code}", "7K3PQ");
        assertThat(before.str("/claims/1/status")).isEqualTo("stale");
        assertThat(before.json().get("open_claim_count").asInt()).isEqualTo(1);
        ApiResponse again = laura.post("/cases/{code}/recovery-claims", "{\"phone\":\"+573114440009\"}", "7K3PQ");
        assertThat(again.status()).isEqualTo(201);
        ApiResponse after = owner.get("/cases/{code}", "7K3PQ");
        assertThat(after.json().get("claims")).hasSize(2);
        assertThat(after.str("/claims/1/id")).isEqualTo(again.str("/id"));
        assertThat(after.str("/claims/1/status")).isEqualTo("open");
        assertThat(after.str("/claims/1/phone")).isEqualTo("+573114440009");
        assertThat(after.json().get("open_claim_count").asInt()).as("Andrés's and Laura's again").isEqualTo(2);
    }

    @Test
    void theOwnerGetsTheNewest50AndTheCountOverAllOfThemWithinTheSameFourStatements() {
        for (int i = 0; i < 55; i++) {
            cases.claim("7K3PQ", accounts.person("claimant" + i + "@correo.co"), "+57311555%04d".formatted(i), NOW.minus(Duration.ofMinutes(i + 1)), "open");
        }
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        ApiResponse r = owner.get("/cases/{code}", "7K3PQ");
        assertThat(r.json().get("claims")).hasSize(50);
        assertThat(r.str("/claims/0/phone")).isEqualTo("+573115550000");
        assertThat(r.json().get("open_claim_count").asInt()).isEqualTo(56);   // 55 new + andres's, all within 7 days
        assertThat(r.statements()).as("%s", r.statements()).hasSize(4);
    }
}
```

Run: `[mvn] test -Dtest='ClaimAnswerTest,ClaimLeakTest,CaseStatementsTest,CaseEndpointTest,LostParityTest,RecoveryClaimPlanTest' 2>&1 | tail -15`
Expected: FAIL — `GET /cases/{code} executed 4 statements (ceiling 3)` for the owner, `no statement ceiling for POST /cases/{code}/claims/{claimId}`.

- [ ] **Step 4: Implement the answer**

`B/src/main/java/co/scuby/cases/ClaimAnswerRequest.java`:

```java
package co.scuby.cases;

import com.fasterxml.jackson.annotation.JsonProperty;
import org.jspecify.annotations.Nullable;

/** AnswerClaimRequest (web/src/contracts/owner.ts). A string, not an enum: a wrong value is a body error after the claim lookup. */
record ClaimAnswerRequest(@JsonProperty(required = true) @Nullable String status) {}
```

In `RecoveryClaimQueries.java` add:

```java
    record AnswerTarget(UUID createdBy, @Nullable UUID claimId, @Nullable String claimStatus) {}

    /** The case's owner and, when it is on this case, the claim and its stored status (one statement). */
    Optional<AnswerTarget> answerTarget(String code, Optional<UUID> claimId) {
        return db.select(LOST_CASE.CREATED_BY, RECOVERY_CLAIM.ID, RECOVERY_CLAIM.STATUS)
                 .from(LOST_CASE)
                 .leftJoin(RECOVERY_CLAIM).on(RECOVERY_CLAIM.CASE_CODE.eq(LOST_CASE.CODE),
                         claimId.map(RECOVERY_CLAIM.ID::eq).orElse(DSL.falseCondition()))
                 .where(LOST_CASE.CODE.eq(code))
                 .fetchOptional(r -> new AnswerTarget(r.value1(), r.value2(), r.value3()));
    }

    /** The answer, unless it is already the stored one (status <> ?): repeating an answer writes nothing. */
    void answer(String code, UUID claimId, String status, Instant now) {
        db.update(RECOVERY_CLAIM)
          .set(RECOVERY_CLAIM.STATUS, status)
          .set(RECOVERY_CLAIM.ANSWERED_AT, now.atOffset(ZoneOffset.UTC))
          .where(RECOVERY_CLAIM.ID.eq(claimId), RECOVERY_CLAIM.CASE_CODE.eq(code), RECOVERY_CLAIM.STATUS.ne(status))
          .execute();
    }
```

In `RecoveryClaimService.java` add a constructor dependency `OwnerAccess owners` (field + parameter, assigned), and the method:

```java
    /**
     * The owner's verdict (L1 design §4.10). Order: case not_found → forbidden → the claim is on this case (not_found) → the
     * body. Any case status (a purged case has no row: not_found). Revisable; repeating the stored answer writes nothing.
     * Confirming never closes the case (only reunite does) and leaves the other claims as they are.
     */
    CreatedView answer(String rawCode, String rawClaimId, UUID me, ClaimAnswerRequest body) {
        String code = OwnerAccess.code(rawCode);
        RecoveryClaimQueries.AnswerTarget target = owners.require(queries.answerTarget(code, OwnerAccess.id(rawClaimId)),
                RecoveryClaimQueries.AnswerTarget::createdBy, me);
        if (target.claimId() == null) throw CaseErrors.notFound("claim");
        if (!ClaimDerivation.isAnswer(body.status())) throw CaseErrors.invalidField("status", "confirmed or dismissed");
        if (ClaimDerivation.answerChanges(target.claimStatus(), body.status())) queries.answer(code, target.claimId(), body.status(), clock.instant());
        return new CreatedView(target.claimId().toString());
    }
```

In `RecoveryClaimController.java` add:

```java
    /** answerRecoveryClaim: 200 {id: the claim id}. */
    @PostMapping("/cases/{code}/claims/{claimId}")
    CreatedView answer(@PathVariable String code, @PathVariable String claimId, Account account, @RequestBody ClaimAnswerRequest body) {
        return service.answer(code, claimId, account.personId(), body);
    }
```

In `CasesSecurityRules.authorize` add:

```java
        rules.requestMatchers(HttpMethod.POST, "/cases/*/claims/*").authenticated();
```

In `StatementCeilings` replace the `"GET /cases/{code}"` entry with

```java
            Map.entry("GET /cases/{code}", 4),   // the owner, exactly 4 on a session-cache miss (CaseStatementsTest, ClaimLeakTest with 56 claims): session lookup, case (+ pet, publisher), sightings, the owner's claims (L1 design §4.13: up from 3); a signed-in stranger 3, anonymous 2. Excludes the flag snapshot load
```

and add

```java
            Map.entry("POST /cases/{code}/claims/{claimId}", 3),   // exactly 3 on a session-cache miss (ClaimAnswerTest): session, pre-read (case + claim), update; a repeated answer 2
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `[mvn] test -Dtest='ClaimAnswerTest,ClaimLeakTest,CaseStatementsTest,CaseEndpointTest,LostParityTest,RecoveryClaimPlanTest,LostCaseDerivationTest,RecoveryClaimTest,ContractCoverageTest,RequiredFieldsTest' 2>&1 | tail -20`
Expected: PASS. `RecoveryClaimPlanTest` now checks the production query: it must still name `recovery_claim_by_case_recent_idx` (record the plan in the report).

- [ ] **Step 6: Run the whole suite and commit**

Run: `[mvn] verify 2>&1 | tail -10` — Expected: `BUILD SUCCESS`, PIT ≥ 80 %.

```bash
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 add \
  backend/src/main/java/co/scuby/cases/ClaimAnswerRequest.java backend/src/main/java/co/scuby/cases/RecoveryClaimQueries.java \
  backend/src/main/java/co/scuby/cases/RecoveryClaimService.java backend/src/main/java/co/scuby/cases/RecoveryClaimController.java \
  backend/src/main/java/co/scuby/cases/LostCaseFacts.java backend/src/main/java/co/scuby/cases/LostCaseQueries.java \
  backend/src/main/java/co/scuby/cases/CaseReads.java backend/src/main/java/co/scuby/cases/LostCaseView.java \
  backend/src/main/java/co/scuby/cases/LostCaseDerivation.java backend/src/main/java/co/scuby/cases/CasesSecurityRules.java \
  backend/src/test/java/co/scuby/support/StatementCeilings.java \
  backend/src/test/java/co/scuby/cases/LostCaseDerivationTest.java backend/src/test/java/co/scuby/cases/CaseStatementsTest.java \
  backend/src/test/java/co/scuby/cases/CaseEndpointTest.java backend/src/test/java/co/scuby/cases/LostParityTest.java \
  backend/src/test/java/co/scuby/cases/RecoveryClaimPlanTest.java \
  backend/src/test/java/co/scuby/cases/ClaimAnswerTest.java backend/src/test/java/co/scuby/cases/ClaimLeakTest.java
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 commit -m "feat: the owner answers claims and sees them on the case page; the count is owner-only"
```

---
### Task 11: The badge on the feed and «Mis casos» — `possible_find` and `open_claim_count`

`GET /feed` gives `possible_find` only for items the caller published (a correlated `EXISTS` of an open non-stale claim), an inline `NULL` for every other item and for anonymous callers; `GET /me/cases` counts open non-stale claims per active case (0 otherwise) and stays a non-null int (spec §4.13). Both keep their ceilings (3 and 2).

**Files:**
- Modify: `B/src/main/java/co/scuby/cases/FeedRow.java`, `FeedView.java`, `FeedQueries.java`, `FeedReads.java`, `FeedController.java`, `FeedDerivation.java`
- Modify: `B/src/main/java/co/scuby/cases/MyCaseRow.java`, `MyCasesQueries.java`, `MyCasesController.java`, `MyCasesDerivation.java`
- Modify tests: `FeedDerivationTest.java`, `FeedEndpointTest.java`, `FeedPlanTest.java`, `CaseSightingsPlanTest.java`, `OwnCasesPlanTest.java`, `MyCasesDerivationTest.java`, `MyCasesEndpointTest.java`
- Test: `B/src/test/java/co/scuby/cases/FeedBadgeTest.java`, `ClaimCountPlanTest.java`

**Interfaces:**
- Consumes: `ClaimDerivation.staleCutoff` (Task 2); `CaseFixtures.claim` (Task 9); `SeedVolume.claims` (Task 1); `Caller`.
- Produces:
  - `FeedRow` gains a last component `@Nullable Boolean possibleFind`; `FeedView.FeedItem.possibleFind` becomes `@Nullable Boolean`.
  - `FeedQueries.localQuery(GeoPoint near, @Nullable String species, double radiusM, int limit, @Nullable UUID viewer, Instant now)`, `FeedQueries.nationalQuery(@Nullable String species, int limit, @Nullable UUID viewer, Instant now)`; `static Field<Boolean> possibleFind(@Nullable UUID viewer, Instant now)`.
  - `FeedReads.feed(FeedQuery query, Caller caller, Locale locale)`.
  - `MyCaseRow` gains a last component `int openClaimCount`; `MyCasesQueries.query(UUID personId, Instant now)`, `fetch(UUID personId, Instant now)`; `static Field<Integer> openClaims(Instant now)`.

- [ ] **Step 1: Update the existing tests to the new shapes and write the failing badge tests**

`FeedDerivationTest.java`: in `row(...)` replace `new GeoPoint(6.2442, -75.580392), T, count, last);` with `new GeoPoint(6.2442, -75.580392), T, count, last, null);`; in `englishTextAndAnUnnamedPet` replace `new GeoPoint(4.7, -74.0), T, 0, null);` with `new GeoPoint(4.7, -74.0), T, 0, null, null);`; replace `        assertThat(a.possibleFind()).isFalse();` with `        assertThat(a.possibleFind()).isNull();`; and add:

```java
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource(nullValues = "null", value = {"true", "false", "null"})
    void possibleFindPassesThroughAsTheQueryComputedIt(Boolean value) {
        var r = new FeedRow("AAAAA", "Luna", "cat", "small", List.of(), null, null, new GeoPoint(6.2442, -75.580392), T, 0, null, value);
        assertThat(FeedDerivation.derive(List.of(r), FeedDerivation.Scope.national, Locale.forLanguageTag("es")).items().getFirst().possibleFind())
                .isEqualTo(value);
    }
```

`FeedEndpointTest.java`: replace `        assertThat(r.json().at("/items/0/possible_find").asBoolean()).isFalse();` with `        assertThat(r.isNull("/items/0/possible_find")).as("owner-only").isTrue();`.

`FeedPlanTest.java` and `CaseSightingsPlanTest.java`: replace `nationalQuery(null, 100)` with `nationalQuery(null, 100, null, co.scuby.support.MutableClock.START)`.

`OwnCasesPlanTest.java`: replace `queries.query(UUID.fromString("00000000-0000-0000-0002-000000000007"))` with `queries.query(UUID.fromString("00000000-0000-0000-0002-000000000007"), co.scuby.support.MutableClock.START)`.

`MyCasesDerivationTest.java`: append `, 0` as the last argument of every `new MyCaseRow(…)` (five places: lines building `row`, the two `H4PPY` rows, `a` and `b`), and add:

```java
    @Test
    void theOpenClaimCountComesFromTheRow() {
        var row = new MyCaseRow("7K3PQ", "active", T, null, "Luna", "cat", "small", List.of(), null, 2);
        assertThat(MyCasesDerivation.derive(List.of(row), ES).getFirst().openClaimCount()).isEqualTo(2);
    }
```

`MyCasesEndpointTest.java`: add

```java
    @Test
    void openClaimCountCountsOpenNonStaleClaimsOnActiveCasesOnly() {
        cases.luna(carolina);                                                                   // active
        cases.lostCase(carolina, "EXP22", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "active", MutableClock.START.minusSeconds(86_400 * 5));
        cases.close("EXP22", "expired", MutableClock.START.minusSeconds(86_400));
        UUID a = accounts.person("andres@correo.co");
        UUID b = accounts.person("laura@correo.co");
        cases.claim("7K3PQ", a, "+573001112233", MutableClock.START.minusSeconds(3600), "open");
        cases.claim("7K3PQ", b, "+573001112244", MutableClock.START.minusSeconds(60), "open");
        cases.claim("7K3PQ", accounts.person("pedro@correo.co"), "+573001112255", MutableClock.START.minus(java.time.Duration.ofDays(8)), "open");
        cases.claim("7K3PQ", accounts.person("ana@correo.co"), "+573001112266", MutableClock.START.minusSeconds(60), "dismissed");
        cases.claim("7K3PQ", accounts.person("julian@correo.co"), "+573001112277", MutableClock.START.minus(java.time.Duration.ofDays(9)),
                MutableClock.START.minusSeconds(600), "open");                                 // made 9 days ago, repeated 10 min ago: fresh
        cases.claim("EXP22", a, "+573001112233", MutableClock.START.minusSeconds(3600), "open");
        ApiResponse r = cold(carolinaBrowser);
        assertThat(codes(r)).containsExactly("7K3PQ", "EXP22");
        assertThat(r.json().at("/0/open_claim_count").asInt()).as("two open, one refreshed, one stale, one dismissed").isEqualTo(3);
        assertThat(r.json().at("/1/open_claim_count").asInt()).as("not active").isZero();
        assertThat(r.statements()).hasSize(2);
    }
```

`B/src/test/java/co/scuby/cases/FeedBadgeTest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.cache.ClearableCache;
import co.scuby.platform.flags.FeatureFlags;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import tools.jackson.databind.JsonNode;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** possible_find (spec §3, §4.13; decision #76): the publisher's items only; null for everyone else. Leak test of §7.1 for the feed. */
@IntegrationTest
class FeedBadgeTest {

    static final Instant NOW = MutableClock.START;

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient carolinaBrowser;
    ApiClient claimant;

    @BeforeEach
    void setUp() {
        carolinaBrowser = clients.newBrowser();
        UUID carolina = accounts.signIn(carolinaBrowser, "carolina@correo.co");
        claimant = clients.newBrowser();
        UUID andres = accounts.signIn(claimant, "andres@correo.co");
        UUID julian = accounts.person("julian@correo.co");
        cases.luna(carolina);                                                                                         // open claim
        cases.lostCase(carolina, "STL22", "Mia", "cat", CaseFixtures.MEDELLIN, 300, "active", NOW.minusSeconds(3600));   // stale claim only
        cases.lostCase(carolina, "CNF22", "Max", "dog", CaseFixtures.MEDELLIN, 300, "active", NOW.minusSeconds(7200));   // confirmed only
        cases.lostCase(julian, "OTH22", "Otro", "dog", CaseFixtures.MEDELLIN, 300, "active", NOW.minusSeconds(60));      // someone else's
        cases.lostCase(carolina, "RFR22", "Nube", "cat", CaseFixtures.MEDELLIN, 300, "active", NOW.minusSeconds(5400));  // a refreshed claim only
        cases.claim("7K3PQ", andres, "+573001112233", NOW.minus(Duration.ofHours(1)), "open");
        cases.claim("STL22", andres, "+573001112233", NOW.minus(Duration.ofDays(8)), "open");
        cases.claim("CNF22", andres, "+573001112233", NOW.minus(Duration.ofDays(1)), "confirmed");
        cases.claim("OTH22", andres, "+573001112233", NOW.minus(Duration.ofHours(1)), "open");
        cases.claim("RFR22", andres, "+573001112233", NOW.minus(Duration.ofDays(9)), NOW.minus(Duration.ofHours(2)), "open");
    }

    private static JsonNode item(ApiResponse feed, String code) {
        for (JsonNode i : feed.json().get("items")) if (i.get("code").asString().equals(code)) return i;
        throw new AssertionError(code + " not in the feed: " + feed.body());
    }

    @Test
    void anonymousStrangerAndClaimantGetNullOnEveryItem() {
        ApiClient stranger = clients.newBrowser();
        accounts.signIn(stranger, "stranger@correo.co");
        for (ApiClient viewer : new ApiClient[] {clients.newBrowser(), stranger, claimant}) {
            ApiResponse feed = viewer.get("/feed");
            assertThat(feed.json().get("items")).hasSize(5);
            feed.json().get("items").forEach(i -> assertThat(i.get("possible_find").isNull()).as(i.toString()).isTrue());
        }
    }

    @Test
    void thePublisherSeesTheBadgeOnlyForAnOpenNonStaleClaimAndNullOnOthersItems() {
        ApiResponse feed = carolinaBrowser.get("/feed");
        assertThat(item(feed, "7K3PQ").get("possible_find").asBoolean()).isTrue();
        assertThat(item(feed, "STL22").get("possible_find").asBoolean()).as("stale does not count").isFalse();
        assertThat(item(feed, "CNF22").get("possible_find").asBoolean()).as("answered does not count").isFalse();
        assertThat(item(feed, "STL22").get("possible_find").isNull()).isFalse();
        assertThat(item(feed, "RFR22").get("possible_find").asBoolean()).as("made 9 days ago, repeated 2 h ago: fresh").isTrue();
        assertThat(item(feed, "OTH22").get("possible_find").isNull()).as("someone else's item").isTrue();
    }

    @Test
    void theBadgeDoesNotChangeTheFeedsOrderOrMembership() {
        // A claim never reduces reach (docs/product/04): the same five items in the same order for everyone.
        assertThat(codes(carolinaBrowser.get("/feed"))).hasSize(5).isEqualTo(codes(clients.newBrowser().get("/feed")));
    }

    private static java.util.List<String> codes(ApiResponse feed) {
        java.util.List<String> out = new java.util.ArrayList<>();
        feed.json().get("items").forEach(i -> out.add(i.get("code").asString()));
        return out;
    }

    @Test
    void theStatementCountIsUnchanged() {
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        assertThat(carolinaBrowser.get("/feed").statements()).as("national: session, the query").hasSize(2);
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        assertThat(carolinaBrowser.get("/feed?lat=6.25&lng=-75.59").statements()).as("local hit").hasSize(2);
    }
}
```

`B/src/test/java/co/scuby/cases/ClaimCountPlanTest.java`:

```java
package co.scuby.cases;

import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.PlanAssert;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The correlated open-claim counts of the publisher's feed items and of «Mis casos» (spec §4.13) must not scan every claim:
 * they go through recovery_claim_by_case_recent_idx or the partial recovery_claim_one_open_per_claimant (both lead with
 * case_code; which one the planner picks is its call). 2,000 cases of one seed publisher, 62,000 claims.
 */
@IntegrationTest
class ClaimCountPlanTest {

    static final UUID SEED_PUBLISHER = UUID.fromString("00000000-0000-0000-0000-000000000001");

    @Autowired DSLContext db;
    @Autowired FeedQueries feed;
    @Autowired MyCasesQueries myCases;

    @BeforeEach
    void setUp() {
        SeedVolume.casesAndSightings(db, 2_000, 2_000);
        SeedVolume.claims(db, 2_000, 60_000, "C000A", 2_000);
    }

    @Test
    void thePublishersFeedBadgeDoesNotScanTheClaims() {
        var q = feed.nationalQuery(null, 100, SEED_PUBLISHER, MutableClock.START);
        PlanAssert.assertNoSeqScan(db, q, "recovery_claim");
        assertReadThroughAClaimIndex(q);
    }

    @Test
    void misCasosCountsDoNotScanTheClaims() {
        var q = myCases.query(SEED_PUBLISHER, MutableClock.START);
        PlanAssert.assertNoSeqScan(db, q, "recovery_claim");
        assertReadThroughAClaimIndex(q);
    }

    /** By index name, as the plan checks require: either of the two indexes leading with case_code. */
    private void assertReadThroughAClaimIndex(org.jooq.Query q) {
        assertThat(PlanAssert.plan(db, q)).containsAnyOf(" using recovery_claim_by_case_recent_idx ",
                " using recovery_claim_one_open_per_claimant ", "Bitmap Index Scan on recovery_claim_");
    }
}
```

Run: `[mvn] test -Dtest='FeedBadgeTest,ClaimCountPlanTest,FeedDerivationTest,MyCasesDerivationTest,MyCasesEndpointTest' 2>&1 | tail -10`
Expected: FAIL — compilation errors: `FeedRow` takes 11 arguments, `nationalQuery(String,int)` has no 4-argument form, `MyCaseRow` takes 9 arguments.

- [ ] **Step 2: Implement the feed badge**

`FeedRow.java` — replace the record with:

```java
record FeedRow(String code, @Nullable String petName, String species, @Nullable String size, List<String> colors,
               @Nullable String firstPhotoUrl, @Nullable String placeName, GeoPoint center, Instant lastSeenAt,
               int sightingsCount, @Nullable Instant lastSightingAt, @Nullable Boolean possibleFind) {}
```

`FeedView.java` — in `FeedItem`, replace `boolean possibleFind` with `@Nullable Boolean possibleFind`.

`FeedDerivation.java` — replace `r.lastSeenAt(), false, r.sightingsCount(), r.lastSightingAt(), null)).toList());` with `r.lastSeenAt(), r.possibleFind(), r.sightingsCount(), r.lastSightingAt(), null)).toList());` and add to the class javadoc: `possible_find is computed by the query, owner-only (FeedQueries.possibleFind).`

`FeedQueries.java` — add the imports `java.time.Instant`, `java.time.ZoneOffset`, `java.util.UUID`, `org.jooq.impl.SQLDataType`, `static co.scuby.db.generated.Tables.RECOVERY_CLAIM`; replace `localQuery`, `nationalQuery`, `fetch` and `base` with:

```java
    /**
     * possible_find (decision #76): for an item the viewer published, whether an open non-stale claim exists (correlated
     * EXISTS, served by an index leading with case_code); for every other item, and for anonymous viewers, NULL — so the
     * claims of other people's cases are never queried. The feed only shows active cases, so no status test is needed here.
     */
    static Field<Boolean> possibleFind(@Nullable UUID viewer, Instant now) {
        if (viewer == null) return DSL.inline((Boolean) null, SQLDataType.BOOLEAN).as("possible_find");
        var openNonStale = DSL.exists(DSL.selectOne().from(RECOVERY_CLAIM)
                .where(RECOVERY_CLAIM.CASE_CODE.eq(LOST_CASE.CODE), RECOVERY_CLAIM.STATUS.eq(DSL.inline("open")),
                       RECOVERY_CLAIM.LAST_ACTIVE_AT.ge(ClaimDerivation.staleCutoff(now).atOffset(ZoneOffset.UTC))));
        return DSL.when(LOST_CASE.CREATED_BY.eq(viewer), DSL.field(openNonStale)).as("possible_find");
    }

    Select<? extends Record> localQuery(GeoPoint near, @Nullable String species, double radiusM, int limit, @Nullable UUID viewer, Instant now) {
        Field<Double> distance = Spatial.distanceMeters(LOST_CASE.LAST_SEEN_PUBLIC_POINT, Spatial.geography(near));
        Field<Integer> band = DSL.when(distance.le(2_000.0), 0).when(distance.le(5_000.0), 1)
                                 .when(distance.le(10_000.0), 2).otherwise(3);
        return base(species, viewer, now)
                .and(Spatial.withinMeters(LOST_CASE.LAST_SEEN_PUBLIC_POINT, Spatial.geography(near), radiusM))
                .orderBy(band, LOST_CASE.PUBLISHED_AT.desc(), LOST_CASE.CODE)
                .limit(limit);
    }

    Select<? extends Record> nationalQuery(@Nullable String species, int limit, @Nullable UUID viewer, Instant now) {
        return base(species, viewer, now).orderBy(LOST_CASE.PUBLISHED_AT.desc(), LOST_CASE.CODE).limit(limit);
    }

    List<FeedRow> fetch(Select<? extends Record> query) {
        return query.fetch(r -> new FeedRow(
                r.get(LOST_CASE.CODE), r.get(PET.NAME), r.get(PET.SPECIES), r.get(PET.SIZE),
                Arrays.asList(r.get(PET.COLORS)),
                r.get(PET.PHOTO_URLS).length == 0 ? null : r.get(PET.PHOTO_URLS)[0],
                r.get(LOST_CASE.PLACE_NAME), new GeoPoint(r.get(LOST_CASE.LAST_SEEN_PUBLIC_LAT), r.get(LOST_CASE.LAST_SEEN_PUBLIC_LNG)),
                r.get(LOST_CASE.LAST_SEEN_AT).toInstant(), r.get(SIGHTINGS),
                r.get(LAST_SIGHTING) == null ? null : r.get(LAST_SIGHTING).toInstant(),
                r.get("possible_find", Boolean.class)));
    }

    private SelectConditionStep<Record> base(@Nullable String species, @Nullable UUID viewer, Instant now) {
        Condition speciesFilter = species == null ? DSL.noCondition() : PET.SPECIES.eq(species);
        return db.select(List.of(LOST_CASE.CODE, LOST_CASE.PLACE_NAME, LOST_CASE.LAST_SEEN_PUBLIC_LAT, LOST_CASE.LAST_SEEN_PUBLIC_LNG,
                         LOST_CASE.LAST_SEEN_AT, PET.NAME, PET.SPECIES, PET.SIZE, PET.COLORS, PET.PHOTO_URLS,
                         SIGHTINGS, LAST_SIGHTING, possibleFind(viewer, now)))
                 .from(LOST_CASE).join(PET).on(PET.ID.eq(LOST_CASE.PET_ID))
                 // Inline literal: a bind parameter here would make the partial indexes (WHERE status = 'active')
                 // unusable under pgjdbc's generic prepared plans (backend/CLAUDE.md · Migrations and indexes).
                 .where(LOST_CASE.STATUS.eq(DSL.inline("active"))).and(speciesFilter);
    }
```

`FeedReads.java` — add the imports `co.scuby.platform.security.Caller`, `java.time.Clock`, `java.time.Instant`; add a `Clock clock` field and constructor parameter; replace `feed` with:

```java
    FeedView feed(FeedQuery query, Caller caller, Locale locale) {
        if (query.vertical() != null && query.vertical() != Vertical.lost) {
            return FeedDerivation.derive(List.of(), FeedDerivation.Scope.national, locale);
        }
        String species = query.species() == null ? null : query.species().name();
        Instant now = clock.instant();
        if (query.lat() != null && query.lng() != null) {
            List<FeedRow> near = queries.fetch(queries.localQuery(new GeoPoint(query.lat(), query.lng()), species,
                    properties.nearRadiusM(), properties.maxItems(), caller.personId(), now));
            if (!near.isEmpty()) return FeedDerivation.derive(near, FeedDerivation.Scope.local, locale);
        }
        return FeedDerivation.derive(queries.fetch(queries.nationalQuery(species, properties.maxItems(), caller.personId(), now)),
                FeedDerivation.Scope.national, locale);
    }
```

`FeedController.java` — add the import `co.scuby.platform.security.Caller`; replace the handler with:

```java
    @GetMapping("/feed")
    FeedView feed(@Valid FeedQuery query, Caller caller, Locale locale) {
        return reads.feed(query, caller, locale);
    }
```

- [ ] **Step 3: Implement the «Mis casos» count**

`MyCaseRow.java` — replace the record with:

```java
record MyCaseRow(String code, String status, Instant publishedAt, @Nullable String placeName, @Nullable String petName,
                 String species, @Nullable String size, List<String> colors, @Nullable String firstPhotoUrl, int openClaimCount) {}
```

`MyCasesDerivation.java` — replace `                0, null)).toList();` with `                r.openClaimCount(), null)).toList();` and change the javadoc to: `The caller's case rows (already ordered newest first) → MyCases items. Pure. open_claim_count comes from the query (open, non-stale claims on an active case, else 0); no check-ins in L1: pending_checkin_at null.`

`MyCasesQueries.java` — add the imports `org.jooq.Field`, `org.jooq.impl.DSL`, `java.time.Instant`, `java.time.ZoneOffset`, `static co.scuby.db.generated.Tables.RECOVERY_CLAIM`; replace `query` and `fetch` with:

```java
    /** Open, non-stale claims of an active case (a correlated count on an index leading with case_code), else 0. The list is the caller's own. */
    static Field<Integer> openClaims(Instant now) {
        return DSL.when(LOST_CASE.STATUS.eq(DSL.inline("active")),
                        DSL.field(DSL.selectCount().from(RECOVERY_CLAIM)
                                .where(RECOVERY_CLAIM.CASE_CODE.eq(LOST_CASE.CODE), RECOVERY_CLAIM.STATUS.eq(DSL.inline("open")),
                                       RECOVERY_CLAIM.LAST_ACTIVE_AT.ge(ClaimDerivation.staleCutoff(now).atOffset(ZoneOffset.UTC)))))
                  .otherwise(DSL.inline(0))
                  .as("open_claim_count");
    }

    Select<? extends Record> query(UUID personId, Instant now) {
        return db.select(LOST_CASE.CODE, LOST_CASE.STATUS, LOST_CASE.PUBLISHED_AT, LOST_CASE.PLACE_NAME,
                         PET.NAME, PET.SPECIES, PET.SIZE, PET.COLORS, PET.PHOTO_URLS, openClaims(now))
                 .from(LOST_CASE).join(PET).on(PET.ID.eq(LOST_CASE.PET_ID))
                 .where(LOST_CASE.CREATED_BY.eq(personId))
                 .orderBy(LOST_CASE.PUBLISHED_AT.desc(), LOST_CASE.CODE);
    }

    List<MyCaseRow> fetch(UUID personId, Instant now) {
        return query(personId, now).fetch(r -> new MyCaseRow(
                r.get(LOST_CASE.CODE), r.get(LOST_CASE.STATUS), r.get(LOST_CASE.PUBLISHED_AT).toInstant(),
                r.get(LOST_CASE.PLACE_NAME), r.get(PET.NAME), r.get(PET.SPECIES), r.get(PET.SIZE),
                Arrays.asList(r.get(PET.COLORS)),
                r.get(PET.PHOTO_URLS).length == 0 ? null : r.get(PET.PHOTO_URLS)[0],
                r.get("open_claim_count", Integer.class)));
    }
```

`MyCasesController.java` — add the import `java.time.Clock`, a `Clock clock` field and constructor parameter, and replace the handler body with `return MyCasesDerivation.derive(queries.fetch(account.personId(), clock.instant()), locale);`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `[mvn] test -Dtest='FeedBadgeTest,ClaimCountPlanTest,FeedDerivationTest,FeedEndpointTest,FeedStatementsTest,FeedPlanTest,CaseSightingsPlanTest,OwnCasesPlanTest,MyCasesDerivationTest,MyCasesEndpointTest,LostParityTest' 2>&1 | tail -20`
Expected: PASS. Record the two `ClaimCountPlanTest` plans (which index the correlated subplans use) in the report. `FeedPlanTest` must still use `lost_case_active_published_idx` (the anonymous query adds only an inline NULL).

- [ ] **Step 5: Run the whole suite and commit**

Run: `[mvn] verify 2>&1 | tail -10` — Expected: `BUILD SUCCESS`, PIT ≥ 80 %.

```bash
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 add \
  backend/src/main/java/co/scuby/cases/FeedRow.java backend/src/main/java/co/scuby/cases/FeedView.java \
  backend/src/main/java/co/scuby/cases/FeedQueries.java backend/src/main/java/co/scuby/cases/FeedReads.java \
  backend/src/main/java/co/scuby/cases/FeedController.java backend/src/main/java/co/scuby/cases/FeedDerivation.java \
  backend/src/main/java/co/scuby/cases/MyCaseRow.java backend/src/main/java/co/scuby/cases/MyCasesQueries.java \
  backend/src/main/java/co/scuby/cases/MyCasesController.java backend/src/main/java/co/scuby/cases/MyCasesDerivation.java \
  backend/src/test/java/co/scuby/cases/FeedDerivationTest.java backend/src/test/java/co/scuby/cases/FeedEndpointTest.java \
  backend/src/test/java/co/scuby/cases/FeedPlanTest.java backend/src/test/java/co/scuby/cases/CaseSightingsPlanTest.java \
  backend/src/test/java/co/scuby/cases/OwnCasesPlanTest.java backend/src/test/java/co/scuby/cases/MyCasesDerivationTest.java \
  backend/src/test/java/co/scuby/cases/MyCasesEndpointTest.java backend/src/test/java/co/scuby/cases/FeedBadgeTest.java \
  backend/src/test/java/co/scuby/cases/ClaimCountPlanTest.java
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 commit -m "feat: possible_find on the publisher's feed items and open_claim_count in «Mis casos», owner-only"
```

---
### Task 12: `GET /me/pets`

The caller's pets for the publish pet picker and «Mis mascotas» (spec §4.11): the active owner links, each with the caller's active case and the latest case expired within 30 days (only when none is active), in one query through `responsibility_link_by_person_active_idx`. Lives in `cases` (it reads `lost_case`).

**Files:**
- Create: `B/src/main/java/co/scuby/cases/MyPetsQueries.java`, `MyPetsController.java`
- Modify: `B/src/test/java/co/scuby/support/CaseFixtures.java` (add `ownedPet`, `unlink`)
- Modify: `CasesSecurityRules`, `StatementCeilings`, `MyPetsPlanTest.java` (the production query)
- Test: `B/src/test/java/co/scuby/cases/MyPetsEndpointTest.java`

**Interfaces:**
- Consumes: `MyPetRow`, `MyPetView`, `MyPetsDerivation.derive` (Task 3); `LostLifecycleDerivation.reopenCutoff` (Task 2); `CaseFixtures.close/lostCaseForPet/petOf` (Task 4); `ApiClient.patch` (Task 4).
- Produces: `MyPetsQueries.query(UUID me, Instant now) → Select<? extends Record>`, `fetch(UUID me, Instant now) → List<MyPetRow>`; `CaseFixtures.ownedPet(UUID owner, @Nullable String name, Instant createdAt) → UUID`, `CaseFixtures.unlink(UUID pet, Instant at)`; ceiling `GET /me/pets` 2.

- [ ] **Step 1: Write the failing test**

Add to `CaseFixtures.java`:

```java
    /** A dog owned by {@code owner}, with no case (name may be null: a found animal's pet has none). */
    public UUID ownedPet(UUID owner, @Nullable String name, Instant createdAt) {
        UUID pet = UUID.randomUUID();
        db.insertInto(PET).set(PET.ID, pet).set(PET.NAME, name).set(PET.SPECIES, "dog").set(PET.SIZE, (String) null)
          .set(PET.CUSTODY_STATE, "claimed").set(PET.CREATED_AT, createdAt.atOffset(ZoneOffset.UTC)).execute();
        db.insertInto(RESPONSIBILITY_LINK).set(RESPONSIBILITY_LINK.ID, UUID.randomUUID())
          .set(RESPONSIBILITY_LINK.PERSON_ID, owner).set(RESPONSIBILITY_LINK.PET_ID, pet)
          .set(RESPONSIBILITY_LINK.ROLE, "owner").set(RESPONSIBILITY_LINK.ACTIVE_FROM, createdAt.atOffset(ZoneOffset.UTC)).execute();
        return pet;
    }

    /** Ends the pet's active owner link. */
    public void unlink(UUID pet, Instant at) {
        db.update(RESPONSIBILITY_LINK).set(RESPONSIBILITY_LINK.ACTIVE_TO, at.atOffset(ZoneOffset.UTC))
          .where(RESPONSIBILITY_LINK.PET_ID.eq(pet), RESPONSIBILITY_LINK.ACTIVE_TO.isNull()).execute();
    }
```

`B/src/test/java/co/scuby/cases/MyPetsEndpointTest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.cache.ClearableCache;
import co.scuby.platform.flags.FeatureFlags;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import tools.jackson.databind.JsonNode;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** GET /me/pets (spec §4.11): the caller's active owner links, their active and reopenable codes, by case activity. */
@IntegrationTest
class MyPetsEndpointTest {

    static final Instant NOW = MutableClock.START;

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient carolinaBrowser;
    UUID carolina;

    @BeforeEach
    void setUp() {
        carolinaBrowser = clients.newBrowser();
        carolina = accounts.signIn(carolinaBrowser, "carolina@correo.co");
    }

    private static Instant daysAgo(long d) {
        return NOW.minus(Duration.ofDays(d));
    }

    private static List<String> names(ApiResponse r) {
        List<String> out = new ArrayList<>();
        r.json().forEach(p -> out.add(p.get("name").asString()));
        return out;
    }

    private static JsonNode pet(ApiResponse r, String name) {
        for (JsonNode p : r.json()) if (p.get("name").asString().equals(name)) return p;
        throw new AssertionError(name + " not listed: " + r.body());
    }

    private ApiResponse cold() {
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        return carolinaBrowser.get("/me/pets");
    }

    @Test
    void eachPetWithItsActiveOrReopenableCaseOrderedByCaseActivity() {
        cases.luna(carolina);                                                                             // active 7K3PQ, published 2 days ago
        UUID luna = cases.petOf("7K3PQ");
        cases.lostCaseForPet(carolina, luna, "LUN22", "expired", daysAgo(10));                            // expired 9 days ago: hidden by the active one
        cases.lostCase(carolina, "TOB22", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "active", daysAgo(10));
        cases.close("TOB22", "expired", daysAgo(3));
        cases.lostCaseForPet(carolina, cases.petOf("TOB22"), "TOB11", "expired", daysAgo(20));            // older expiry: not the latest
        cases.lostCase(carolina, "MIA22", "Mia", "cat", CaseFixtures.MEDELLIN, 300, "active", daysAgo(20));
        cases.close("MIA22", "reunited", daysAgo(19));
        cases.lostCase(carolina, "MAX22", "Max", "dog", CaseFixtures.MEDELLIN, 300, "active", daysAgo(50));
        cases.close("MAX22", "expired", daysAgo(40));                                                    // outside the window
        cases.ownedPet(carolina, null, daysAgo(100));                                                     // no case, no name
        cases.ownedPet(carolina, "Nube", daysAgo(50));                                                    // no case, newer pet: before the nameless one

        ApiResponse r = carolinaBrowser.get("/me/pets");
        assertThat(r.status()).isEqualTo(200);
        assertThat(names(r)).as("case activity desc, nulls last, then pet.created_at desc").containsExactly("Luna", "Toby", "Mia", "Max", "Nube", "");
        assertThat(pet(r, "Luna").get("active_case_code").asString()).isEqualTo("7K3PQ");
        assertThat(pet(r, "Luna").get("reopenable_case_code").isNull()).isTrue();
        assertThat(pet(r, "Toby").get("active_case_code").isNull()).isTrue();
        assertThat(pet(r, "Toby").get("reopenable_case_code").asString()).isEqualTo("TOB22");
        assertThat(pet(r, "Mia").get("reopenable_case_code").isNull()).as("reunited is not reopenable").isTrue();
        assertThat(pet(r, "Max").get("reopenable_case_code").isNull()).as("40 days").isTrue();
        assertThat(pet(r, "").get("active_case_code").isNull()).isTrue();
        assertThat(pet(r, "Luna").get("species").asString()).isEqualTo("dog");
        assertThat(pet(r, "Luna").get("size").asString()).isEqualTo("small");
        assertThat(pet(r, "Luna").get("colors").toString()).isEqualTo("[\"black\",\"tan\"]");
        assertThat(pet(r, "Luna").get("photo_urls")).hasSize(1);
        assertThat(pet(r, "Luna").get("id").asString()).isEqualTo(luna.toString());
    }

    @Test
    void theWindowIsThirtyDaysInclusive() {
        cases.lostCase(carolina, "EDG30", "Edge", "dog", CaseFixtures.MEDELLIN, 300, "active", daysAgo(40));
        cases.close("EDG30", "expired", daysAgo(30));
        cases.lostCase(carolina, "EDG31", "Past", "dog", CaseFixtures.MEDELLIN, 300, "active", daysAgo(40));
        cases.close("EDG31", "expired", daysAgo(30).minusMillis(1));
        ApiResponse r = carolinaBrowser.get("/me/pets");
        assertThat(pet(r, "Edge").get("reopenable_case_code").asString()).isEqualTo("EDG30");
        assertThat(pet(r, "Past").get("reopenable_case_code").isNull()).isTrue();
    }

    @Test
    void onlyTheCallersOwnCasesCount() {
        UUID julian = accounts.person("julian@correo.co");
        cases.lostCase(carolina, "TOB22", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "active", daysAgo(10));
        cases.close("TOB22", "expired", daysAgo(3));
        cases.lostCaseForPet(julian, cases.petOf("TOB22"), "JUL22", "active", daysAgo(1));   // someone else's active case of the same pet
        ApiResponse r = carolinaBrowser.get("/me/pets");
        assertThat(pet(r, "Toby").get("active_case_code").isNull()).isTrue();
        assertThat(pet(r, "Toby").get("reopenable_case_code").asString()).isEqualTo("TOB22");
    }

    @Test
    void endedLinksAndOtherPeoplesPetsAreNotListed() {
        UUID given = cases.ownedPet(carolina, "Regalado", daysAgo(5));
        cases.unlink(given, daysAgo(1));
        cases.lostCase(accounts.person("julian@correo.co"), "JUL22", "DeJulian", "dog", CaseFixtures.MEDELLIN, 300, "active", daysAgo(1));
        cases.ownedPet(carolina, "Mía", daysAgo(2));
        assertThat(names(carolinaBrowser.get("/me/pets"))).containsExactly("Mía");
    }

    @Test
    void anEditOfACaseShowsOnThePet() {
        cases.luna(carolina);
        assertThat(carolinaBrowser.patch("/lost-cases/{code}", "{\"marks\":\"Collar azul\"}", "7K3PQ").status()).isEqualTo(204);
        assertThat(pet(carolinaBrowser.get("/me/pets"), "Luna").get("marks").asString()).isEqualTo("Collar azul");
    }

    @Test
    void noPetsIsAnEmptyListAndNobodySignedInIsUnauthorized() {
        assertThat(carolinaBrowser.get("/me/pets").json()).isEmpty();
        ApiResponse anon = clients.newBrowser().get("/me/pets");
        assertThat(anon.status()).isEqualTo(401);
        assertThat(anon.errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void theStatementCountIsTwoWithOnePetOrTwenty() {
        cases.lostCase(carolina, "P0000", "P0", "dog", CaseFixtures.MEDELLIN, 300, "active", daysAgo(1));
        ApiResponse one = cold();
        assertThat(one.json()).hasSize(1);
        assertThat(one.statements()).as("%s", one.statements()).hasSize(2);   // session lookup, the pets query
        for (int i = 1; i < 20; i++) {
            cases.lostCase(carolina, "P%04d".formatted(i), "P" + i, "dog", CaseFixtures.MEDELLIN, 300, "active", daysAgo(i + 1));
            if (i % 2 == 0) cases.close("P%04d".formatted(i), "expired", daysAgo(i));
        }
        ApiResponse twenty = cold();
        assertThat(twenty.json()).hasSize(20);
        assertThat(twenty.statements()).hasSize(2);
    }
}
```

In `MyPetsPlanTest.java`: add `@Autowired MyPetsQueries queries;`, replace `var q = myPets(OWNER_7);` with `var q = queries.query(OWNER_7, MutableClock.START);`, delete the `myPets` method and the now-unused imports (`Select`, `DSL`, `Duration`, `ZoneOffset`, `LOST_CASE`, `PET`, `RESPONSIBILITY_LINK`), and change the javadoc's last sentence to `The production query (MyPetsQueries.query) is the one checked.`

Run: `[mvn] test -Dtest='MyPetsEndpointTest,MyPetsPlanTest' 2>&1 | tail -10`
Expected: FAIL — `cannot find symbol: class MyPetsQueries`.

- [ ] **Step 2: Implement**

`B/src/main/java/co/scuby/cases/MyPetsQueries.java`:

```java
package co.scuby.cases;

import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.Select;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.RESPONSIBILITY_LINK;

/**
 * GET /me/pets in one query (L1 design §4.11): the caller's active owner links, joined to the pet and to the caller's own
 * lost cases of it. Found through responsibility_link_by_person_active_idx (MyPetsPlanTest); active_to IS NULL is a literal
 * predicate (isNull), status and role literals are inline.
 */
@Component
class MyPetsQueries {

    private final DSLContext db;

    MyPetsQueries(DSLContext db) {
        this.db = db;
    }

    Select<? extends Record> query(UUID me, Instant now) {
        OffsetDateTime cutoff = LostLifecycleDerivation.reopenCutoff(now).atOffset(ZoneOffset.UTC);
        Field<OffsetDateTime> lastActivity = DSL.max(DSL.greatest(LOST_CASE.PUBLISHED_AT, LOST_CASE.RESOLVED_AT));
        return db.select(PET.ID, PET.NAME, PET.SPECIES, PET.SIZE, PET.COLORS, PET.MARKS, PET.PHOTO_URLS, PET.CREATED_AT,
                         DSL.max(LOST_CASE.CODE).filterWhere(LOST_CASE.STATUS.eq(DSL.inline("active"))).as("active_case_code"),
                         DSL.arrayAgg(LOST_CASE.CODE).orderBy(LOST_CASE.RESOLVED_AT.desc())
                            .filterWhere(LOST_CASE.STATUS.eq(DSL.inline("expired")).and(LOST_CASE.RESOLVED_AT.ge(cutoff)))
                            .as("reopenable_codes"),
                         lastActivity.as("last_activity"))
                 .from(RESPONSIBILITY_LINK)
                 .join(PET).on(PET.ID.eq(RESPONSIBILITY_LINK.PET_ID))
                 .leftJoin(LOST_CASE).on(LOST_CASE.PET_ID.eq(PET.ID), LOST_CASE.CREATED_BY.eq(me))
                 .where(RESPONSIBILITY_LINK.PERSON_ID.eq(me), RESPONSIBILITY_LINK.ROLE.eq(DSL.inline("owner")),
                        RESPONSIBILITY_LINK.ACTIVE_TO.isNull())
                 .groupBy(PET.ID)
                 .orderBy(lastActivity.desc().nullsLast(), PET.CREATED_AT.desc(), PET.ID);
    }

    List<MyPetRow> fetch(UUID me, Instant now) {
        return query(me, now).fetch(r -> {
            String[] reopenable = r.get("reopenable_codes", String[].class);
            return new MyPetRow(r.get(PET.ID), r.get(PET.NAME), r.get(PET.SPECIES), r.get(PET.SIZE), Arrays.asList(r.get(PET.COLORS)),
                    r.get(PET.MARKS), Arrays.asList(r.get(PET.PHOTO_URLS)), r.get("active_case_code", String.class),
                    reopenable == null || reopenable.length == 0 ? null : reopenable[0]);
        });
    }
}
```

`B/src/main/java/co/scuby/cases/MyPetsController.java`:

```java
package co.scuby.cases;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Account;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Clock;
import java.util.List;

/** listMyPets: no transaction, one autocommit read. In cases because it reads lost_case (L1 design §5). */
@ApiComponent
@RestController
class MyPetsController {

    private final MyPetsQueries queries;
    private final Clock clock;

    MyPetsController(MyPetsQueries queries, Clock clock) {
        this.queries = queries;
        this.clock = clock;
    }

    @GetMapping("/me/pets")
    List<MyPetView> mine(Account account) {
        return MyPetsDerivation.derive(queries.fetch(account.personId(), clock.instant()));
    }
}
```

In `CasesSecurityRules.authorize` add `        rules.requestMatchers(HttpMethod.GET, "/me/pets").authenticated();` (identity's `/me/**` also covers it; cases declares its own route).

In `StatementCeilings` add:

```java
            Map.entry("GET /me/pets", 2),   // exactly 2 on a session-cache miss, 1 or 20 pets (MyPetsEndpointTest): session lookup, the pets query
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `[mvn] test -Dtest='MyPetsEndpointTest,MyPetsPlanTest,MyPetsDerivationTest,ContractCoverageTest' 2>&1 | tail -15`
Expected: PASS; `MyPetsPlanTest` still names `responsibility_link_by_person_active_idx` for the production query (record the plan).

- [ ] **Step 4: Run the whole suite and commit**

Run: `[mvn] verify 2>&1 | tail -10` — Expected: `BUILD SUCCESS`.

```bash
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 add \
  backend/src/main/java/co/scuby/cases/MyPetsQueries.java backend/src/main/java/co/scuby/cases/MyPetsController.java \
  backend/src/main/java/co/scuby/cases/CasesSecurityRules.java backend/src/test/java/co/scuby/support/CaseFixtures.java \
  backend/src/test/java/co/scuby/support/StatementCeilings.java backend/src/test/java/co/scuby/cases/MyPetsEndpointTest.java \
  backend/src/test/java/co/scuby/cases/MyPetsPlanTest.java
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 commit -m "feat: GET /me/pets — the caller's pets with their active or reopenable case, in one query"
```

---
### Task 13: `PATCH /me/profile`

The caller edits their profile (spec §4.12): PATCH semantics, the chosen-name rule (sending a name marks it chosen, decision #48), the no-links bio, `city` ≤ 80, the four notification switches, and a profile photo checked through a `platform` interface (identity may not depend on uploads). One `UPDATE … RETURNING *`; the answer is the same `Profile` as `GET /me/profile`.

**Files:**
- Create: `B/src/main/java/co/scuby/platform/media/ProfilePhotos.java`, `B/src/main/java/co/scuby/uploads/ProfilePhotoCheck.java`
- Create: `B/src/main/java/co/scuby/identity/ProfileUpdates.java`
- Modify: `B/src/main/java/co/scuby/identity/People.java` (`ProfileChange`, `updateProfile`), `ProfileController.java` (PATCH)
- Modify: `StatementCeilings`
- Test: `B/src/test/java/co/scuby/identity/ProfileUpdateTest.java`

**Interfaces:**
- Consumes: `ProfileUpdateRequest`, `ProfileTextDerivation` (Task 3); `Patch<T>` (Task 3); `Photos.uploaded` (Task 5); `PhotoAttachments.requireAttachable`, `UploadPurpose.profile`; `People.get(UUID)`, `ProfileView.of(Person)`; `Caller`, `Account`.
- Produces:
  - `public interface platform.media.ProfilePhotos { void requireAttachable(String url, Caller caller, String field); }` — implemented by `uploads.ProfilePhotoCheck` (`@Component`, `@ModuleApi` not needed: injected by type).
  - `record People.ProfileChange(Patch<String> displayName, Patch<String> city, Patch<String> bio, @Nullable ProfileUpdateRequest.NotificationPrefsInput prefs, Patch<String> photoUrl)` (package-private) and `Person People.updateProfile(UUID id, ProfileChange change)`.
  - `ProfileUpdates.update(Account account, Caller caller, ProfileUpdateRequest body) → ProfileView`.
  - Ceiling `PATCH /me/profile` 4.

- [ ] **Step 1: Write the failing test**

`B/src/test/java/co/scuby/identity/ProfileUpdateTest.java`:

```java
package co.scuby.identity;

import co.scuby.platform.cache.ClearableCache;
import co.scuby.platform.flags.FeatureFlags;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.Photos;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.ZoneOffset;
import java.util.UUID;

import static co.scuby.db.generated.Tables.PERSON;
import static org.assertj.core.api.Assertions.assertThat;

/** PATCH /me/profile (docs/eng/auth.md · Profile; spec §4.12). */
@IntegrationTest
class ProfileUpdateTest {

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired ObjectProvider<ClearableCache> caches;

    ApiClient api;
    UUID ana;

    @BeforeEach
    void setUp() {
        api = clients.newBrowser();
        ana = accounts.signIn(api, "ana.gomez@correo.co");
        db.update(PERSON).set(PERSON.CITY, "Medellín").set(PERSON.BIO, "Hola").where(PERSON.ID.eq(ana)).execute();
    }

    private ApiResponse update(String json) {
        return api.patch("/me/profile", json);
    }

    private Record person() {
        return db.selectFrom(PERSON).where(PERSON.ID.eq(ana)).fetchOne();
    }

    private ApiResponse cold(java.util.function.Supplier<ApiResponse> call) {
        caches.orderedStream().filter(c -> !(c instanceof FeatureFlags)).forEach(ClearableCache::clear);
        return call.get();
    }

    private void assertUnchanged() {
        Record p = person();
        assertThat(p.get(PERSON.DISPLAY_NAME)).isEqualTo("ana.gomez");
        assertThat(p.get(PERSON.DISPLAY_NAME_CHOSEN)).isFalse();
        assertThat(p.get(PERSON.CITY)).isEqualTo("Medellín");
        assertThat(p.get(PERSON.BIO)).isEqualTo("Hola");
        assertThat(p.get(PERSON.PHOTO_URL)).isNull();
    }

    @Test
    void sentFieldsAreStoredTheNameTrimmedAndChosenAndTheAnswerIsTheProfile() {
        ApiResponse r = update("{\"display_name\":\"  Ana María Gómez \",\"city\":\"Envigado\",\"bio\":\"Rescatista de gatos en Envigado.\","
                + "\"notification_prefs\":{\"lost\":true,\"found\":false,\"adoption\":false,\"help\":true}}");
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/display_name")).isEqualTo("Ana María Gómez");
        assertThat(r.str("/email")).isEqualTo("ana.gomez@correo.co");
        assertThat(r.str("/city")).isEqualTo("Envigado");
        assertThat(r.str("/bio")).isEqualTo("Rescatista de gatos en Envigado.");
        assertThat(r.json().at("/notification_prefs/found").asBoolean()).isFalse();
        assertThat(r.json().at("/notification_prefs/help").asBoolean()).isTrue();
        Record p = person();
        assertThat(p.get(PERSON.DISPLAY_NAME)).isEqualTo("Ana María Gómez");
        assertThat(p.get(PERSON.DISPLAY_NAME_CHOSEN)).isTrue();
        assertThat(p.get(PERSON.NOTIFY_ADOPTION)).isFalse();
        assertThat(api.get("/me/profile").body()).isEqualTo(r.body());
    }

    @Test
    void sendingTheCurrentNameUnchangedStillMarksItChosenAndItBecomesPublic() {
        cases.luna(ana);
        assertThat(clients.newBrowser().get("/cases/{code}", "7K3PQ").str("/contact/display_name")).isEqualTo("Alguien");
        assertThat(update("{\"display_name\":\"ana.gomez\"}").status()).isEqualTo(200);
        assertThat(person().get(PERSON.DISPLAY_NAME_CHOSEN)).isTrue();
        assertThat(clients.newBrowser().get("/cases/{code}", "7K3PQ").str("/contact/display_name")).isEqualTo("ana.gomez");
    }

    @Test
    void theNameIsReadLiveOnEveryCaseOfThePerson() {
        cases.luna(ana);
        cases.lostCase(ana, "TOB22", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "active", MutableClock.START.minusSeconds(3600));
        update("{\"display_name\":\"Ana María Gómez\"}");
        for (String code : new String[] {"7K3PQ", "TOB22"}) {
            assertThat(clients.newBrowser().get("/cases/{code}", code).str("/contact/display_name")).as(code).isEqualTo("Ana M.");
        }
    }

    @Test
    void absentFieldsStayAndAnEmptyBodyAnswersTheProfileWithoutAWrite() {
        ApiResponse r = cold(() -> update("{}"));
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/city")).isEqualTo("Medellín");
        assertThat(r.statements()).as("%s", r.statements()).hasSize(2);   // session, person read
        assertUnchanged();
        update("{\"city\":\"Bello\"}");
        assertThat(person().get(PERSON.BIO)).isEqualTo("Hola");
        assertThat(person().get(PERSON.DISPLAY_NAME_CHOSEN)).as("only sending a name marks it chosen").isFalse();
    }

    @Test
    void nullClearsCityBioAndPhoto() {
        db.update(PERSON).set(PERSON.PHOTO_URL, "http://localhost/dev-media/" + "c".repeat(64) + ".jpg").where(PERSON.ID.eq(ana)).execute();
        ApiResponse r = update("{\"city\":null,\"bio\":null,\"photo_url\":null}");
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.isNull("/city")).isTrue();
        assertThat(r.isNull("/bio")).isTrue();
        assertThat(r.isNull("/photo_url")).isTrue();
        assertThat(person().get(PERSON.PHOTO_URL)).isNull();
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(delimiter = '|', value = {
            "{\"display_name\":\"   \"}                                                         | display_name",
            "{\"display_name\":null}                                                            | display_name",
            "{\"city\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"} | city",
            "{\"bio\":\"Escríbeme a wa.me/573001112233\"}                                       | bio",
            "{\"bio\":\"Mi web: ana.com\"}                                                      | bio",
            "{\"notification_prefs\":null}                                                      | notification_prefs",
            "{\"notification_prefs\":{\"lost\":null,\"found\":true,\"adoption\":true,\"help\":true}} | notification_prefs.lost",
            "{\"photo_url\":\" \"}                                                              | photo_url",
    })
    void aBrokenFieldIsValidationFailedNamingItAndNothingIsWritten(String json, String field) {
        ApiResponse r = update(json);
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has(field)).as(r.body()).isTrue();
        assertUnchanged();
    }

    @Test
    void lengthsAreCharactersLikePostgres() {
        assertThat(update("{\"display_name\":\"" + "🐶".repeat(80) + "\",\"bio\":\"" + "a".repeat(280) + "\"}").status()).isEqualTo(200);
        assertThat(update("{\"display_name\":\"" + "a".repeat(81) + "\"}").json().at("/error/fields").has("display_name")).isTrue();
        assertThat(update("{\"bio\":\"" + "a".repeat(281) + "\"}").json().at("/error/fields").has("bio")).isTrue();
    }

    @Test
    void anAbsentNotificationSwitchIsAJacksonErrorNamingIt() {
        ApiResponse r = update("{\"notification_prefs\":{\"lost\":true,\"found\":true,\"adoption\":true}}");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.json().at("/error/fields").has("notification_prefs.help")).as(r.body()).isTrue();
        assertUnchanged();
    }

    @Test
    void theCurrentPhotoIsAcceptedAsItIsWithoutAnUploadLookup() {
        String current = Photos.uploaded(api, "profile", "ana-current");
        db.update(PERSON).set(PERSON.PHOTO_URL, current).where(PERSON.ID.eq(ana)).execute();
        db.execute("DELETE FROM scuby.upload");   // its slot is gone: only "it is the current one" can accept it now
        ApiResponse r = cold(() -> update("{\"photo_url\":\"" + current + "\"}"));
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/photo_url")).isEqualTo(current);
        assertThat(r.statements()).as("%s", r.statements()).hasSize(3);   // session, person read, update
    }

    @Test
    void aNewPhotoMustBeTheCallersProfileUpload() {
        String mine = Photos.uploaded(api, "profile", "ana-new");
        ApiResponse ok = cold(() -> update("{\"photo_url\":\"" + mine + "\"}"));
        assertThat(ok.status()).isEqualTo(200);
        assertThat(ok.str("/photo_url")).isEqualTo(mine);
        assertThat(ok.statements()).as("the worst path: %s", ok.statements()).hasSize(4);   // session, person read, upload lookup, update
        String forAPet = Photos.uploaded(api, "pet", "ana-pet");
        ApiClient other = clients.newBrowser();
        accounts.signIn(other, "laura@correo.co");
        String someoneElses = Photos.uploaded(other, "profile", "laura-photo");
        for (String url : new String[] {forAPet, someoneElses, "http://localhost/dev-media/" + "0".repeat(64) + ".jpg"}) {
            ApiResponse r = update("{\"photo_url\":\"" + url + "\"}");
            assertThat(r.status()).as(url).isEqualTo(422);
            assertThat(r.json().at("/error/fields").has("photo_url")).isTrue();
        }
        assertThat(person().get(PERSON.PHOTO_URL)).isEqualTo(mine);
    }

    @Test
    void thePhoneInTheAnswerIsTheVerifiedOne() {
        db.update(PERSON).set(PERSON.PHONE, "+573007152284").where(PERSON.ID.eq(ana)).execute();
        assertThat(update("{\"city\":\"Bello\"}").isNull("/phone")).isTrue();
        db.update(PERSON).set(PERSON.PHONE_VERIFIED_AT, MutableClock.START.atOffset(ZoneOffset.UTC)).where(PERSON.ID.eq(ana)).execute();
        assertThat(update("{\"city\":\"Bello\"}").str("/phone")).isEqualTo("+573007152284");
    }

    @Test
    void eachAccountUpdatesOnlyItselfAndNobodySignedInIsUnauthorized() {
        ApiClient other = clients.newBrowser();
        UUID laura = accounts.signIn(other, "laura@correo.co");
        other.patch("/me/profile", "{\"city\":\"Bello\"}");
        assertThat(person().get(PERSON.CITY)).isEqualTo("Medellín");
        assertThat(db.select(PERSON.CITY).from(PERSON).where(PERSON.ID.eq(laura)).fetchOne(PERSON.CITY)).isEqualTo("Bello");
        ApiResponse anon = clients.newBrowser().patch("/me/profile", "{\"city\":\"Bello\"}");
        assertThat(anon.status()).isEqualTo(401);
        assertUnchanged();
    }
}
```

Run: `[mvn] test -Dtest=ProfileUpdateTest 2>&1 | tail -10`
Expected: FAIL — `no statement ceiling for PATCH /me/profile`.

- [ ] **Step 2: Implement**

`B/src/main/java/co/scuby/platform/media/ProfilePhotos.java`:

```java
package co.scuby.platform.media;

import co.scuby.platform.security.Caller;

/**
 * The profile-photo check identity needs without depending on uploads (foundations depend only on platform, as
 * RequestAuthenticator does for the session filter). uploads implements it: the photo must be this caller's processed
 * upload for purpose `profile`; else validation_failed on {@code field}. Never call it inside a transaction (S3 in staging).
 */
public interface ProfilePhotos {
    void requireAttachable(String url, Caller caller, String field);
}
```

`B/src/main/java/co/scuby/uploads/ProfilePhotoCheck.java`:

```java
package co.scuby.uploads;

import co.scuby.platform.media.ProfilePhotos;
import co.scuby.platform.security.Caller;
import org.springframework.stereotype.Component;

import java.util.List;

/** ProfilePhotos through PhotoAttachments with purpose `profile` (Propagation.NEVER is kept: PhotoAttachments is called as a bean). */
@Component
class ProfilePhotoCheck implements ProfilePhotos {

    private final PhotoAttachments attachments;

    ProfilePhotoCheck(PhotoAttachments attachments) {
        this.attachments = attachments;
    }

    @Override
    public void requireAttachable(String url, Caller caller, String field) {
        attachments.requireAttachable(List.of(url), UploadPurpose.profile, caller, field);
    }
}
```

In `B/src/main/java/co/scuby/identity/People.java` add the imports `co.scuby.platform.web.Patch`, `org.jooq.Field`, `java.util.LinkedHashMap`, `java.util.Map`, and:

```java
    /** A profile update: each Patch absent = unchanged; prefs null = unchanged. */
    record ProfileChange(Patch<String> displayName, Patch<String> city, Patch<String> bio,
                         ProfileUpdateRequest.@Nullable NotificationPrefsInput prefs, Patch<String> photoUrl) {}

    /**
     * One UPDATE … RETURNING with only the sent fields. Sending a display name marks it chosen (decision #48): from then on it
     * is the public name. There is no way back to "not chosen". Nothing sent: the current row.
     */
    Person updateProfile(UUID id, ProfileChange change) {
        Map<Field<?>, Object> set = new LinkedHashMap<>();
        if (change.displayName().isPresent()) {
            set.put(PERSON.DISPLAY_NAME, change.displayName().value());
            set.put(PERSON.DISPLAY_NAME_CHOSEN, true);
        }
        if (change.city().isPresent()) set.put(PERSON.CITY, change.city().value());
        if (change.bio().isPresent()) set.put(PERSON.BIO, change.bio().value());
        if (change.prefs() != null) {
            set.put(PERSON.NOTIFY_LOST, change.prefs().lost());
            set.put(PERSON.NOTIFY_FOUND, change.prefs().found());
            set.put(PERSON.NOTIFY_ADOPTION, change.prefs().adoption());
            set.put(PERSON.NOTIFY_HELP, change.prefs().help());
        }
        if (change.photoUrl().isPresent()) set.put(PERSON.PHOTO_URL, change.photoUrl().value());
        if (set.isEmpty()) return get(id);
        return db.update(PERSON).set(set).where(PERSON.ID.eq(id)).returning().fetchOptional().map(People::toPerson)
                 .orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED, "the account no longer exists"));
    }
```

`B/src/main/java/co/scuby/identity/ProfileUpdates.java`:

```java
package co.scuby.identity;

import co.scuby.platform.media.ProfilePhotos;
import co.scuby.platform.security.Account;
import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import co.scuby.platform.web.Patch;
import org.springframework.stereotype.Service;

import java.util.Map;

/**
 * PATCH /me/profile (docs/eng/auth.md · Profile; L1 design §4.12). The field rules (ProfileTextDerivation), then the photo:
 * the current photo_url is accepted as it is, another must be this caller's `profile` upload (checked with no transaction
 * open: S3 in staging), then one UPDATE … RETURNING. The answer is ProfileView.of, exactly as GET /me/profile. The name is
 * read live everywhere (no cache holds it: ActiveSession caches only the person id and expiry).
 */
@Service
class ProfileUpdates {

    private final People people;
    private final ProfilePhotos photos;

    ProfileUpdates(People people, ProfilePhotos photos) {
        this.people = people;
        this.photos = photos;
    }

    ProfileView update(Account account, Caller caller, ProfileUpdateRequest body) {
        Map<String, String> problems = ProfileTextDerivation.problems(body);
        if (!problems.isEmpty()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "request does not match the contract", problems, Map.of());
        }
        String photo = body.photoUrl().value();
        if (photo != null && !photo.equals(people.get(account.personId()).photoUrl())) {
            photos.requireAttachable(photo, caller, "photo_url");
        }
        Patch<String> name = body.displayName().isPresent()
                ? Patch.of(ProfileTextDerivation.trimmedName(body.displayName().value()))
                : Patch.absent();
        return ProfileView.of(people.updateProfile(account.personId(), new People.ProfileChange(
                name, body.city(), body.bio(), body.notificationPrefs().value(), body.photoUrl())));
    }
}
```

In `B/src/main/java/co/scuby/identity/ProfileController.java`: add the imports `co.scuby.platform.security.Caller`, `org.springframework.web.bind.annotation.PatchMapping`, `org.springframework.web.bind.annotation.RequestBody`; add a `ProfileUpdates updates` field and constructor parameter; and the handler:

```java
    /** updateProfile: 200 Profile. Bound without @Valid: ProfileTextDerivation holds the rules (session first, by /me/**). */
    @PatchMapping("/me/profile")
    ProfileView update(Account account, Caller caller, @RequestBody ProfileUpdateRequest body) {
        return updates.update(account, caller, body);
    }
```

and change the class javadoc to `The caller's own profile (contract getProfile, updateProfile).`

In `StatementCeilings` add:

```java
            Map.entry("PATCH /me/profile", 4),   // worst path, ProfileUpdateTest: session, person read (only for a non-null photo_url), upload lookup (a new photo), UPDATE … RETURNING; {} is 2 (session, person read)
```

(`/me/**` is already `authenticated()` in `IdentitySecurityRules`; nothing to add.)

- [ ] **Step 3: Run the tests to verify they pass**

Run: `[mvn] test -Dtest='ProfileUpdateTest,ProfileEndpointTest,ProfileTextDerivationTest,ContractCoverageTest,RequiredFieldsTest,ArchitectureTest,CaseEndpointTest' 2>&1 | tail -15`
Expected: PASS. `ArchitectureTest` confirms identity → platform only (`ProfilePhotos`), uploads → platform. `ContractCoverageTest` now covers `PATCH /me/profile` anonymously → `401`.

- [ ] **Step 4: Run the whole suite and commit**

Run: `[mvn] verify 2>&1 | tail -10` — Expected: `BUILD SUCCESS`, PIT ≥ 80 % (record `ProfileTextDerivation`).

```bash
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 add \
  backend/src/main/java/co/scuby/platform/media/ProfilePhotos.java backend/src/main/java/co/scuby/uploads/ProfilePhotoCheck.java \
  backend/src/main/java/co/scuby/identity/ProfileUpdates.java backend/src/main/java/co/scuby/identity/People.java \
  backend/src/main/java/co/scuby/identity/ProfileController.java backend/src/test/java/co/scuby/support/StatementCeilings.java \
  backend/src/test/java/co/scuby/identity/ProfileUpdateTest.java
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 commit -m "feat: PATCH /me/profile — a sent name is chosen, the bio has no links, city ≤ 80, the profile photo through a platform interface"
```

---
### Task 14: Owning docs, the FE handoff, the e2e seed, and the final verification

The durable parts of the design land in their owning docs (spec §8): decision rows #71–#79, open items O34–O38, `product/04` (and the summaries in 01 and 02 in the same change), `eng/api.md`, `eng/auth.md`, `eng/backend.md`, and a handoff to the web client. The e2e seed gets the rows `@LINK-001`, `@PLOST-002` and `@PLOST-004` need (spec §7.6). Docs are self-contained: no task numbers, no references to this plan.

**Files:**
- Modify: `W/docs/product/00-product-map.md`, `W/docs/open-items.md`, `W/docs/product/04-lost-workflow.md`, `W/docs/product/01-actors-and-entities.md`, `W/docs/product/02-flows.md`, `W/docs/eng/api.md`, `W/docs/eng/auth.md`, `W/docs/eng/backend.md`
- Create: `W/docs/handoffs/<today>-backend-lost-l1-fe.md` (`<today>` = `date +%Y-%m-%d` on the day this task runs)
- Modify: `W/backend/e2e/seed.sql`

**Interfaces:**
- Consumes: everything above (the docs describe what Tasks 1–13 built; check each claim against the code before writing it).
- Produces: nothing code depends on.

- [ ] **Step 1: Decision log rows #71–#79**

In `W/docs/product/00-product-map.md`, insert after the row that starts `| 70 |` (the last row of the decision-log table):

```markdown
| 71 | Lost-case owner actions *(2026-11-01)* | **The owner of a lost case is `lost_case.created_by`. Reunite, cancel and reopen are one conditional `UPDATE` each, with no lock (#59). Reunite writes `resolution = reunited_home` and the attribution the owner picked (not checked against evidence); cancel writes `false_alarm` or `duplicate`. Reopen takes an `expired` case within 30 days of `resolved_at` (inclusive), clears the resolution data, keeps its sightings, its claims and its `published_at`, and never re-broadcasts. Reopen, and a claim that would reactivate a case, answer `active_case_exists` with the other case's code when the pet has another active case. A cancelled case is still served (`status: cancelled`, no contact). `Created.id` of a case action is the case code. The three actions are idempotent: reunite on a reunited case, cancel on a cancelled case and reopen on a case that is already active answer the same success and write nothing, so a retry after a lost response, a double tap or a race another request won never shows the anxious owner an error, and the first call's resolution and attribution are never overwritten; any other state stays `invalid_transition` (cancel or reopen on a reunited case).** Mechanics: [04](04-lost-workflow.md) · Case state machine | The responsibility link as the owner check (a transferred pet would hand its old cases to the new owner); refreshing `published_at` on reopen (a reopened case would jump to the top of the national feed); letting a reopen create a second active case for the pet; answering a repeat with `409` (the owner sees a failure after their action succeeded) |
| 72 | Editing a lost case *(2026-11-01, amends #27)* | **Photos and signs belong to the pet: an edit writes them through the pets feature, so they change on every case of that pet, past ones included. A moved last-seen point re-snaps the public center (#69) and resets the place name to the generic label; the place namer is not called (a network call). `last_seen_at` may be up to 5 minutes ahead, with no lower bound; existing sightings are not revalidated; an open claim never blocks an edit; only an `active` case can be edited.** Mechanics: [04](04-lost-workflow.md) · Editing a published case | Calling the place namer in the edit; copying the pet's fields onto the case; revalidating existing sightings against the new zone |
| 73 | A reporter's own pin *(2026-11-01)* | **A pin is "mine" when its reporter is the caller's person, or when it has no person and was sent from the caller's device. Another person's pin is never mine, whatever device sent it; an anonymous pin stays its reporter's after they sign in on the same browser — the passer-by who reported «Lo vi» without an account and then signs in to say «Lo tengo» keeps the pin, its correction window and the claim's link to it. The same rule for `mine`, `editable_until`, correction, delete and a claim's `from_sighting_id`. Correction and delete need the pin `visible` and inside its 15 minutes (a pin the owner hid is no longer the reporter's to change or to withdraw); correction also needs the case active, delete does not. Delete is the status `deleted_by_reporter`, never a hard delete: the row, its `client_id` (a replayed «Lo vi» answers the deleted pin's id) and any claim's `from_sighting_id` stay; the pin reaches nobody, the owner included. Deleting one's own deleted pin again answers the same success and writes nothing.** Mechanics: [04](04-lost-workflow.md) · Correction window; [api.md](../eng/api.md) · Device identity | Person-or-device for "mine" (a signed-in person could change another person's pin sent from a shared device); the session strictly winning (a reporter who signs in to claim loses their own anonymous pin); a hard delete (frees the replay key so a retried «Lo vi» creates a new pin, and breaks `sightings_count` and a claim's `from_sighting_id`) |
| 74 | Owner moderation of a pin *(2026-11-01)* | **The owner hides a pin (`hidden_by_owner`) or highlights it; the two are independent (a hidden pin can be highlighted), idempotent, and allowed in any case status. The owner still sees a hidden pin, with its contact. A pin removed by moderation or deleted by its reporter is `not_found` to the owner too.** Mechanics: [04](04-lost-workflow.md) · sighting | Letting the owner unhide a pin moderation removed |
| 75 | «Lo tengo» needs a session *(2026-11-01)* | **A claim needs a session: the claimant is a person (the client tells them it is for the owner's safety). One open claim per person per case, enforced by a partial unique index; a repeat while that claim is open — a stale one included — refreshes it with the repeat's phone, photos and pin, and makes it fresh again (`last_active_at`), so the person still holding the animal can come back with a new number after the owner went silent. A repeat on a case that is no longer active answers the case's refusal (`invalid_transition`, or `active_case_exists` naming the pet's live case), never the old claim. The owner cannot claim their own case (`forbidden`); a purged code is `gone`. No rate limit (as #54). Evidence is stored, not shown: photos, and a point copied from the claimant's own visible pin on the case from the last 24 hours ("mine" as #73). A `from_sighting_id` that does not qualify is ignored and the claim is stored without it: the link is attribution, never a reason to lose a claim. The answer carries the owner's WhatsApp link with a prefilled Spanish text («Hola, vi tu aviso de {nombre} en Scuby ({código}) y creo que lo tengo.») only under the public-contact rule; no `mailto:`. The contract's `claimRecovery` became `session` with `forbidden`, `active_case_exists` and `gone`, and `reopenCase` lists `active_case_exists`: the behaviour above answers them, so the contract lists them.** Mechanics: [04](04-lost-workflow.md) · recovery_claim | Anonymous claims with a phone only (nothing ties a claim to someone the owner or moderation can act on); a rate limit now (no abuse pattern seen yet); copying the sighting's photos onto the claim; answering a repeat with the old claim unchanged (the new number and photos were lost, and a stale claim stayed invisible); refusing the whole claim over an ineligible `from_sighting_id` |
| 76 | The claim badge is the owner's only *(2026-11-01)* | **`open_claim_count` on the case page and `possible_find` on feed items reach only the case's owner — `null` for anyone else, the claimant included — and count claims that are `open` and not stale, on an active case (the owner of a closed case gets `0` / `false`). Stale is derived, never stored: a claim still open 7 days after the claimant's last «Lo tengo» on it (`last_active_at`). «Mis casos» keeps a non-null count (it is always the owner's). The owner's `claims[]` holds the newest 50, with the derived status.** Why: «a claim must never reduce reach» ([04](04-lost-workflow.md) · Rule: a recovery claim must never reduce reach), and a public «Posible hallazgo» tells helpers the search may be over. Mechanics: [04](04-lost-workflow.md) · recovery_claim | A public badge (it reduces reach); denormalizing the count on the case; a stored `stale` status |
| 77 | The owner's answer to a claim *(2026-11-01)* | **The owner confirms or dismisses a claim at any time and in any case status, and may change the answer (`confirmed ↔ dismissed`); repeating the current answer writes nothing; a stale claim can be answered. Confirming never closes the case — only reunite does — and leaves the other claims as they are; several claims may be confirmed.** Mechanics: [04](04-lost-workflow.md) · recovery_claim | One-shot answers; dismissing the other claims when one is confirmed |
| 78 | «Mis mascotas» (`GET /me/pets`) *(2026-11-01)* | **The caller's active owner links, nameless pets included (`name: ""`), in one query. `active_case_code` is the caller's active case of the pet; `reopenable_case_code` is the latest of the caller's cases of it that expired within 30 days, only when none is active. Ordered by the latest publish or close among the caller's cases of the pet; pets without a case last.** Mechanics: [04](04-lost-workflow.md) · Publishing | A query per pet; listing every expired case |
| 79 | Profile update *(2026-11-01)* | **Sending a display name, even unchanged, marks it chosen, so it becomes the public name (#48); there is no way back. The bio refuses, case-insensitive, `http://`, `https://`, `www.`, `wa.me`, `tel:`, `mailto:` and any domain-shaped token (a word, a dot, two or more letters); «Hola.Soy» is an accepted false positive. `city` is free text of at most 80 characters until a cities table exists (O34). The four notification switches come together. A new profile photo must be the caller's own `profile` upload; the current one is accepted as it is.** Mechanics: [auth.md](../eng/auth.md) · Profile | Only the URL patterns (a bare `ana.com` or `wa.me/…` would pass); a cities table now (its only consumer, adoption, is not built) |
```

- [ ] **Step 2: Open items O34–O38**

In `W/docs/open-items.md`, insert after the row that starts `| O33 |` (the last row of the *Open — needs a decision* table):

```markdown
| O34 | **Cities and departments.** `person.city` is free text of at most 80 characters ([decision #79](product/00-product-map.md)). A table per country tied to `supported_countries`, an autocomplete endpoint, and a contract change of `city` to an id would let adoption filter by city. Source data: https://github.com/alejosuaza1022/Departamentos-municipios-Colombia-a-DB | [eng/auth.md](eng/auth.md) · Profile | Decide with the adoption vertical, its only consumer |
| O35 | **`found_deceased` and `gave_up`.** Both are resolution values of a lost case ([04](product/04-lost-workflow.md) · resolution values), but no endpoint writes them: cancel takes only `false_alarm` or `duplicate` ([decision #71](product/00-product-map.md)). | [04](product/04-lost-workflow.md) · resolution values · `web/src/contracts/endpoints/lost.ts` (`cancelCase`) | Proposed to the client: which endpoint or field carries them, and which status each closes into. The migration that adds them widens the `lost_case_resolution_fits_status` CHECK |
| O36 | **Claim evidence for the owner.** A claim stores its photos, a point and `from_sighting_id`, but the owner's `claims[]` shows only the phone, the time and the status ([decision #75](product/00-product-map.md)). | [04](product/04-lost-workflow.md) · recovery_claim · `web/src/contracts/case.ts` | Proposed to the client: expose them, to the owner only |
| O37 | **Reports are not implemented yet.** `POST /reports` (`sendReport`), its two auto-hide reasons and the «en revisión» state are answered only by the client's emulated backend. | [09](product/09-reporting.md) · O20 | Decide together with the operator tooling (O20) |
| O38 | **Shares are not implemented yet.** `POST /cases/{code}/shares` (`recordShare`) needs a table (one row per share opened, so its growth and purge must be decided) and is a metric for the background worker. | [10](product/10-sharing.md) · [eng/backend.md](eng/backend.md) · Async work | Decide with the background worker and the events table |
```

- [ ] **Step 3: `product/04`, and the summaries in 01 and 02**

In `W/docs/product/04-lost-workflow.md`:

(a) In `### sighting`, replace `` `status: visible | hidden_by_owner | removed_by_moderation`, `highlighted_by_owner: bool`, `` with `` `status: visible | hidden_by_owner | removed_by_moderation | deleted_by_reporter`, `highlighted_by_owner: bool`, ``.

(b) In the same section, replace `The phone that IS required stays the
anonymous «Lo tengo» phone — a claim's entire value is the contact channel; a sighting's is the pin.` with `The phone that IS required is the
«Lo tengo» claim's — a claim's entire value is the contact channel; a sighting's is the pin.`

(c) At the end of the **Correction window** paragraph (after `(remove) can take it off the map.`), add:

```markdown
A pin is "mine" when its reporter is my account, or when it has no account and was sent from this
browser (decision #73): another person's pin is never mine, and an anonymous pin stays mine after I
sign in here. The pin must still be `visible`: once the owner hides it, it is no longer the reporter's
to change or withdraw, and it disappears from the reporter's view too. A correction also needs the case
`active`; a delete does not. **A delete is a status**, `deleted_by_reporter`, never a hard delete: the
row stays, so its `client_id` stays taken (a replayed «Lo vi» answers it), `sightings_count` stays a
count of visible pins and a claim's `from_sighting_id` never dangles; the pin reaches nobody, the owner
included, and deleting it again is a no-op success. The owner hides and highlights pins independently,
in any case status; a pin moderation removed or its reporter deleted is invisible to the owner too
(decision #74).
```

(d) At the end of the **Editing a published case** paragraph (after `reopening comes first.`), add:

```markdown
The photos and signs are the **pet's**: an edit changes them on every case of that pet, past ones
included. A moved last-seen point re-snaps the public center (Location precision) and resets the place
name to the generic label. `last_seen_at` may be up to 5 minutes ahead; existing sightings are not
revalidated; an open claim never blocks an edit (decision #72).
```

(e) In `### recovery_claim`, replace the field line `` `case_id`, `claimant` (person or anonymous contact), `point?`, `photos[]`, `from_sighting_id?`, `` and the line after it (`` `status: open | confirmed | dismissed | stale`, `verifying_since?`, `stale_at`. ``) with:

```markdown
`case_id` (the case's code), `claimant` (a person: «Lo tengo» needs a session, decision #75), `phone`,
`point?`, `photos[]`, `from_sighting_id?`, `status: open | confirmed | dismissed`, `created_at`,
`last_active_at`, `answered_at?`. `stale` is derived, not stored: a claim still open 7 days after the
claimant's last «Lo tengo» on it (`last_active_at`). The check-in fields (`verifying_since`, `stale_at`)
arrive with the follow-up loop. One open claim per person per case: «Lo tengo» again, while it is open
(stale included), refreshes it — the new phone, photos and pin, and `last_active_at` — so it counts again
and the owner sees the claimant's current number. On a case that is no longer active the repeat gets the
case's answer (reactivated inside 30 days, or `active_case_exists` with the pet's live case), never the
old claim.
```

(f) In **Rule: «Lo tengo» always creates a claim before it opens a channel**, replace `The tempting implementation for anonymous users is a bare WhatsApp deep link` with `The tempting implementation is a bare WhatsApp deep link`, replace `The
anonymous path is the high-volume one; it cannot be the one we don't see.` with `The
stranger's path is the high-volume one; it cannot be the one we don't see.`, and replace the two numbered items (from `1. Anonymous: phone number (**required**` through `choose WhatsApp deep link or in-app thread.`) with:

```markdown
1. Not signed in: the sheet asks to sign in first, and says it is for the owner's safety.
2. Signed in: phone (**required** — a claim's entire value is the contact channel; a claim nobody can
   reach is worthless), photos optional → `recovery_claim` row → the WhatsApp deep link with the owner's
   number and a prefilled message when the owner's contact is public, else the in-app thread. The owner
   cannot claim their own case.
```

(g) In the **From sighting to claim** paragraph, replace `if a registered user with a visible sighting on this case **< 24h old** taps
it` with `if a signed-in user with a visible sighting on this case **< 24h old** (theirs by account, or
sent from this browser without an account) taps it`, and append to that paragraph: `A link that does not
qualify (another case, older, not theirs, hidden) is ignored: the claim is stored without it.`

(h) At the end of the paragraph that starts `The owner owes the claim an answer`, add: `The answer is revisable
(`confirmed ↔ dismissed`) and never closes the case — only reunite does (decision #77). The «posible
hallazgo» badge and its count are shown **to the owner only** (decision #76; Rule: a recovery claim must
never reduce reach). Reunite, cancel and reopen are idempotent: repeating one the case already reflects
is a success that changes nothing (decision #71).`

(i) In the *Rejected state* table, in the `pending_confirmation` row, replace `(index on `recovery_claim (case_id, status)`). A UI badge ("posible hallazgo"), not a status.` with `(read through `recovery_claim_by_case_recent_idx`). A UI badge ("posible hallazgo") for the owner only, not a status.`

(j) Under `### resolution values (set on terminal transition)`, after the attribution paragraph, add: `Written today: `reunited_home` (reunite) and `false_alarm` / `duplicate` (cancel). `no_response` arrives with expiry; `found_deceased` and `gave_up` wait for [O35](../open-items.md).`

(k) In the **Identity ladder** table, replace the row `| "Lo tengo" | ✓ — phone **required** → `recovery_claim` → WhatsApp deep link | ✓ — `recovery_claim` → WhatsApp **or** in-app thread |` with `| "Lo tengo" | ✗ — asked to sign in first, for the owner's safety (decision #75) | ✓ — phone **required** → `recovery_claim` → WhatsApp deep link **or** in-app thread |`.

In `W/docs/product/01-actors-and-entities.md`, replace the cell `None — phone number (required, not verified) → a `recovery_claim` row → owner's WhatsApp (owner opts into exposing it)` with `An account (sign-in; decision #75) + phone number (required, not verified) → a `recovery_claim` row → owner's WhatsApp (owner opts into exposing it)`, and in the same row replace `Helping needs no account, but the claim must exist` with `A sighting needs no account; a claim does (the owner deals with a person), and it must exist`.

In `W/docs/product/02-flows.md`, replace `always creates a `recovery_claim` first (anonymous: phone required)` with `needs a session, and always creates a `recovery_claim` first (phone required)`, and `The claim shows as a «posible hallazgo» badge` with `The claim shows as a «posible hallazgo» badge to the owner only`.

Run: `grep -n "anonymous «Lo tengo»\|Anonymous: phone number\|(anonymous: phone required)\|removed_by_moderation\`, \`highlighted" /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1/docs/product/0[124]*.md`
Expected: no output (every anonymous-claimant sentence is patched).

- [ ] **Step 4: `eng/api.md`, `eng/auth.md`, `eng/backend.md`**

`W/docs/eng/api.md`:

(a) In *Conventions*, after the bullet that starts `- **Responses are complete.**`, add:

```markdown
- **`Created.id`** is the case's code for a case action (reunite, cancel, reopen) and the row's id for a
  sighting or claim action (moderate, answer).
```

(b) In *Device identity*, replace the bullet that starts `- **What it identifies.** The anonymous reporter or claimant of a sighting or a «lo tengo»:` (through `It also scopes an anonymous upload slot (*Uploads*).`) with:

```markdown
- **What it identifies.** The anonymous reporter of a sighting: it authorizes correcting or deleting their
  own sighting inside its window, and marks it `mine` on the case. A pin is mine when its reporter is the
  session's person, **or** when it has no person and came from this device (decision #73): another
  person's pin is never mine on a shared device, and an anonymous pin stays mine after its reporter signs
  in on the same browser. A «lo tengo» claimant is always a person (decision #75); the same rule decides
  whether a claim's `from_sighting_id` is the claimant's own pin. There are no per-reporter rate limits for
  now ([04](../product/04-lost-workflow.md) · Validation). It also scopes an anonymous upload slot (*Uploads*).
```

(c) In the *Errors* table, replace the `forbidden` row's last cell `Signed in, but it is someone else's case, claim or notification` with `Signed in, but it is someone else's case, claim or notification; the owner claiming their own case; a pin that is not the caller's to correct or delete`; the `active_case_exists` row's last cell `The pet already has an active lost case; `details.case_code`` with `The pet already has an active lost case (publish, reopen, or a claim that would reactivate a case); `details.case_code``; and the `not_found · gone` row's last cell `Unknown · purged (a printed poster's code still resolves)` with `Unknown · purged (a printed poster's code still resolves: `GET /cases/:code` and «Lo tengo»; owner actions answer `not_found`)`.

(d) In the proposals list, delete the bullet that starts `- **@LINK-001** ends its first step` (its five lines), and replace the bullet that starts `- **Endpoints the e2e specs need beyond the first backend release**` (its three lines) with:

```markdown
- **Endpoints the e2e specs need** — the backend now implements `/me/pets`, case edit, reopen, claims and the
  profile update; Google sign-in (@AUTH-002, @PLOST-002, @PLOST-004) is still missing. «Lo tengo» needs a
  session: @HELP-002 and @HELP-005 sign in by email code before claiming, and the client's claim sheet must
  ask for sign-in.
```

`W/docs/eng/auth.md` · *Profile*: replace `whoever builds the profile update must mark the name as chosen, `person.display_name_chosen`)` with `sending a name in the profile update, even unchanged, marks it chosen, `person.display_name_chosen`; there is no way back, decision #79)`, and replace `` `city?` · `bio?` (~280 chars, plain text, **no links** — a bio with a
WhatsApp link bypasses contact prefs; it is a `report` target like any user content) `` with:

```markdown
`city?` (free text, at most 80 characters until a cities table exists, [O34](../open-items.md)) · `bio?`
(at most 280 characters, plain text, **no links**: `http://`, `https://`, `www.`, `wa.me`, `tel:`, `mailto:`
and any domain-shaped token such as `ana.com` are refused, case-insensitive — a bio with a WhatsApp link
bypasses contact prefs; it is a `report` target like any user content)
```

`W/docs/eng/backend.md`:

(a) *Concurrency*: after the bullet that starts `- **A sighting only on an active case.**`, add:

```markdown
- **Lifecycle transitions.** Reunite, cancel, reopen and edit are one conditional `UPDATE … WHERE code = ? AND
  created_by = ? AND status = …` each; a pre-read classifies the errors, and zero rows after it is the race loser,
  answered as one re-read classifies. Reunite, cancel, reopen and the reporter's delete are idempotent: a case or
  pin already in the action's target state answers the same success with no write — on the pre-read, or on the
  re-read when another request won the race — so a retry never overwrites the first call's resolution; another
  state is `invalid_transition`. A reopen — or a claim's reactivation — that loses to a publish of the same pet
  fails on `lost_case_one_active_per_pet`; the unique violation is caught by its constraint name and answered
  `active_case_exists`, never a `500`. An edit writes the pet first and the case last, as the guard, so a close
  that commits in between rolls the pet change back.
- **One open claim per claimant.** «Lo tengo» is one `INSERT … SELECT … FROM lost_case WHERE status = 'active' ON
  CONFLICT (case_code, claimant_person_id) WHERE status = 'open' DO UPDATE`: a repeat refreshes the open row (phone,
  photos, point, link, `last_active_at`) and returns its id; a double tap serializes on the index entry and
  leaves one row. Nothing is written, and nothing old is answered, when the case is not active. On an expired case
  the reactivation and the upsert run in one transaction, so the case row is held only until that write commits.
- **Accepted, not locked:** a claim or a correction can land on a case closed a moment earlier. The
  `INSERT … SELECT … WHERE status = 'active'` (and the correction's `EXISTS`) reads its snapshot, and the
  foreign-key check's `KEY SHARE` does not conflict with the close's `NO KEY UPDATE`, so a close committing in
  between does not stop it. The outcome is harmless — the badge counts active cases only and the case is
  closed — the same shape as «Lo vi» against a close. Do not "fix" it with a lock.
```

(b) In *Where a lock remains*, replace `A future path that closes or
edits a case holds its row only for its own `UPDATE`; it needs a race test against a signed-in sighting, and
a lock beyond that needs a decision-log row saying why an atomic statement does not do.` with `A path that closes or
edits a case holds its row only for its own `UPDATE` and has a race test against a signed-in sighting
(`CaseLifecycleRaceTest`, `EditLostRaceTest`); a lock beyond that needs a decision-log row saying why an atomic
statement does not do.`

(c) In *Race tests*, replace `(`CodeRaceTest`, `PublishLostTest`, `SightingRaceTest`)` with `(`CodeRaceTest`, `PublishLostTest`, `SightingRaceTest`, `CaseLifecycleRaceTest`, `EditLostRaceTest`, `RecoveryClaimRaceTest`, and the held-row cases of `SightingCorrectionTest` and `SightingDeleteTest`, through `support.Contention`)` and append to that paragraph: ` A close never waits for an uncommitted sighting; two claims on one expired case reactivate it once; a claim and a publish for the same pet leave exactly one active case; a double tap on «Lo tengo» stores one claim; a retried reunite keeps the first attribution; a reopen that meets a claim's reactivation answers 200 with the case active.`

(d) *Migrations and indexes: kept performance indexes*: append:

```markdown
Two more serve the lost vertical's owner reads. `recovery_claim_by_case_recent_idx (case_code, created_at DESC)`
serves the owner's claim list on every owner view of a case and the correlated open-claim counts of «Mis casos»
and of the owner's feed items (`V20261101_1030`; `RecoveryClaimPlanTest`, `ClaimCountPlanTest`); the partial UNIQUE
`recovery_claim_one_open_per_claimant` is the integrity index of «Lo tengo» and stays.
`responsibility_link_by_person_active_idx (person_id) WHERE active_to IS NULL` serves `GET /me/pets`
(`V20261101_1040`; `MyPetsPlanTest`).
```

(e) *Code structure*: after the **Request validation** paragraph, add:

```markdown
**PATCH bodies and the order of body checks.** A PATCH request record declares each field as
`platform.web.Patch<T>` (absent / null / a value), filled through Jackson's absent- and null-value hooks
(`PatchDeserializer`). An endpoint whose error order puts the body after the owner check binds its record
without `@Valid`, and the service runs `BodyValidation.require` (or a derivation's field rules) at that point;
only what Jackson cannot read (malformed JSON, a wrong JSON type, an absent required field) is answered before the
lookups. Enum-valued fields such as `resolution_attribution` bind as strings for that reason.
**Cross-foundation checks go through `platform` interfaces:** identity checks a profile photo through
`platform.media.ProfilePhotos`, implemented in uploads, as `RequestAuthenticator` does for the session filter.
```

- [ ] **Step 5: The handoff to the web client**

Create `W/docs/handoffs/<today>-backend-lost-l1-fe.md` (with `<today>` from `date +%Y-%m-%d`) with this content, `<today>` replaced in the title too:

```markdown
# Handoff to the web client: the lost vertical's owner and helper actions (<today>)

> **The source of truth is the code (`backend/`) and the contract [`docs/eng/openapi.json`](../eng/openapi.json).**
> This file only orients: what is new, what changed in the product, and where each rule lives. When this file and
> the code or a linked doc disagree, the code and the doc win.
>
> **Delete this file once the web client has integrated these endpoints.**

## 1. What is real now

On top of the fifteen endpoints of the first backend release ([2026-10-31 handoff](2026-10-31-backend-thin-slice-fe.md)),
thirteen more are implemented:

| Method | Path | What |
|---|---|---|
| `PATCH` | `/lost-cases/{code}` | Edit an active lost case (photos, signs, zone, time) |
| `PATCH` | `/cases/{code}` | Edit a found, adoption or help case: answers `not_found` for every code until those verticals exist |
| `POST` | `/cases/{code}/reunite` | Close as reunited, with the attribution |
| `POST` | `/cases/{code}/cancel` | Close as a false alarm or a duplicate |
| `POST` | `/cases/{code}/reopen` | Reopen an expired case within 30 days |
| `PATCH` | `/cases/{code}/sightings/{sightingId}` | The owner hides or highlights a pin |
| `POST` | `/cases/{code}/sightings/{sightingId}/correction` | The reporter moves their pin within 15 minutes |
| `DELETE` | `/cases/{code}/sightings/{sightingId}` | The reporter deletes their pin within 15 minutes |
| `POST` | `/cases/{code}/recovery-claims` | «Lo tengo» |
| `POST` | `/cases/{code}/claims/{claimId}` | The owner's answer to a claim |
| `GET` | `/me/pets` | «Mis mascotas» and the publish pet picker |
| `PATCH` | `/me/profile` | The profile update |

`GET /cases/{code}` now carries the owner's `claims[]` and `open_claim_count`; `GET /feed` carries `possible_find`
for the caller's own items; `GET /me/cases` carries `open_claim_count`. Still not implemented: reports, shares,
notifications and check-ins, conversations, found, adoption and help.

## 2. Product changes you should know about

Each row gives the behaviour, the decision that owns it ([product/00 · Decision log](../product/00-product-map.md))
and what the client must do.

| Change | Decision · owning doc | What the client must do |
|---|---|---|
| **«Lo tengo» needs a session.** The claimant is a person. | #75 · [04](../product/04-lost-workflow.md) · recovery_claim | Ask the person to sign in before the claim sheet, and say it is for the owner's safety. @HELP-002 and @HELP-005 were given an email-code sign-in step before claiming; the claim sheet itself must ask for sign-in |
| **The badge is the owner's only.** `open_claim_count` and `possible_find` are `null` for everyone else, the claimant included. | #76 | Render nothing for `null` (the contract already types them nullable). The case page's public «Posible hallazgo.» notice and its copy `lost.page.possible_find_body` can no longer show: remove or repurpose them. The claimant never sees the badge; the claim sheet's success state («Ya le avisamos a su familia.») is their feedback |
| **A cancelled case is still served**, with `status: cancelled` and `contact: null`. | #71 | A page for `cancelled` |
| **Reunite, cancel, reopen and deleting your own pin are idempotent**: repeating one that already happened answers the same success (reopen on an active case included). Cancel or reopen on a reunited case stays `invalid_transition`. | #71, #73 | Retry on a lost connection without fear; on `invalid_transition`, refetch the case (it may be reunited — good news) |
| **Reopen and «Lo tengo» can answer `active_case_exists`** (`details.case_code`: the pet's other active case); a claim on a purged code answers `gone`; the owner's own claim `forbidden`. | #71, #75 · [api.md](../eng/api.md) · Errors | Handle the codes (table below) instead of «revisa tu conexión» |
| **A repeated claim refreshes the person's open claim** (a stale one included): same id, the new phone and photos, and it counts again. On a case that is no longer active it answers that case's refusal, never the old claim. | #75 | Let the claimant send «Lo tengo» again; do not treat it as a new claim |
| **A `from_sighting_id` that is not the claimant's own visible pin of the last 24 hours is ignored**, never refused: the claim is stored without it. | #75 | Nothing to handle; send it when you have it |
| **The owner's `claims[]` holds the newest 50**; `stale` is derived (open and 7 days since the claimant's last «Lo tengo»). | #76 | Show `stale` claims to the owner too (collapsed), and answered ones, so the owner can still confirm a stale claim and revise a mis-tapped answer — today's `ClaimsList` shows only `open` |
| **Answers are revisable** (`confirmed ↔ dismissed`), and confirming never closes the case. | #77 | Offer «cambiar respuesta»; close with reunite |
| **Editing photos or signs changes the pet on every case of it**, old ones included; a moved zone shows the generic place label. | #72 · [04](../product/04-lost-workflow.md) · Editing a published case | Say so in the edit form |
| **"Mine"**: a pin is yours if your account sent it, or if it was sent without an account from this browser — so it stays yours after you sign in. Another person's pin is never yours. | #73 · [api.md](../eng/api.md) · Device identity | Find the claimant's own pin by `mine` to send `from_sighting_id` |
| **A pin the family hid disappears for its reporter too**, and can no longer be corrected or deleted by them. | #73 | Do not word it as a failed send: the reporter may otherwise report again |
| **A deleted pin keeps its `client_id`**: a replayed «Lo vi» answers the deleted pin's id. | #73 | Nothing |
| **Profile rules:** sending a name marks it chosen (it becomes public); the bio refuses links and domain-shaped words («Hola.Soy» included); `city` ≤ 80 characters. | #79 · [auth.md](../eng/auth.md) · Profile | Explain a refused bio; send the name only when the person edits it |

Error codes the client can turn into helpful copy:

| Endpoint and code | Suggested behaviour |
|---|---|
| «Lo tengo» `active_case_exists` | Open `details.case_code` and the claim sheet there («Este aviso tiene uno más reciente») |
| «Lo tengo» `invalid_transition` | Refetch the case: it may be reunited |
| «Lo tengo» `gone` | Show the purged-case page |
| «Lo tengo» `forbidden` | Never shown: the owner has no «Lo tengo» button |
| Publish `active_case_exists` after a stranger's claim reactivated the old case | «Tu aviso anterior se reactivó porque alguien dice que lo tiene», with a link to it |
| Correction or delete `forbidden` | Use `editable_until` to say «pasaron los 15 minutos» |

The emulated backend still differs on: answers being revisable, delete as a status, the "mine" rule (the mock
uses person-or-device), idempotent reunite, cancel and reopen, and «Lo tengo»'s WhatsApp link (the mock checks only
`expose_whatsapp` and `phone_has_whatsapp`, not `contact_phone_verified` or `in_app_only`, and adds no `?text=`).

## 3. Proposals to the client

- `found_deceased` and `gave_up`: which endpoint or field carries them — [O35](../open-items.md).
- Claim evidence (photos, point, `from_sighting_id`) in the owner's `claims[]` — [O36](../open-items.md).
- The «¿Es donde lo viste…?» prefill from the caller's own recent pin is the client's call (the backend accepts
  `from_sighting_id`).
- Prefill the claim sheet's phone with the signed-in person's verified phone (04 · Registered: «no form»), so a
  claimant does not type someone else's number by mistake.
- A copy review of the WhatsApp text: «Hola, vi tu aviso de {nombre} en Scuby ({código}) y creo que lo tengo.»

## 4. E2E against the real backend

`bash backend/e2e/run-client-e2e.sh` (see the 2026-10-31 handoff for the options). `backend/e2e/seed.sql` now also
holds Pelusa (a cat of `carolina@correo.co`) with an expired case `PEL4S` closed 3 days ago, and an open claim on
`7K3PQ` by Andrés Rojas (`+573114829017`, 3 hours old). `@LINK-001` now ends with the owner signing in by email
code (`carolina@correo.co`) and finding the claim in «Posibles hallazgos»; a stranger no longer sees «Posible
hallazgo.» (the page's public notice can no longer show, since its count is `null` for non-owners — remove or repurpose
it).

Last run (<today>):

| Tag | Result | Why |
|---|---|---|
| @AUTH-001 | RESULT | |
| @AUTH-002 | RESULT | |
| @PLOST-001 | RESULT | |
| @PLOST-002 | RESULT | |
| @PLOST-003 | RESULT | |
| @PLOST-004 | RESULT | |
| @LINK-001 | RESULT | |
| @LINK-002 | RESULT | |
| @LINK-003 | RESULT | |
| @LINK-004 | RESULT | |
| @FEED-001 | RESULT | |
| @FEED-002 | RESULT | |
| @FEED-003 | RESULT | |
| @MAP-001 | RESULT | |
| @MAP-002 | RESULT | |
| @OFFLINE-001 | RESULT | |
```

Then fill the table from the run of Step 7: replace every `RESULT` with `pass` or `fail`, and give every `fail` its reason (for `@AUTH-002`, `@PLOST-002`, `@PLOST-004`: «No «Continuar con Google» button (no real Google client id in the build)»; for the feed and map specs, the reason the 2026-10-31 handoff gives). No `RESULT` may remain: `grep -c RESULT <the file>` must print `0`.

- [ ] **Step 6: The e2e seed**

In `W/backend/e2e/seed.sql`:

(a) replace the `TRUNCATE` statement's first line `TRUNCATE scuby.sighting, scuby.lost_case, scuby.purged_case_code, scuby.responsibility_link, scuby.pet,` with `TRUNCATE scuby.recovery_claim, scuby.sighting, scuby.lost_case, scuby.purged_case_code, scuby.responsibility_link, scuby.pet,`;

(b) add Pelusa to the pets — replace

```sql
  ('00000000-0000-0000-0000-00000000be02', 'Toby', 'dog', 'medium', '{brown}', NULL, '{}', 'claimed', now() - interval '20 days');
```

with

```sql
  ('00000000-0000-0000-0000-00000000be02', 'Toby', 'dog', 'medium', '{brown}', NULL, '{}', 'claimed', now() - interval '20 days'),
  -- spec 2026-11-01 §7.6: Pelusa, a cat of Carolina's, for the reopen flows (@PLOST-002, @PLOST-004)
  ('00000000-0000-0000-0000-00000000be03', 'Pelusa', 'cat', 'small', '{white}', NULL, '{}', 'claimed', now() - interval '60 days');
```

(c) add her owner link — replace

```sql
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000ca02', '00000000-0000-0000-0000-00000000be02', 'owner', now() - interval '20 days');
```

with

```sql
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000ca02', '00000000-0000-0000-0000-00000000be02', 'owner', now() - interval '20 days'),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000be03', 'owner', now() - interval '60 days');
```

(d) replace the whole `INSERT INTO scuby.lost_case (…) VALUES …;` statement with this one (the snapped public centers are `LocationPrecisionDerivation.publicCenter` of each point; the table requires them):

```sql
INSERT INTO scuby.lost_case (code, pet_id, created_by, status, published_at, resolved_at, contact_phone, contact_phone_verified, phone_has_whatsapp,
  expose_whatsapp, expose_email, in_app_only, last_seen_lat, last_seen_lng, last_seen_public_lat, last_seen_public_lng, last_seen_radius_m,
  last_seen_at, place_name) VALUES
  -- fixtures.ts:229-243 (7K3PQ: Laureles, 100 m, published 2 days ago, +573000000000 with WhatsApp exposed)
  ('7K3PQ', '00000000-0000-0000-0000-00000000be01', '00000000-0000-0000-0000-00000000ca01', 'active', now() - interval '2 days', NULL,
   '+573000000000', true, true, true, false, false, 6.2447, -75.5916, 6.2442, -75.591256, 100, now() - interval '2 days', 'Laureles'),
  -- fixtures.ts:197-223 + :260 (closedLost H4PPY: reunited 3 days ago, published 10 days ago, offset(400, -300), 300 m)
  ('H4PPY', '00000000-0000-0000-0000-00000000be02', '00000000-0000-0000-0000-00000000ca02', 'reunited', now() - interval '10 days', now() - interval '3 days',
   '+573000000003', true, true, true, false, false, 6.24829, -75.59431, 6.2478, -75.593587, 300, now() - interval '10 days', 'Laureles'),
  -- spec 2026-11-01 §7.6: Pelusa's case, expired 3 days ago (inside the 30-day reopen window), resolution NULL
  ('PEL4S', '00000000-0000-0000-0000-00000000be03', '00000000-0000-0000-0000-00000000ca01', 'expired', now() - interval '20 days', now() - interval '3 days',
   '+573000000000', true, true, true, false, false, 6.2447, -75.5916, 6.2442, -75.591256, 200, now() - interval '20 days', 'Laureles');
```

(e) after the `INSERT INTO scuby.sighting …;` statement, add:

```sql

-- spec 2026-11-01 §7.6: an open claim on Luna by Andrés Rojas (the claim @LINK-001's owner step finds)
INSERT INTO scuby.recovery_claim (id, case_code, claimant_person_id, phone, status, created_at, last_active_at) VALUES
  (gen_random_uuid(), '7K3PQ', '00000000-0000-0000-0000-00000000ca03', '+573114829017', 'open', now() - interval '3 hours',
   now() - interval '3 hours');
```

- [ ] **Step 7: Final verification**

Run: `[mvn] verify 2>&1 | tail -25`
Expected: `BUILD SUCCESS`; the PIT line ≥ 80 %. Record in the report the overall PIT score and the per-class scores of `LostLifecycleDerivation`, `ClaimDerivation`, `LostEditDerivation`, `MyPetsDerivation`, `ProfileTextDerivation`, `LostCaseDerivation` (from `B/target/pit-reports/index.html`).

Run: `bash /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1/backend/e2e/run-client-e2e.sh 2>&1 | tee /private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/l1-e2e.log | tail -40`
Expected: the seed loads without error (`ON_ERROR_STOP`), `@LINK-001` passes, `@PLOST-002` and `@PLOST-004` fail at «Continuar con Google», and every spec that passed in the 2026-10-31 table still passes. Fill the handoff table (Step 5). Then stop the project: `bash /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1/backend/e2e/run-client-e2e.sh --down`.

For human review (do NOT run it: `web/` is edited only in the contract-change task): the spec also asks that `@PLOST-002` and `@PLOST-004`, run locally with their «Continuar con Google» step replaced by `signIn.withEmailCode('carolina@correo.co')`, pass every later step. List that check in the report with the two spec files and the line to replace.

Run: `cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1/web && if command -v pnpm >/dev/null 2>&1; then P=pnpm; else P="npx --yes pnpm@10.27.0"; fi && $P typecheck && $P test 2>&1 | tail -5`
Expected: both pass (nothing in `web/` changed since the contract task).

- [ ] **Step 8: Commit**

Run: `git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 status --porcelain` — Expected: only the docs above, the new handoff and `backend/e2e/seed.sql` (no `.superpowers/`, nothing under `web/`).

```bash
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 add backend/e2e/seed.sql
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 commit -m "test: e2e seed — snapped centers, Pelusa's expired case, an open claim on Luna"
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 add docs/product/00-product-map.md docs/open-items.md \
  docs/product/04-lost-workflow.md docs/product/01-actors-and-entities.md docs/product/02-flows.md \
  docs/eng/api.md docs/eng/auth.md docs/eng/backend.md docs/handoffs/
git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-lost-l1 commit -m "doc: lost-vertical owner and helper actions — decisions #71–#79, open items O34–O38, owning docs, FE handoff"
```

---

## Self-review (run by the plan's author; kept for the reader)

**Spec coverage.** §1 scope: the 13 endpoints are Tasks 4 (reunite, cancel, reopen), 5 (`editLost`, `editCase`), 6 (`moderateSighting`), 7 (`correctSighting`, `deleteSighting`), 9 (`claimRecovery`), 10 (`answerRecoveryClaim`), 12 (`listMyPets`), 13 (`updateProfile`); the changed reads are Tasks 10 (`GET /cases/{code}`) and 11 (`GET /feed`, `GET /me/cases`); out-of-scope items become O37/O38/O35 (Task 14). §1 done-when: `[mvn] verify` (every task, Task 14), `pnpm openapi/test/typecheck` (Task 8, re-run in Task 14), the e2e run and seed (Task 14; the Google-step replacement is a human check because `web/` is frozen). §2 migrations: Task 1, the two performance indexes after their RED plan checks. §3 constants and the badge: Task 2 (homes), Tasks 10–11 (use). Error order, Jackson-first and bodies without `@Valid`: Global Constraints, every precedence test. §4.1–4.13: Tasks 4–13 as listed. §5 package placement: `Pets.updateLook` (5), `Patch` (3), `ProfilePhotos`/`ProfilePhotoCheck` (13), `CasesSecurityRules` lines per task (4, 5, 6, 9, 10, 12). §6 contract change: Task 8 (all nine rows). §7.1 leak tests: `ClaimLeakTest`, `FeedBadgeTest`, `SightingModerationTest`, `SightingDeleteTest`. §7.2 races: `CaseLifecycleRaceTest` (close vs a signed-in «Lo vi»; close vs close, deterministic; a retried reunite keeps the first attribution; reopen vs a claim's reactivation, both active) and `EditLostRaceTest` (edit vs a signed-in «Lo vi»), `RecoveryClaimRaceTest` (reactivation, publish, reopen, double tap under a barrier and held), `SightingDeleteTest` (double-tap delete), `SightingModerationTest` (a hide that loses to moderation), window edges in `SightingCorrectionTest`/`SightingDeleteTest` (`MutableClock`). §7.3 ceilings: every task's `StatementCeilings` lines, pinned exactly. §7.4 derivation tables: Tasks 2, 3, 7, 10, 11. §7.5 precedence: one per endpoint group. §7.6 seed: Task 14. §8 docs: Task 14. §9 seams: nothing to build (no outbox rows, no notifications — asserted in `RecoveryClaimTest`).

**Resolved where the spec was silent:**
1. The contract change (spec §6) runs as Task 8, before the claim tasks, because `ApiClient` validates every response against `openapi.json` and «Lo tengo»'s `401/403/410` and the nullable badge are not in the contract before it.
2. Enum-valued body fields bind as strings, so a wrong value is a body error after the owner check (the spec's order), while an absent required field stays a Jackson error before the lookups (spec §3).
3. The edit's photo attachability is part of "the body", checked before the status (spec §4.1 lists photos under validation and the order puts the body before the status).
4. The spec's "run @PLOST-002/004 with the Google step replaced" cannot be done without editing `web/` outside the contract task, so Task 14 lists it for a human.
5. The e2e seed lacked the snapped public centers that the `lost_case` table requires; Task 14 adds them.
6. `@LINK-001`'s owner step asserts the claims list «Posibles hallazgos» (with the claimant's number), not the text «Posible hallazgo.»: the client's page shows the owner the list instead of the public badge, and the badge is now owner-only, so that text shows to nobody.
7. The claim pre-read loads the owner's number only when the contact preferences make it public (case status left out, so a reactivating claim can still get the link): the derivation re-checks the flags and the status.
8. A repeat «Lo tengo» answers `201`, like a first claim: the contract lists only `201` as `claimRecovery`'s success, and `ApiClient` refuses any status the contract does not list.
9. The contract types `from_sighting_id` as a plain string (no UUID format), so there is no malformed form of it: a non-UUID is an unknown pin and is ignored like any ineligible one; the claim has no `validation_failed {from_sighting_id}` path at all.
10. A repeat «Lo tengo» takes the repeat's values for photos, point and link even when they are empty: the repeat is the claimant's current word (decided: "updates phone, photo_urls, point and from_sighting_id").
11. Idempotent transitions keep the pre-read classification and add one re-read only when the `UPDATE` changes 0 rows; a repeat the pre-read already sees as done is 2 statements, and the race-loser path is 4 (reunite and cancel ceilings 3 → 4).
12. The reporter's repeat delete of their own deleted pin answers `204` at any time (the window is for changing a pin, and the pin is already gone); the contract's success for `deleteSighting` is `204`, so "the same answer as the first success" is `204`.

**Type consistency (re-checked after the red-team revision).** `LostLifecycleDerivation.Outcome` gains `ALREADY_DONE` (Task 2), consumed by `CaseLifecycleService` (Task 4); `RecoveryClaimService` compares only `INVALID_TRANSITION`/`REACTIVATE`, so a claim never meets it. `ClaimDerivation.prefillEligible(SightingLink, boolean mine, Instant)` (Task 2) is called only by `RecoveryClaimService.linkedPin` (Task 9) with `LostCaseDerivation.mine` (Task 7). `isStale`/`wireStatus` take `lastActiveAt` (Task 2) and are fed `ClaimRow.lastActiveAt` (Task 10) and `RECOVERY_CLAIM.LAST_ACTIVE_AT` (Tasks 1, 9). `RecoveryClaimQueries.upsertIfActive` (Task 9) replaces `insertIfActive` and the dedupe select everywhere. `CaseFixtures.claim` has a 5- and a 6-argument form (Task 9), used by Tasks 10 and 11. Ceilings: reunite 4, cancel 4, reopen 4, correction 4, delete 4, claim 8, `GET /cases/{code}` 4.

**Placeholders.** None: every step carries its code, command and expected output. `<today>` in Task 14 is computed by the step that uses it.

## Red-team items not taken

- **Part 1 M2 (sub-microsecond edge of the 15-minute window):** truncating `now` in every service is a change across all of them for a ±0.5 µs edge no person can hit; accepted.
- **Part 1 M6 (pre-flight count before `lost_case_active_is_unresolved`):** no code path writes an active case with `resolved_at`, and the test databases are fresh; a hand-edited local database is fixed by hand.
