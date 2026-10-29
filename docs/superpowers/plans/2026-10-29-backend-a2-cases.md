# Backend A2 — Photos, Lost Cases, Feed and Sightings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On top of plan A1's identity foundation, implement the rest of the thin slice — `POST /uploads` (with a development-only bucket and a presigned-S3 store for staging), the `pets` foundation, `POST /lost-cases`, `GET /cases/{code}`, `GET /feed` and `POST /cases/{code}/sightings` — port the client mock's scenarios as backend tests, run a place-names spike, and run the client's e2e specs against the local backend.

**Architecture:** Two new foundations (`uploads`, `pets`) and the first vertical (`cases`), flat packages, package-private by default; cross-feature calls only through `@ModuleApi` classes (`identity.PublisherPhone`, `identity.PhoneNumbers`, `uploads.PhotoAttachments`, `pets.Pets`). `GET /cases/{code}` and the feed are built access → facts → pure derivation → record (`LostCaseDerivation`, `FeedDerivation`, `PublicTextDerivation`); sighting rules and rate-limit decisions are pure too (`SightingRulesDerivation`). PostGIS on `geography` for every distance; points stored as `lat`/`lng` columns with a generated `geography` column.

**Tech Stack:** as plan A1 (Java 25, Spring Boot 4.1.2, Spring Security 7.1.2, jOOQ 3.21.9 OSS, Flyway 12.4.0, PostgreSQL 17 + PostGIS, Testcontainers 2.0.5, Caffeine, ArchUnit 1.5.1, PIT 1.30.1) plus AWS SDK v2 2.57.6 (`s3`, `url-connection-client` — already in the pom from A1). Client side for the acceptance task: Node 24 + pnpm, Playwright (from `web/`).

**Design (binding):** `docs/superpowers/specs/2026-10-29-backend-thin-slice-design.md` — sections "Responses: facts → derivation → record", "Behaviour decisions", "Queries and indexes", "Human review focus". Endpoint reference: `web/src/contracts/**`, `web/src/mocks/**`, `docs/product/04-lost-workflow.md`, `docs/eng/api.md`, `docs/eng/media-pipeline.md`. **Precedence:** the contract (`docs/eng/openapi.json`) fixes the wire shape; for behaviour the product docs and the design win over the client mock's shortcuts; the mock is the reference only where both are silent.

## Global Constraints

- **Prerequisite:** plan A1 (`docs/superpowers/plans/2026-10-29-backend-a1-identity.md`) is complete on this branch. Before Task 1, `[mvn] verify` must be green and these must exist: `co.scuby.support.{IntegrationTest, ApiClient, ApiClients, ApiResponse, TestDb, MutableClock, StatementCeilings, PlanAssert, Accounts, RecordingSmsSender}`, `co.scuby.platform.security.{Caller, Account, SecurityRules}`, `co.scuby.platform.flags.{FeatureFlags, Flag}`, `co.scuby.platform.crypto.Hashing`, `co.scuby.platform.config.Prod`, `co.scuby.platform.cache.ClearableCache`, `co.scuby.identity.{PublisherPhone, PhoneNumbers}`. If any is missing, stop and report.
- **Where:** work and write ONLY in the worktree `/Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice` (branch `be/thin-slice`). **Never touch** `/Users/alejandrosuazabuiles/Desktop/scuby-monorepo` (the main checkout), `~/scuby-b1-run`, or `/Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-observability`. Never edit `web/` (the acceptance task only *runs* it) or `docs/eng/openapi.json`. Do not edit `docs/eng/infra.md`.
- **Absolute paths for every write.** `W` = `/Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice`, `B` = `W/backend`; expand them when you write or run.
- **Shell:** zsh tool shell; run scripts with `bash script.sh` (or `python3 -I script.py`). Every Maven command:
  `cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice/backend && export JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home PATH=/opt/homebrew/opt/openjdk@25/bin:$PATH && ./mvnw ...` — written below as `[mvn] ...`.
- **Docker is required for every Maven build** (jOOQ codegen) and the image `scuby/postgres:17` must exist (`docker image inspect scuby/postgres:17`; else `docker build -t scuby/postgres:17 /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice/infra/docker/postgres`).
- **pom.xml / application.yml:** shared with branch `be/observability`. This plan adds **no** dependencies. Configuration goes inside the existing thin-slice `scuby:` block (one block per file). No telemetry.
- **Packages:** `co.scuby.uploads`, `co.scuby.pets` (foundations: depend only on `platform`), `co.scuby.cases` (vertical: may use `identity`, `uploads`, `pets` `@ModuleApi` classes and `platform`). Flat, package-private by default; cross-feature classes are `public` + `@ModuleApi`. ArchitectureRules already lists all four features.
- **One writer per table:** `uploads` writes `upload`; `pets` writes `pet`, `responsibility_link`; `cases` writes `lost_case`, `purged_case_code`, `sighting`. Reads may join any table.
- **Flyway:** timestamped versions `V20261030_HHMM__what.sql`, each opened by a comment (purpose, owning doc). PostGIS objects live in schema `public`: inside migrations write `public.geography`, `public.ST_SetSRID`, `public.ST_MakePoint` (Flyway's search path is `scuby`). Points are stored as `*_lat`/`*_lng` `double precision` plus a **generated** `geography(Point,4326)` column for spatial queries; application code writes the doubles and reads the doubles, and uses the geography column only through `co.scuby.platform.db.Spatial`.
- **Time** only from the `Clock` bean, passed into SQL as parameters (`instant.atOffset(ZoneOffset.UTC)` on write, `.toInstant()` on read — jOOQ maps `timestamptz` to `OffsetDateTime`). Never `now()` in application SQL; derivations take `now` as a parameter.
- **Tests:** every integration test is `@IntegrationTest`, calls `testDb.reset()` first, and calls contract endpoints through `ApiClient` (contract validation + statement ceiling on every call; non-contract routes through `ApiClient.raw`). Add each endpoint's ceiling to `StatementCeilings` and each writable table to `TestDb.MUTABLE_TABLES`. Viewer-dependent endpoints get a **leak test**. Derivations get table-driven `*DerivationTest`s (PIT ≥ 80 %).
- **Indexes are earned:** plan checks (`PlanAssert`, thousands of seeded rows, `ANALYZE`) only for the growth-sensitive queries the design names — the feed, a case's sightings, the rate-limit counts, the `active_case_exists` check. Write the failing plan check first, then the index migration whose comment carries the query, plan before/after, write cost and overlaps. **Every new index (including unique ones) is listed in the report under "Indexes for human approval".**
- **Commits:** `feat:` / `test:` / `doc:` / `fix:` prefixes, one kind per commit where possible. **Never push**, never open PRs, never rewrite history.
- **Stuck rule:** a step that fails 3 times after honest fixes → stop that task, record command/output/attempts in the report, continue with the next task whose *Consumes* are satisfied.
- **Report:** `/private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/a2-report.md` — one section per task: what was done, deviations, measured statement counts, plans before/after, PIT scores, items for human review. Outside the repo; never commit it. The acceptance task also writes `/private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/a2-e2e/` (Playwright output, config override).
- Spanish strings are UI copy (server-composed display text: `place_name`, `summary`, in the request's `Accept-Language`, `es` default); identifiers are English snake_case. One home per fact in docs. Open items: **O23** (email/SMS providers), **O24** (flag outcomes the contract cannot express). Decision log next free number after A1: **#41**.

## Behaviour decisions this plan applies (from the design; do not re-decide)

| Topic | Rule |
|---|---|
| Phone step at publish | `PublisherPhone.resolve` (A1): OTP when `publisher_phone_otp` is on and the number is new or unverified; first call sends and answers `{phone_step: "otp"}`; repeat inside 60 s answers `otp` without resending; flag off publishes with the number stored unverified (O24) |
| Feed | With `lat`+`lng`: open lost cases within 25 km, ordered by distance band (≤ 2, ≤ 5, ≤ 10, ≤ 25 km) then newest `published_at` first; scope `local`. None near, or no `lat`/`lng`: scope `national`, newest first. At most 100 items either way (no paging in the contract). `vertical`/`species` filter **before** the scope is decided (deviation from the mock, which filtered after — so `local` means "something near matches") |
| Public location floor | Non-owners get `last_seen.radius_m = max(radius, 200)`; the owner gets the stored radius; the center is never moved |
| Sightings | Order of checks: case exists (lost only; purged/other verticals → `not_found`) → `client_id` replay (before everything else, any reporter) → case `active` else `invalid_transition` → `seen_at` > now + 5 min `seen_at_in_future` → `seen_at` < `last_seen_at` − 24 h `seen_at_before_case` → distance > 30 km `sighting_too_far` → contact phone format → photos → rate limits → insert |
| Rate limits («Lo vi») | Reporter = account when signed in, else device: 5 per case and 20 overall per rolling 24 h. **IP as second key** (decided here, configurable; report as an open question): 20 per case and 80 overall per IP per rolling 24 h. The 15-minute rule of `product/04` is waived inside the earlier pin's 15-minute correction window — the same 15 minutes — so it can never fire; it is not implemented (report it) |
| `mine` | The session's account **or** the device matches the reporter. `editable_until` = `created_at + 15 min` when `mine`, visible, and not yet past; else `null` |
| Photos | A photo URL in a publish/sighting body must map to a slot this caller (account or device) took **for that purpose** within the last 24 h, and its bytes must be stored (processed); else `validation_failed` on the field (`pet.photo_urls`, `photo_urls`). `pet`/`profile` slots need a session (`validation_failed` on `purpose`). Slots expire in 5 min; ≤ 20 slots per caller per 10 min (`rate_limited`) |
| Place names | `PlaceNamer` interface; computed once at publish and stored; flag `reverse_geocoding` off (default) → stored `null`, rendered as the generic label «Zona marcada en el mapa» (`en`: «Area marked on the map»). No provider is wired in this plan |
| Claims, check-ins, notifications | Not in this slice: `claims: []`, `pending_checkin: null`, `open_claim_count: 0`, `possible_find: false`; no outbox events |
| Other verticals | Codes of found/adoption/help do not exist; any unknown code is `not_found`; a purged code is `gone` on `GET /cases/{code}` only |
| Case codes | 5 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`, never reused (checked against `lost_case` and `purged_case_code`); lookups upper-case the path |

---

## File map

```
backend/src/main/java/co/scuby/
  platform/crypto/Hashing.java               + sha256Hex(byte[]) (Task 1)
  uploads/   UploadPurpose, UploadRequest, UploadView, UploadTarget, MediaStore, MediaProperties,
             MediaConfiguration, LocalMediaStore, DevMediaController, UploadSlots, UploadsController,
             PhotoAttachments (@ModuleApi)                                         (Task 1)
             S3MediaStore                                                         (Task 2)
  pets/      Pets (@ModuleApi; nested Species, Size, Color, NewPet)               (Task 3)
  cases/     CasesSecurityRules, CaseCodes, PlaceNamer, NoPlaceNamer, PlaceNames,
             PublishLostRequest, PublishLostController, PublishLostService, PublishView (Task 4)
             Access, Viewer, CaseAccessPolicy, LostCaseFacts, LostCaseQueries, LostCaseView,
             LostCaseDerivation, PublicTextDerivation, CaseController             (Task 5)
             FeedQuery, FeedRow, FeedQueries, FeedView, FeedDerivation, FeedController, FeedProperties (Task 6)
             SightingRequest, SightingRulesDerivation, SightingProperties, SightingQueries,
             SightingService, SightingController                                  (Task 7)
backend/src/main/resources/db/migration/
  V20261030_1000__uploads.sql                                                      (Task 1)
  V20261030_1010__pets.sql                                                         (Task 3)
  V20261030_1020__lost_cases.sql, V20261030_1030__one_active_case_per_pet.sql      (Task 4)
  V20261030_1040__sightings.sql                                                    (Task 5)
  V20261030_1050__feed_indexes.sql                                                 (Task 6, after its plan checks fail)
  V20261030_1060__sighting_rate_limit_indexes.sql                                  (Task 7, after its plan checks fail)
backend/src/test/java/co/scuby/
  support/CaseFixtures.java                                                         (Task 5)
  uploads/*Test, pets/PetsTest, cases/*Test, cases/LostParityTest                   (Tasks 1–8)
backend/e2e/seed.sql, backend/e2e/compose.e2e.yaml, backend/e2e/run-client-e2e.sh  (Task 10)
docs/superpowers/specs/2026-10-30-place-names-spike.md                             (Task 9)
docs/eng/backend.md, docs/eng/api.md, docs/product/04-lost-workflow.md, docs/product/00-product-map.md (Task 11)
```

**Task order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11. Task 2 depends only on 1; Task 9 depends on nothing (it may run any time); Task 10 needs 1, 3–7.

---
### Task 1: Uploads — slots, the development bucket, and photo attachment checks

`POST /uploads` answers a slot for a photo (`docs/eng/api.md` · Uploads; decision #36): `{url, upload: null | {method: "PUT", url, headers, expires_at}}`, status **201**. The slot is scoped to the caller (account when signed in, else device — `Caller.ownerKey()`) and to the purpose; the URL derives from the hash, so the same photo always has the same URL; `upload` is `null` when the bytes are already stored. Locally and in tests the bytes go to a **development-only** `PUT /dev-media/{sha256}.jpg` that checks the hash, stores the bytes and makes them "processed" at once (as the client mock does); staging uses S3 (Task 2). `PhotoAttachments` is what publish and sighting endpoints call to refuse photos the caller did not upload for that purpose or that are not processed.

**Files:**
- Modify: `B/src/main/java/co/scuby/platform/crypto/Hashing.java` (add `sha256Hex(byte[])`)
- Create: `B/src/main/resources/db/migration/V20261030_1000__uploads.sql`
- Create in `B/src/main/java/co/scuby/uploads/`: `UploadPurpose.java`, `UploadTarget.java`, `MediaStore.java`, `MediaProperties.java`, `MediaConfiguration.java`, `LocalMediaStore.java`, `DevMediaController.java`, `UploadRequest.java`, `UploadView.java`, `UploadSlots.java`, `UploadsController.java`, `PhotoAttachments.java`
- Modify: `B/src/main/resources/application.yml`, `application-test.yml`, `application-local.yml`, `B/compose.yaml` (env of `backend`)
- Modify: `B/src/test/java/co/scuby/support/TestDb.java`, `StatementCeilings.java`
- Test: `B/src/test/java/co/scuby/uploads/UploadsTest.java`, `PhotoAttachmentsTest.java`, `UploadSlotPlanTest.java`

**Interfaces:**
- Consumes: `Caller` (`ownerKey()`, `signedIn()`, `personId()`, `deviceHash()`), `Hashing`, `Prod`, `ClearableCache`, `ApiClient.rawBytes`.
- Produces:
  - `@ModuleApi public enum UploadPurpose { pet, sighting, claim, evidence, profile }` (lower-case constants = wire values).
  - `@ModuleApi public class PhotoAttachments`: `public void requireAttachable(List<String> photoUrls, UploadPurpose purpose, Caller caller, String field)` — throws `ApiException(VALIDATION_FAILED, fields = {field: "photo not uploaded by this caller for this purpose, or not processed yet"})`.
  - `interface MediaStore` (package-private): `String publicUrl(String sha256)`, `Optional<String> sha256Of(String url)`, `boolean isStored(String sha256)`, `UploadTarget presign(String sha256, long bytes, Instant expiresAt)`.
  - `record UploadTarget(String method, String url, Map<String, String> headers, Instant expiresAt)` — serialised as the contract's `upload` object.
  - `record MediaProperties(String store, String publicBaseUrl, String localDir, String bucket, String region, Duration slotTtl, int maxSlotsPer10Min, Duration attachWindow)` bound to `scuby.media`.
  - Table `upload (owner_key, sha256, purpose, bytes, created_at)`, PK `(owner_key, sha256, purpose)`.
  - Development routes `PUT/GET /dev-media/{sha256}.jpg` (profiles `local`, `test` only).

- [ ] **Step 1: Write the failing tests**

`B/src/test/java/co/scuby/uploads/UploadsTest.java`:

```java
package co.scuby.uploads;

import co.scuby.platform.crypto.Hashing;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.TestDb;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class UploadsTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired MutableClock clock;

    ApiClient api;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
    }

    static byte[] photo() {
        return ("jpeg-bytes-" + UUID.randomUUID()).getBytes(StandardCharsets.UTF_8);
    }

    static String slotBody(String purpose, String sha256, int bytes) {
        return """
                {"purpose":"%s","sha256":"%s","content_type":"image/jpeg","bytes":%d}""".formatted(purpose, sha256, bytes);
    }

    // Port of backend.test.ts «answers a slot to send the bytes to, and the URL the photo will have».
    @Test
    void aSlotNamesTheUrlFromTheHashAndWhereToPut() {
        byte[] bytes = photo();
        String sha = Hashing.sha256Hex(bytes);
        ApiResponse r = api.post("/uploads", slotBody("sighting", sha, bytes.length));
        assertThat(r.status()).isEqualTo(201);
        assertThat(r.str("/url")).contains(sha).endsWith(".jpg");
        assertThat(r.str("/upload/method")).isEqualTo("PUT");
        assertThat(r.str("/upload/url")).isEqualTo(r.str("/url"));
        assertThat(r.str("/upload/headers/content-type")).isEqualTo("image/jpeg");
        assertThat(r.str("/upload/expires_at")).isEqualTo("2026-10-14T17:05:00Z");
    }

    // Port of backend.test.ts «serves the photo once the bytes are sent, and answers no slot for a photo it has».
    @Test
    void bytesPutToTheSlotAreServedAndTheNextSlotIsEmpty() {
        byte[] bytes = photo();
        String sha = Hashing.sha256Hex(bytes);
        ApiResponse slot = api.post("/uploads", slotBody("sighting", sha, bytes.length));
        String path = slot.str("/url").substring(slot.str("/url").indexOf("/dev-media/"));
        assertThat(api.raw(HttpMethod.GET, path, null).status()).isEqualTo(404);
        assertThat(api.rawBytes(HttpMethod.PUT, path, bytes, "image/jpeg").status()).isEqualTo(200);
        ApiResponse served = api.raw(HttpMethod.GET, path, null);
        assertThat(served.status()).isEqualTo(200);
        assertThat(served.raw().getContentAsByteArray()).isEqualTo(bytes);
        assertThat(api.post("/uploads", slotBody("sighting", sha, bytes.length)).isNull("/upload")).isTrue();
    }

    @Test
    void theDevBucketRefusesBytesThatDoNotMatchTheHash() {
        byte[] bytes = photo();
        String sha = Hashing.sha256Hex(bytes);
        api.post("/uploads", slotBody("sighting", sha, bytes.length));
        ApiResponse r = api.rawBytes(HttpMethod.PUT, "/dev-media/{sha}.jpg", photo(), "image/jpeg", sha);
        assertThat(r.status()).isEqualTo(422);
    }

    // Port of backend.test.ts «refuses a hash that is not a SHA-256».
    @Test
    void aHashThatIsNotASha256IsValidationFailed() {
        ApiResponse r = api.post("/uploads", slotBody("pet", "nope", 3));
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has("sha256")).isTrue();
    }

    @Test
    void petAndProfileSlotsNeedASession() {
        String sha = Hashing.sha256Hex(photo());
        ApiResponse anonymous = api.post("/uploads", slotBody("pet", sha, 3));
        assertThat(anonymous.errorCode()).isEqualTo("validation_failed");
        assertThat(anonymous.json().at("/error/fields").has("purpose")).isTrue();
        accounts.signIn(api, "ana@correo.co");
        assertThat(api.post("/uploads", slotBody("pet", sha, 3)).status()).isEqualTo(201);
    }

    @Test
    void twentySlotsPerCallerPerTenMinutes() {
        for (int i = 0; i < 20; i++) {
            assertThat(api.post("/uploads", slotBody("sighting", Hashing.sha256Hex(photo()), 3)).status()).isEqualTo(201);
        }
        assertThat(api.post("/uploads", slotBody("sighting", Hashing.sha256Hex(photo()), 3)).errorCode()).isEqualTo("rate_limited");
        clock.advance(Duration.ofMinutes(10).plusSeconds(1));
        assertThat(api.post("/uploads", slotBody("sighting", Hashing.sha256Hex(photo()), 3)).status()).isEqualTo(201);
    }

    @Test
    void tooBigOrNotJpegIsValidationFailed() {
        String sha = Hashing.sha256Hex(photo());
        assertThat(api.post("/uploads", slotBody("sighting", sha, 10_000_001)).errorCode()).isEqualTo("validation_failed");
        assertThat(api.post("/uploads", """
                {"purpose":"sighting","sha256":"%s","content_type":"image/png","bytes":3}""".formatted(sha)).errorCode())
                .isEqualTo("validation_failed");
    }
}
```

`B/src/test/java/co/scuby/uploads/PhotoAttachmentsTest.java`:

```java
package co.scuby.uploads;

import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.TestDb;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@IntegrationTest
class PhotoAttachmentsTest {

    @Autowired PhotoAttachments attachments;
    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired MutableClock clock;

    ApiClient api;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
    }

    /** Takes a slot as this browser, optionally sends the bytes; returns the photo URL and the browser's Caller. */
    private Map.Entry<String, Caller> upload(String purpose, boolean sendBytes) {
        byte[] bytes = UploadsTest.photo();
        String sha = Hashing.sha256Hex(bytes);
        var slot = api.post("/uploads", UploadsTest.slotBody(purpose, sha, bytes.length));
        if (sendBytes) api.rawBytes(HttpMethod.PUT, "/dev-media/{sha}.jpg", bytes, "image/jpeg", sha);
        Caller caller = new Caller(null, Hashing.sha256Hex(api.cookie("device").orElseThrow()), "i".repeat(64));
        return Map.entry(slot.str("/url"), caller);
    }

    private String reasonOf(ApiException e) {
        return String.valueOf(e.getBody().getProperties().get("fields"));
    }

    @Test
    void aProcessedPhotoThisCallerUploadedForThisPurposeIsAccepted() {
        var up = upload("sighting", true);
        assertThatCode(() -> attachments.requireAttachable(List.of(up.getKey()), UploadPurpose.sighting, up.getValue(), "photo_urls"))
                .doesNotThrowAnyException();
    }

    @Test
    void anotherCallersPhotoIsRefused() {
        var up = upload("sighting", true);
        Caller stranger = new Caller(null, "e".repeat(64), "i".repeat(64));
        assertThatThrownBy(() -> attachments.requireAttachable(List.of(up.getKey()), UploadPurpose.sighting, stranger, "photo_urls"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(reasonOf(e)).contains("photo_urls"));
    }

    @Test
    void anotherPurposeIsRefused() {
        var up = upload("sighting", true);
        assertThatThrownBy(() -> attachments.requireAttachable(List.of(up.getKey()), UploadPurpose.claim, up.getValue(), "photo_urls"))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void unprocessedBytesAreRefused() {
        var up = upload("sighting", false);
        assertThatThrownBy(() -> attachments.requireAttachable(List.of(up.getKey()), UploadPurpose.sighting, up.getValue(), "photo_urls"))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void aSlotOlderThanTheAttachWindowIsRefused() {
        var up = upload("sighting", true);
        clock.advance(Duration.ofHours(24).plusSeconds(1));
        assertThatThrownBy(() -> attachments.requireAttachable(List.of(up.getKey()), UploadPurpose.sighting, up.getValue(), "photo_urls"))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void aForeignUrlIsRefusedAndAnEmptyListPasses() {
        Caller c = new Caller(UUID.randomUUID(), "d".repeat(64), "i".repeat(64));
        assertThatThrownBy(() -> attachments.requireAttachable(List.of("https://evil.example/x.jpg"), UploadPurpose.sighting, c, "photo_urls"))
                .isInstanceOf(ApiException.class);
        assertThatCode(() -> attachments.requireAttachable(List.of(), UploadPurpose.sighting, c, "photo_urls")).doesNotThrowAnyException();
    }
}
```

`B/src/test/java/co/scuby/uploads/UploadSlotPlanTest.java`:

```java
package co.scuby.uploads;

import co.scuby.support.IntegrationTest;
import co.scuby.support.PlanAssert;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;

/** The slot rate-limit count (a rate-limit count: design · Queries and indexes). */
@IntegrationTest
class UploadSlotPlanTest {

    @Autowired DSLContext db;
    @Autowired TestDb testDb;
    @Autowired UploadSlots slots;

    @BeforeEach
    void setUp() { testDb.reset(); }

    @Test
    void theSlotCountUsesThePrimaryKeyPrefix() {
        db.execute("""
                INSERT INTO scuby.upload (owner_key, sha256, purpose, bytes, created_at)
                SELECT 'd:' || md5((g % 3000)::text) || md5('k'), md5(g::text) || md5(g::text), 'sighting', 1000,
                       timestamptz '2026-01-01' + g * interval '1 minute'
                FROM generate_series(1, 30000) g""");
        db.execute("ANALYZE scuby.upload");
        PlanAssert.assertNoSeqScanOn(db, slots.recentSlotsQuery("d:" + "a".repeat(64), Instant.parse("2026-10-14T16:50:00Z")), "upload");
    }
}
```

- [ ] **Step 2: Run to see them fail**

Run: `[mvn] -q test -Dtest='UploadsTest,PhotoAttachmentsTest,UploadSlotPlanTest'`
Expected: compilation FAILURE (`PhotoAttachments`, `UploadSlots`, `UPLOAD` not found).

- [ ] **Step 3: Migration**

`B/src/main/resources/db/migration/V20261030_1000__uploads.sql`:

```sql
-- Upload slots (docs/eng/api.md · Uploads; decision #36): who took a slot for which photo and purpose.
-- A publish or sighting may attach only photos its caller took a slot for, for that purpose.
-- owner_key = 'p:<person uuid>' when signed in, else 'd:<device hash>' (no device table: backend.md · Security).
-- The primary key also serves the per-caller slot count (owner_key prefix) and the attach lookup.
CREATE TABLE upload (
  owner_key   text NOT NULL CHECK (owner_key ~ '^(p:[0-9a-f-]{36}|d:[0-9a-f]{64})$'),
  sha256      text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  purpose     text NOT NULL CHECK (purpose IN ('pet', 'sighting', 'claim', 'evidence', 'profile')),
  bytes       int  NOT NULL CHECK (bytes BETWEEN 1 AND 10000000),
  created_at  timestamptz NOT NULL,
  PRIMARY KEY (owner_key, sha256, purpose)
);
```

- [ ] **Step 4: Code**

Add to `Hashing.java`:

```java
    public static String sha256Hex(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }
```

`UploadPurpose.java`:

```java
package co.scuby.uploads;

import co.scuby.platform.modules.ModuleApi;

/** What a photo is for (web/src/contracts/actions.ts). Constants are the wire values. */
@ModuleApi
public enum UploadPurpose {
    pet, sighting, claim, evidence, profile;

    /** Publishing a pet and editing a profile already need an account. */
    boolean needsSession() {
        return this == pet || this == profile;
    }
}
```

`UploadTarget.java`:

```java
package co.scuby.uploads;

import java.time.Instant;
import java.util.Map;

/** The contract's `upload` object: where and how to PUT the bytes. */
record UploadTarget(String method, String url, Map<String, String> headers, Instant expiresAt) {}
```

`MediaStore.java`:

```java
package co.scuby.uploads;

import java.time.Instant;
import java.util.Optional;

/** Where photo bytes live: a development directory (local, test) or S3 + the ingest Lambda (staging, prod). */
interface MediaStore {

    /** The photo's public URL — derived from the hash, so a re-upload is the same URL. */
    String publicUrl(String sha256);

    /** The hash back from a URL this store issued; empty for anything else. */
    Optional<String> sha256Of(String url);

    /** True when the processed bytes exist (local: the PUT arrived; S3: the ingest Lambda wrote media/{sha}.jpg). */
    boolean isStored(String sha256);

    UploadTarget presign(String sha256, long bytes, Instant expiresAt);
}
```

`MediaProperties.java`:

```java
package co.scuby.uploads;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * scuby.media.*: store = local | s3; publicBaseUrl = where photo URLs point (local: the API's
 * /dev-media; staging/prod: the image CDN); localDir for the local store; bucket/region for S3.
 */
@ConfigurationProperties("scuby.media")
record MediaProperties(String store, String publicBaseUrl, String localDir, String bucket, String region,
                       Duration slotTtl, int maxSlotsPer10Min, Duration attachWindow) {}
```

`LocalMediaStore.java`:

```java
package co.scuby.uploads;

import co.scuby.platform.cache.ClearableCache;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Local and test only: bytes in a directory, "processed" the moment they arrive (as the client mock). */
final class LocalMediaStore implements MediaStore, ClearableCache {

    private final String base;
    private final Path dir;
    private final Pattern own;

    LocalMediaStore(MediaProperties properties) {
        this.base = properties.publicBaseUrl().replaceAll("/+$", "");
        this.dir = Path.of(properties.localDir());
        this.own = Pattern.compile("^" + Pattern.quote(base) + "/([0-9a-f]{64})\\.jpg$");
        try {
            Files.createDirectories(dir);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Override public String publicUrl(String sha256) { return base + "/" + sha256 + ".jpg"; }

    @Override
    public Optional<String> sha256Of(String url) {
        Matcher m = own.matcher(url);
        return m.matches() ? Optional.of(m.group(1)) : Optional.empty();
    }

    @Override public boolean isStored(String sha256) { return Files.exists(file(sha256)); }

    @Override
    public UploadTarget presign(String sha256, long bytes, Instant expiresAt) {
        return new UploadTarget("PUT", publicUrl(sha256), Map.of("content-type", "image/jpeg"), expiresAt);
    }

    void store(String sha256, byte[] bytes) {
        try {
            Files.write(file(sha256), bytes);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    Optional<byte[]> read(String sha256) {
        try {
            return isStored(sha256) ? Optional.of(Files.readAllBytes(file(sha256))) : Optional.empty();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** Tests only (TestDb.reset): forget every stored photo. */
    @Override
    public void clear() {
        try (var files = Files.list(dir)) {
            files.forEach(f -> f.toFile().delete());
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private Path file(String sha256) {
        return dir.resolve(sha256 + ".jpg");
    }
}
```

`MediaConfiguration.java`:

```java
package co.scuby.uploads;

import co.scuby.platform.config.Prod;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

@Configuration(proxyBeanMethods = false)
class MediaConfiguration {

    @Bean
    @ConditionalOnProperty(name = "scuby.media.store", havingValue = "local", matchIfMissing = true)
    LocalMediaStore localMediaStore(MediaProperties properties, Environment env) {
        Prod.refuse(env, true, "scuby.media.store=local (photos would be served by the API)");
        return new LocalMediaStore(properties);
    }
}
```

`DevMediaController.java`:

```java
package co.scuby.uploads;

import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.springframework.context.annotation.Profile;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * The development bucket (local and test profiles only): stands in for the presigned S3 PUT and the
 * image CDN. Like S3 with x-amz-checksum-sha256, it refuses bytes that do not match the hash.
 */
@ApiComponent
@RestController
@Profile({"local", "test"})
class DevMediaController {

    private final LocalMediaStore store;

    DevMediaController(LocalMediaStore store) {
        this.store = store;
    }

    @PutMapping("/dev-media/{sha256:[0-9a-f]{64}}.jpg")
    ResponseEntity<Void> put(@PathVariable String sha256, @RequestBody byte[] bytes) {
        if (!Hashing.sha256Hex(bytes).equals(sha256)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "bytes do not match the hash", Map.of("(body)", "sha256 mismatch"), Map.of());
        }
        store.store(sha256, bytes);
        return ResponseEntity.ok().build();
    }

    @GetMapping("/dev-media/{sha256:[0-9a-f]{64}}.jpg")
    ResponseEntity<byte[]> get(@PathVariable String sha256) {
        return store.read(sha256)
                    .map(b -> ResponseEntity.ok().contentType(MediaType.IMAGE_JPEG).body(b))
                    .orElseGet(() -> ResponseEntity.notFound().build());
    }
}
```

`UploadRequest.java`:

```java
package co.scuby.uploads;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;

/** UploadRequest (web/src/contracts/actions.ts). */
record UploadRequest(@NotNull UploadPurpose purpose,
                     @NotNull @Pattern(regexp = "^[0-9a-f]{64}$") String sha256,
                     @NotNull @Pattern(regexp = "^image/jpeg$") String contentType,
                     @NotNull @Positive @Max(10_000_000) Long bytes) {}
```

`UploadView.java`:

```java
package co.scuby.uploads;

import org.jspecify.annotations.Nullable;

/** The contract's Upload: `upload` is null when the photo is already stored. */
record UploadView(String url, @Nullable UploadTarget upload) {}
```

`UploadSlots.java`:

```java
package co.scuby.uploads;

import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.jooq.DSLContext;
import org.jooq.Record1;
import org.jooq.Select;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;

import static co.scuby.db.generated.Tables.UPLOAD;

@Service
class UploadSlots {

    private final DSLContext db;
    private final Clock clock;
    private final MediaStore store;
    private final MediaProperties properties;

    UploadSlots(DSLContext db, Clock clock, MediaStore store, MediaProperties properties) {
        this.db = db;
        this.clock = clock;
        this.store = store;
        this.properties = properties;
    }

    @Transactional
    public UploadView slot(UploadRequest request, Caller caller) {
        if (request.purpose().needsSession() && !caller.signedIn()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "this purpose needs a session",
                    Map.of("purpose", "needs a signed-in session"), Map.of());
        }
        Instant now = clock.instant();
        int recent = recentSlotsQuery(caller.ownerKey(), now.minus(Duration.ofMinutes(10))).fetchOne().value1();
        if (recent >= properties.maxSlotsPer10Min()) throw new ApiException(ErrorCode.RATE_LIMITED, "too many upload slots");

        db.insertInto(UPLOAD)
          .set(UPLOAD.OWNER_KEY, caller.ownerKey())
          .set(UPLOAD.SHA256, request.sha256())
          .set(UPLOAD.PURPOSE, request.purpose().name())
          .set(UPLOAD.BYTES, request.bytes().intValue())
          .set(UPLOAD.CREATED_AT, now.atOffset(ZoneOffset.UTC))
          .onConflict(UPLOAD.OWNER_KEY, UPLOAD.SHA256, UPLOAD.PURPOSE).doUpdate()
          .set(UPLOAD.CREATED_AT, now.atOffset(ZoneOffset.UTC))
          .set(UPLOAD.BYTES, request.bytes().intValue())
          .execute();

        String url = store.publicUrl(request.sha256());
        UploadTarget target = store.isStored(request.sha256())
                ? null
                : store.presign(request.sha256(), request.bytes(), now.plus(properties.slotTtl()));
        return new UploadView(url, target);
    }

    Select<Record1<Integer>> recentSlotsQuery(String ownerKey, Instant since) {
        return db.select(DSL.count()).from(UPLOAD)
                 .where(UPLOAD.OWNER_KEY.eq(ownerKey))
                 .and(UPLOAD.CREATED_AT.gt(since.atOffset(ZoneOffset.UTC)));
    }
}
```

`UploadsController.java`:

```java
package co.scuby.uploads;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Caller;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@ApiComponent
@RestController
class UploadsController {

    private final UploadSlots slots;

    UploadsController(UploadSlots slots) {
        this.slots = slots;
    }

    @PostMapping("/uploads")
    @ResponseStatus(HttpStatus.CREATED)
    UploadView slot(Caller caller, @Valid @RequestBody UploadRequest body) {
        return slots.slot(body, caller);
    }
}
```

`PhotoAttachments.java`:

```java
package co.scuby.uploads;

import co.scuby.platform.modules.ModuleApi;
import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.jooq.DSLContext;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static co.scuby.db.generated.Tables.UPLOAD;

/** The publish-side check of docs/eng/api.md · Uploads: only this caller's processed photos, for this purpose. */
@ModuleApi
@Component
public class PhotoAttachments {

    static final String REASON = "photo not uploaded by this caller for this purpose, or not processed yet";

    private final DSLContext db;
    private final Clock clock;
    private final MediaStore store;
    private final MediaProperties properties;

    PhotoAttachments(DSLContext db, Clock clock, MediaStore store, MediaProperties properties) {
        this.db = db;
        this.clock = clock;
        this.store = store;
        this.properties = properties;
    }

    public void requireAttachable(List<String> photoUrls, UploadPurpose purpose, Caller caller, String field) {
        if (photoUrls.isEmpty()) return;
        List<String> hashes = new ArrayList<>();
        for (String url : photoUrls) {
            Optional<String> sha = store.sha256Of(url);
            if (sha.isEmpty()) throw refused(field);
            hashes.add(sha.get());
        }
        List<String> owners = caller.signedIn()
                ? List.of("p:" + caller.personId(), "d:" + caller.deviceHash())
                : List.of("d:" + caller.deviceHash());
        Set<String> slotted = db.select(UPLOAD.SHA256).from(UPLOAD)
                                .where(UPLOAD.OWNER_KEY.in(owners))
                                .and(UPLOAD.SHA256.in(hashes))
                                .and(UPLOAD.PURPOSE.eq(purpose.name()))
                                .and(UPLOAD.CREATED_AT.gt(clock.instant().minus(properties.attachWindow()).atOffset(ZoneOffset.UTC)))
                                .fetchSet(UPLOAD.SHA256);
        for (String sha : hashes) {
            if (!slotted.contains(sha) || !store.isStored(sha)) throw refused(field);
        }
    }

    private static ApiException refused(String field) {
        return new ApiException(ErrorCode.VALIDATION_FAILED, REASON, Map.of(field, REASON), Map.of());
    }
}
```

Configuration. `application.yml`, thin-slice `scuby:` block:

```yaml
  media:
    store: local
    public-base-url: http://localhost:8080/dev-media
    local-dir: ${java.io.tmpdir}/scuby-dev-media
    bucket: ""
    region: ""
    slot-ttl: 5m
    max-slots-per10-min: 20
    attach-window: 24h
```

Check the property name binds: `maxSlotsPer10Min` → kebab `max-slots-per10-min`. If binding fails at start-up, rename the record component to `maxSlotsPerTenMinutes` and the key to `max-slots-per-ten-minutes` (do it in both places).

`application-test.yml`, under `scuby:`:

```yaml
  media:
    public-base-url: http://localhost/dev-media
    local-dir: ${java.io.tmpdir}/scuby-dev-media-test
```

`application-local.yml` needs nothing (defaults are local). In `B/compose.yaml`, under `backend.environment`, add:

```yaml
      SCUBY_MEDIA_PUBLIC_BASE_URL: http://localhost:8080/dev-media
      SCUBY_MEDIA_LOCAL_DIR: /tmp/scuby-dev-media
```

`TestDb.MUTABLE_TABLES`: add `"upload"`. `StatementCeilings`: add `Map.entry("POST /uploads", 3)` (session lookup, count, upsert).

- [ ] **Step 5: Run**

Run: `[mvn] -q test -Dtest='UploadsTest,PhotoAttachmentsTest,UploadSlotPlanTest,ArchitectureTest'`
Expected: PASS. `UploadSlotPlanTest` prints an `Index Scan … using upload_pkey` (or Bitmap) plan: **no new index** — the primary key serves the count. Record the plan in the report. If it shows a seq scan instead, stop and report (do not add an index without the measurement story).

- [ ] **Step 6: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add backend/src/main/resources/db/migration/V20261030_1000__uploads.sql backend/src/main/java/co/scuby/uploads backend/src/main/java/co/scuby/platform/crypto/Hashing.java backend/src/main/resources/application*.yml backend/compose.yaml backend/src/test/java/co/scuby/uploads backend/src/test/java/co/scuby/support
git commit -m "feat: upload slots scoped to caller and purpose, a development bucket, and PhotoAttachments for publish-side checks"
```

---

### Task 2: S3 media store for staging (presigned PUT signed with the photo's SHA-256)

**Files:**
- Create: `B/src/main/java/co/scuby/uploads/S3MediaStore.java`
- Modify: `B/src/main/java/co/scuby/uploads/MediaConfiguration.java`
- Modify: `B/src/main/resources/application-staging.yml`
- Test: `B/src/test/java/co/scuby/uploads/S3MediaStoreTest.java`

**Interfaces:**
- Consumes: `MediaStore`, `MediaProperties`, `UploadTarget` (Task 1).
- Produces: `S3MediaStore(MediaProperties, AwsCredentialsProvider)` — `presign` → a PUT to `https://<bucket>.s3.<region>.amazonaws.com/incoming/<sha256>.jpg`, valid `slot-ttl`, signed with `Content-Type: image/jpeg`, `Content-Length` and `x-amz-checksum-sha256` (base64 of the hash), so S3 rejects other bytes (`docs/eng/infra.md` · Media); `isStored` = `HeadObject media/<sha256>.jpg` (written by the ingest Lambda); `publicUrl` = `<public-base-url>/<sha256>.jpg`. Selected by `scuby.media.store=s3`.

- [ ] **Step 1: Write the failing test** (no network: presigning is local computation)

`B/src/test/java/co/scuby/uploads/S3MediaStoreTest.java`:

```java
package co.scuby.uploads;

import org.junit.jupiter.api.Test;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;

import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;

import static org.assertj.core.api.Assertions.assertThat;

class S3MediaStoreTest {

    static final String SHA = "b".repeat(64);

    private final S3MediaStore store = new S3MediaStore(
            new MediaProperties("s3", "https://img.scuby.example", "", "scuby-media-staging", "us-east-1",
                    Duration.ofMinutes(5), 20, Duration.ofHours(24)),
            StaticCredentialsProvider.create(AwsBasicCredentials.create("AKIDEXAMPLE", "secret")));

    @Test
    void presignsAPutIntoIncomingSignedWithTheHash() {
        Instant now = Instant.parse("2026-10-14T17:00:00Z");
        UploadTarget t = store.presign(SHA, 3000, now.plus(Duration.ofMinutes(5)));
        assertThat(t.method()).isEqualTo("PUT");
        assertThat(t.url()).startsWith("https://scuby-media-staging.s3.us-east-1.amazonaws.com/incoming/" + SHA + ".jpg?")
                           .contains("X-Amz-Expires=");
        String checksum = Base64.getEncoder().encodeToString(HexFormat.of().parseHex(SHA));
        assertThat(t.headers()).containsEntry("x-amz-checksum-sha256", checksum)
                               .containsEntry("content-type", "image/jpeg")
                               .doesNotContainKey("host");
    }

    @Test
    void urlsDeriveFromTheHashAndRoundTrip() {
        assertThat(store.publicUrl(SHA)).isEqualTo("https://img.scuby.example/" + SHA + ".jpg");
        assertThat(store.sha256Of(store.publicUrl(SHA))).contains(SHA);
        assertThat(store.sha256Of("https://elsewhere.example/" + SHA + ".jpg")).isEmpty();
    }
}
```

- [ ] **Step 2: Run to see it fail**

Run: `[mvn] -q test -Dtest=S3MediaStoreTest`
Expected: compilation FAILURE (`S3MediaStore` not found).

- [ ] **Step 3: Implement**

`B/src/main/java/co/scuby/uploads/S3MediaStore.java`:

```java
package co.scuby.uploads;

import software.amazon.awssdk.auth.credentials.AwsCredentialsProvider;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.PresignedPutObjectRequest;

import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Staging and production (docs/eng/infra.md · Media): a presigned PUT into incoming/, signed with the
 * photo's SHA-256 so S3 refuses other bytes; the ingest Lambda writes media/{sha}.jpg, which is
 * what "stored" means. No image work in the JVM.
 */
final class S3MediaStore implements MediaStore {

    private final MediaProperties properties;
    private final S3Presigner presigner;
    private final S3Client s3;
    private final Pattern own;

    S3MediaStore(MediaProperties properties, AwsCredentialsProvider credentials) {
        this.properties = properties;
        Region region = Region.of(properties.region());
        this.presigner = S3Presigner.builder().region(region).credentialsProvider(credentials).build();
        this.s3 = S3Client.builder().region(region).credentialsProvider(credentials)
                          .httpClient(UrlConnectionHttpClient.create()).build();
        String base = properties.publicBaseUrl().replaceAll("/+$", "");
        this.own = Pattern.compile("^" + Pattern.quote(base) + "/([0-9a-f]{64})\\.jpg$");
    }

    @Override
    public String publicUrl(String sha256) {
        return properties.publicBaseUrl().replaceAll("/+$", "") + "/" + sha256 + ".jpg";
    }

    @Override
    public Optional<String> sha256Of(String url) {
        Matcher m = own.matcher(url);
        return m.matches() ? Optional.of(m.group(1)) : Optional.empty();
    }

    @Override
    public boolean isStored(String sha256) {
        try {
            s3.headObject(b -> b.bucket(properties.bucket()).key("media/" + sha256 + ".jpg"));
            return true;
        } catch (S3Exception e) {
            if (e.statusCode() == 404) return false;
            throw e;
        }
    }

    @Override
    public UploadTarget presign(String sha256, long bytes, Instant expiresAt) {
        String checksum = Base64.getEncoder().encodeToString(HexFormat.of().parseHex(sha256));
        PutObjectRequest put = PutObjectRequest.builder()
                .bucket(properties.bucket())
                .key("incoming/" + sha256 + ".jpg")
                .contentType("image/jpeg")
                .contentLength(bytes)
                .checksumSHA256(checksum)
                .build();
        PresignedPutObjectRequest signed = presigner.presignPutObject(r -> r
                .signatureDuration(properties.slotTtl())
                .putObjectRequest(put));
        Map<String, String> headers = new LinkedHashMap<>();
        signed.signedHeaders().forEach((name, values) -> {
            String key = name.toLowerCase(Locale.ROOT);
            if (!key.equals("host")) headers.put(key, String.join(",", values));
        });
        return new UploadTarget("PUT", signed.url().toString(), headers, expiresAt);
    }
}
```

In `MediaConfiguration` add:

```java
    @Bean
    @ConditionalOnProperty(name = "scuby.media.store", havingValue = "s3")
    MediaStore s3MediaStore(MediaProperties properties) {
        // The instance role authorises S3 (docs/eng/infra.md · Secrets): the default chain finds it.
        return new S3MediaStore(properties, software.amazon.awssdk.auth.credentials.DefaultCredentialsProvider.builder().build());
    }
```

and change the local bean's return type to `LocalMediaStore` (already) — Spring exposes it as `MediaStore` too, since `LocalMediaStore implements MediaStore`.

If `DefaultCredentialsProvider.builder()` does not exist in 2.57.6, use `DefaultCredentialsProvider.create()`.

`B/src/main/resources/application-staging.yml` — append:

```yaml
# thin slice: photos through S3 + the ingest Lambda (values from infra: docs/eng/infra.md · Media)
scuby:
  media:
    store: s3
    bucket: ${SCUBY_MEDIA_BUCKET}
    region: ${SCUBY_MEDIA_REGION}
    public-base-url: ${SCUBY_MEDIA_PUBLIC_BASE_URL}
```

If the test shows `content-length` missing from the signed headers or an extra `x-amz-sdk-checksum-algorithm`, keep what the SDK signs (all of it must be sent by the client) and adjust the assertion to `containsEntry` only for the two headers the test names; note it in the report.

- [ ] **Step 4: Run**

Run: `[mvn] -q test -Dtest='S3MediaStoreTest,UploadsTest'`
Expected: PASS (2 + 7). The test context still uses the local store (profile `test`).

- [ ] **Step 5: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add backend/src/main/java/co/scuby/uploads backend/src/main/resources/application-staging.yml backend/src/test/java/co/scuby/uploads/S3MediaStoreTest.java
git commit -m "feat: S3 media store for staging — presigned PUT into incoming/ signed with the photo's SHA-256"
```

---

### Task 3: The `pets` foundation

**Files:**
- Create: `B/src/main/resources/db/migration/V20261030_1010__pets.sql`
- Create: `B/src/main/java/co/scuby/pets/Pets.java`
- Modify: `TestDb.java`
- Test: `B/src/test/java/co/scuby/pets/PetsTest.java`

**Interfaces:**
- Produces: `@ModuleApi public class Pets` with nested `public enum Species { dog, cat, other }`, `public enum Size { small, medium, large }`, `public enum Color { black, white, brown, tan, gray, yellow, orange }`, `public record NewPet(String name, Species species, @Nullable Size size, List<Color> colors, @Nullable String marks, @Nullable String chipNumber, List<String> photoUrls)`; methods `public UUID createOwned(UUID ownerPersonId, NewPet pet)` (pet row with `custody_state = 'claimed'` + an active `owner` responsibility link, in the caller's transaction), `public void requireOwnedBy(String petId, UUID personId)` (throws `ApiException(NOT_FOUND)` when the id is malformed, unknown, or not this person's as active owner). Tables `pet`, `responsibility_link` (`docs/product/04-lost-workflow.md` · Publishing).

- [ ] **Step 1: Write the failing test**

`B/src/test/java/co/scuby/pets/PetsTest.java`:

```java
package co.scuby.pets;

import co.scuby.platform.web.ApiException;
import co.scuby.support.Accounts;
import co.scuby.support.IntegrationTest;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.UUID;

import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.RESPONSIBILITY_LINK;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@IntegrationTest
class PetsTest {

    @Autowired Pets pets;
    @Autowired Accounts accounts;
    @Autowired TestDb testDb;
    @Autowired DSLContext db;
    @Autowired TransactionTemplate tx;

    static final Pets.NewPet KIRA = new Pets.NewPet("Kira", Pets.Species.dog, Pets.Size.medium,
            List.of(Pets.Color.brown), null, null, List.of());

    @BeforeEach
    void setUp() { testDb.reset(); }

    @Test
    void createsThePetAndTheOwnerLinkTogether() {
        UUID ana = accounts.person("ana@correo.co");
        UUID pet = tx.execute(s -> pets.createOwned(ana, KIRA));
        var row = db.selectFrom(PET).where(PET.ID.eq(pet)).fetchOne();
        assertThat(row.getName()).isEqualTo("Kira");
        assertThat(row.getCustodyState()).isEqualTo("claimed");
        assertThat(row.getColors()).containsExactly("brown");
        var link = db.selectFrom(RESPONSIBILITY_LINK).where(RESPONSIBILITY_LINK.PET_ID.eq(pet)).fetchOne();
        assertThat(link.getPersonId()).isEqualTo(ana);
        assertThat(link.getRole()).isEqualTo("owner");
        assertThat(link.getActiveTo()).isNull();
    }

    @Test
    void ownershipIsCheckedAndAnythingElseIsNotFound() {
        UUID ana = accounts.person("ana@correo.co");
        UUID bob = accounts.person("bob@correo.co");
        UUID pet = tx.execute(s -> pets.createOwned(ana, KIRA));
        assertThatCode(() -> pets.requireOwnedBy(pet.toString(), ana)).doesNotThrowAnyException();
        assertThatThrownBy(() -> pets.requireOwnedBy(pet.toString(), bob)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> pets.requireOwnedBy(UUID.randomUUID().toString(), ana)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> pets.requireOwnedBy("pet-1", ana)).isInstanceOf(ApiException.class);
    }

    @Test
    void aPetHasAtMostOneActiveOwner() {
        UUID ana = accounts.person("ana@correo.co");
        UUID bob = accounts.person("bob@correo.co");
        UUID pet = tx.execute(s -> pets.createOwned(ana, KIRA));
        assertThatThrownBy(() -> db.execute(
                "INSERT INTO scuby.responsibility_link (id, person_id, pet_id, role, active_from) VALUES (gen_random_uuid(), ?, ?, 'owner', now())",
                bob, pet)).hasMessageContaining("responsibility_link_one_active_owner");
    }
}
```

- [ ] **Step 2: Run to see it fail**

Run: `[mvn] -q test -Dtest=PetsTest` → compilation FAILURE (`Pets` not found).

- [ ] **Step 3: Migration**

`B/src/main/resources/db/migration/V20261030_1010__pets.sql`:

```sql
-- The pet record every vertical shares, and who is responsible for it
-- (docs/product/01-actors-and-entities.md; docs/product/04-lost-workflow.md · Publishing).
-- Written only by the pets feature. pet_is_lost is derived from cases, never stored.
CREATE TABLE pet (
  id             uuid PRIMARY KEY,
  name           text CHECK (length(name) BETWEEN 1 AND 60),
  species        text NOT NULL CHECK (species IN ('dog', 'cat', 'other')),
  size           text CHECK (size IN ('small', 'medium', 'large')),
  colors         text[] NOT NULL DEFAULT '{}'
                   CHECK (colors <@ ARRAY['black', 'white', 'brown', 'tan', 'gray', 'yellow', 'orange']),
  marks          text CHECK (length(marks) <= 500),
  chip_number    text CHECK (length(chip_number) <= 40),
  photo_urls     text[] NOT NULL DEFAULT '{}' CHECK (cardinality(photo_urls) <= 6),
  custody_state  text NOT NULL CHECK (custody_state IN ('claimed', 'unclaimed', 'org_held')),
  created_at     timestamptz NOT NULL
);

CREATE TABLE responsibility_link (
  id           uuid PRIMARY KEY,
  person_id    uuid NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  pet_id       uuid NOT NULL REFERENCES pet (id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('owner')),
  active_from  timestamptz NOT NULL,
  active_to    timestamptz
);

-- An invariant, not a performance index: a pet has at most one active owner. It also serves the
-- ownership check (WHERE pet_id = ? AND role = 'owner' AND active_to IS NULL). Write cost: one
-- entry per owner link (one per pet). Needs human approval before merge.
CREATE UNIQUE INDEX responsibility_link_one_active_owner
  ON responsibility_link (pet_id) WHERE role = 'owner' AND active_to IS NULL;
```

- [ ] **Step 4: Code**

`B/src/main/java/co/scuby/pets/Pets.java`:

```java
package co.scuby.pets;

import co.scuby.platform.modules.ModuleApi;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.jooq.DSLContext;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.RESPONSIBILITY_LINK;

/** The only writer of `pet` and `responsibility_link`. Enum constants are the wire values. */
@ModuleApi
@Component
public class Pets {

    public enum Species { dog, cat, other }

    public enum Size { small, medium, large }

    public enum Color { black, white, brown, tan, gray, yellow, orange }

    public record NewPet(String name, Species species, @Nullable Size size, List<Color> colors,
                         @Nullable String marks, @Nullable String chipNumber, List<String> photoUrls) {}

    private final DSLContext db;
    private final Clock clock;

    Pets(DSLContext db, Clock clock) {
        this.db = db;
        this.clock = clock;
    }

    /** The pet and its active owner link, in the caller's transaction (04 · Publishing: one transaction). */
    public UUID createOwned(UUID ownerPersonId, NewPet pet) {
        UUID id = UUID.randomUUID();
        OffsetDateTime now = clock.instant().atOffset(ZoneOffset.UTC);
        db.insertInto(PET)
          .set(PET.ID, id)
          .set(PET.NAME, pet.name())
          .set(PET.SPECIES, pet.species().name())
          .set(PET.SIZE, pet.size() == null ? null : pet.size().name())
          .set(PET.COLORS, pet.colors().stream().map(Enum::name).toArray(String[]::new))
          .set(PET.MARKS, pet.marks())
          .set(PET.CHIP_NUMBER, pet.chipNumber())
          .set(PET.PHOTO_URLS, pet.photoUrls().toArray(String[]::new))
          .set(PET.CUSTODY_STATE, "claimed")
          .set(PET.CREATED_AT, now)
          .execute();
        db.insertInto(RESPONSIBILITY_LINK)
          .set(RESPONSIBILITY_LINK.ID, UUID.randomUUID())
          .set(RESPONSIBILITY_LINK.PERSON_ID, ownerPersonId)
          .set(RESPONSIBILITY_LINK.PET_ID, id)
          .set(RESPONSIBILITY_LINK.ROLE, "owner")
          .set(RESPONSIBILITY_LINK.ACTIVE_FROM, now)
          .execute();
        return id;
    }

    /** not_found unless the person is the pet's active owner (the contract's publishLost not_found). */
    public void requireOwnedBy(String petId, UUID personId) {
        UUID id;
        try {
            id = UUID.fromString(petId);
        } catch (IllegalArgumentException e) {
            throw new ApiException(ErrorCode.NOT_FOUND, "no such pet");
        }
        boolean owned = db.fetchExists(RESPONSIBILITY_LINK,
                RESPONSIBILITY_LINK.PET_ID.eq(id),
                RESPONSIBILITY_LINK.PERSON_ID.eq(personId),
                RESPONSIBILITY_LINK.ROLE.eq("owner"),
                RESPONSIBILITY_LINK.ACTIVE_TO.isNull());
        if (!owned) throw new ApiException(ErrorCode.NOT_FOUND, "no such pet");
    }
}
```

`TestDb.MUTABLE_TABLES`: add `"pet"`, `"responsibility_link"`.

- [ ] **Step 5: Run**

Run: `[mvn] -q test -Dtest='PetsTest,ArchitectureTest'` → PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add backend/src/main/resources/db/migration/V20261030_1010__pets.sql backend/src/main/java/co/scuby/pets backend/src/test/java/co/scuby/pets backend/src/test/java/co/scuby/support/TestDb.java
git commit -m "feat: pets foundation — pet and owner responsibility link, ownership check"
```

---
### Task 4: `POST /lost-cases` — publish a lost case

One transaction (`docs/product/04-lost-workflow.md` · Publishing): the pet (new, or an existing one the caller owns), its owner link, and the case. Order of checks (the mock's order, so a blocked publish never sends an SMS): `pet_id` given → must be the caller's (`not_found`) and must have no active case (`active_case_exists`, `details.case_code`); new pet → its photos must be the caller's processed `pet` uploads (`validation_failed` on `pet.photo_urls`); `last_seen_at` more than 5 minutes in the future → `validation_failed` on `last_seen_at` (same tolerance as sightings); then the phone step (`PublisherPhone`, A1) — `CodeSent` answers `{"phone_step":"otp"}` and writes nothing else; `Ready` continues: pet + link (new pet only; with `pet_id` the body's `pet` is ignored, as in the mock), a fresh code, the place name (computed once, stored), the case with `contact_phone` = the resolved number. Answer `{"code": "…"}` with status **200** (the contract's `publishLost`).

**Files:**
- Create: `B/src/main/resources/db/migration/V20261030_1020__lost_cases.sql`
- Create (after the plan check fails): `B/src/main/resources/db/migration/V20261030_1030__one_active_case_per_pet.sql`
- Create in `B/src/main/java/co/scuby/cases/`: `CasesSecurityRules.java`, `CaseCodes.java`, `PlaceNamer.java`, `NoPlaceNamer.java`, `PlaceNames.java`, `PublishLostRequest.java`, `PublishView.java`, `PublishLostService.java`, `PublishLostController.java`
- Modify: `TestDb.java`, `StatementCeilings.java`
- Test: `B/src/test/java/co/scuby/cases/PublishLostTest.java`, `PlaceNamesTest.java`, `CaseCodesTest.java`, `ActiveCasePlanTest.java`
- Create: `B/src/test/java/co/scuby/support/PublishBodies.java`

**Interfaces:**
- Consumes: `PublisherPhone.resolve(UUID, String, String, Caller) → Outcome (Ready(phone, verified) | CodeSent)`; `PhotoAttachments.requireAttachable(List<String>, UploadPurpose, Caller, String)`; `Pets.createOwned(UUID, NewPet)`, `Pets.requireOwnedBy(String, UUID)`; `FeatureFlags.isEnabled(Flag.REVERSE_GEOCODING, UUID)`; `Account`, `Caller`; `GeoPoint`.
- Produces:
  - Tables `lost_case` (code PK, pet_id, created_by, status, published_at, resolved_at, contact_phone, phone_has_whatsapp, expose_whatsapp, expose_email, in_app_only, last_seen_lat, last_seen_lng, generated `last_seen_point geography`, last_seen_radius_m, last_seen_at, place_name nullable) and `purged_case_code (code, purged_at)`.
  - `CaseCodes`: `static final String ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"`, `String newCode()`, `static Optional<String> normalize(String raw)` (upper-cases; empty unless 5 alphabet characters).
  - `interface PlaceNamer { Optional<String> nameFor(GeoPoint point); }`, `NoPlaceNamer` (always empty — no provider in this slice), `PlaceNames.forNewCase(GeoPoint, UUID publisher) → @Nullable String` (null = render the generic label).
  - `record PointInput(Double lat, Double lng)` with `GeoPoint toGeoPoint()` — reused by sightings and the feed (package-private in `cases`).
  - `POST /lost-cases`; statement ceiling 14.
  - Test support `PublishBodies.kira(String phone, String otpCode)` (the mock's `kira` body as JSON), `PublishBodies.withPetId(String petId, String phone)`.

- [ ] **Step 1: Write the failing tests**

`B/src/test/java/co/scuby/support/PublishBodies.java`:

```java
package co.scuby.support;

/** The client mock's `kira` publish body (web/src/mocks/backend.test.ts). */
public final class PublishBodies {

    private PublishBodies() {}

    public static String kira(String phone, String otpCode) {
        return kira(phone, otpCode, "[]", "2026-10-14T08:00:00-05:00", 300);
    }

    public static String kira(String phone, String otpCode, String photoUrlsJson, String lastSeenAt, double radius) {
        return """
                {"pet_id":null,
                 "pet":{"name":"Kira","species":"dog","size":"medium","colors":["brown"],"marks":null,"chip_number":null,"photo_urls":%s},
                 "last_seen_point":{"lat":6.2447,"lng":-75.5916},"last_seen_radius_m":%s,"last_seen_at":"%s",
                 "phone":%s,"phone_has_whatsapp":true,
                 "contact_prefs":{"expose_whatsapp":true,"expose_email":false,"in_app_only":false},
                 "otp_code":%s}""".formatted(photoUrlsJson, radius, lastSeenAt, json(phone), json(otpCode));
    }

    public static String withPetId(String petId, String phone) {
        return kira(phone, null).replace("\"pet_id\":null", "\"pet_id\":\"" + petId + "\"");
    }

    private static String json(String s) {
        return s == null ? "null" : "\"" + s + "\"";
    }
}
```

`B/src/test/java/co/scuby/cases/PublishLostTest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.crypto.Hashing;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.IntegrationTest;
import co.scuby.support.PublishBodies;
import co.scuby.support.RecordingSmsSender;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;

import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PERSON;
import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.RESPONSIBILITY_LINK;
import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class PublishLostTest {

    static final String PHONE = "+573007152284";

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired RecordingSmsSender sms;
    @Autowired DSLContext db;

    ApiClient api;
    UUID ana;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
        ana = accounts.signIn(api, "ana.gomez@correo.co");
    }

    private ApiResponse publish(String body) {
        return api.post("/lost-cases", body);
    }

    private String publishVerified() {
        publish(PublishBodies.kira(PHONE, null));
        return publish(PublishBodies.kira(PHONE, sms.lastCodeFor(PHONE))).str("/code");
    }

    @Test
    void asksForTheSmsCodeFirstThenPublishesEverythingInOneGo() {
        ApiResponse first = publish(PublishBodies.kira(PHONE, null));
        assertThat(first.status()).isEqualTo(200);
        assertThat(first.str("/phone_step")).isEqualTo("otp");
        assertThat(db.fetchCount(LOST_CASE)).isZero();
        assertThat(db.fetchCount(PET)).isZero();

        String wrong = sms.lastCodeFor(PHONE).equals("000000") ? "111111" : "000000";
        assertThat(publish(PublishBodies.kira(PHONE, wrong)).errorCode()).isEqualTo("invalid_code");

        ApiResponse published = publish(PublishBodies.kira(PHONE, sms.lastCodeFor(PHONE)));
        assertThat(published.str("/code")).matches("^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$");
        var row = db.selectFrom(LOST_CASE).fetchOne();
        assertThat(row.getStatus()).isEqualTo("active");
        assertThat(row.getCreatedBy()).isEqualTo(ana);
        assertThat(row.getContactPhone()).isEqualTo(PHONE);
        assertThat(row.getLastSeenRadiusM()).isEqualTo(300.0);
        assertThat(row.getPlaceName()).isNull();                       // reverse_geocoding off
        assertThat(db.fetchExists(RESPONSIBILITY_LINK, RESPONSIBILITY_LINK.PERSON_ID.eq(ana), RESPONSIBILITY_LINK.PET_ID.eq(row.getPetId()))).isTrue();
        assertThat(db.selectFrom(PERSON).where(PERSON.ID.eq(ana)).fetchOne().getPhoneVerifiedAt()).isNotNull();
    }

    @Test
    void theNextPublishWithTheVerifiedNumberGoesStraightThrough() {
        publishVerified();
        int before = sms.sent().size();
        assertThat(publish(PublishBodies.kira(null, null)).str("/code")).isNotNull();
        assertThat(sms.sent()).hasSize(before);
    }

    @Test
    void aSecondActiveCaseForTheSamePetNamesTheOpenOne() {
        String code = publishVerified();
        String petId = db.select(LOST_CASE.PET_ID).from(LOST_CASE).fetchOne().value1().toString();
        ApiResponse r = publish(PublishBodies.withPetId(petId, null));
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("active_case_exists");
        assertThat(r.str("/error/details/case_code")).isEqualTo(code);
    }

    @Test
    void someoneElsesPetOrAMadeUpIdIsNotFound() {
        publishVerified();
        String petId = db.select(LOST_CASE.PET_ID).from(LOST_CASE).fetchOne().value1().toString();
        ApiClient bob = clients.newBrowser();
        accounts.signIn(bob, "bob@correo.co");
        assertThat(bob.post("/lost-cases", PublishBodies.withPetId(petId, PHONE)).errorCode()).isEqualTo("not_found");
        assertThat(publish(PublishBodies.withPetId("pet-1", null)).errorCode()).isEqualTo("not_found");
    }

    @Test
    void noNumberAnywhereIsPhoneRequired() {
        assertThat(publish(PublishBodies.kira(null, null)).errorCode()).isEqualTo("phone_required");
    }

    @Test
    void withTheFlagOffTheCaseGoesLiveWithTheNumberUnverified() {
        db.execute("INSERT INTO scuby.feature_flag_overrides (flag_key, person_id, enabled, reason) VALUES ('publisher_phone_otp', ?, false, 'test')", ana);
        ApiResponse r = publish(PublishBodies.kira(PHONE, null));
        assertThat(r.str("/code")).isNotNull();
        assertThat(sms.sent()).isEmpty();
        assertThat(db.selectFrom(PERSON).where(PERSON.ID.eq(ana)).fetchOne().getPhoneVerifiedAt()).isNull();
    }

    @Test
    void onlyTheCallersProcessedPetPhotosAreAccepted() {
        byte[] bytes = "kira-photo".getBytes();
        String sha = Hashing.sha256Hex(bytes);
        String url = api.post("/uploads", """
                {"purpose":"pet","sha256":"%s","content_type":"image/jpeg","bytes":%d}""".formatted(sha, bytes.length)).str("/url");
        String body = PublishBodies.kira(PHONE, null, "[\"" + url + "\"]", "2026-10-14T08:00:00-05:00", 300);

        ApiResponse unprocessed = publish(body);
        assertThat(unprocessed.errorCode()).isEqualTo("validation_failed");
        assertThat(unprocessed.json().at("/error/fields").has("pet.photo_urls")).isTrue();

        api.rawBytes(HttpMethod.PUT, "/dev-media/{sha}.jpg", bytes, "image/jpeg", sha);
        assertThat(publish(body).str("/phone_step")).isEqualTo("otp");

        ApiClient bob = clients.newBrowser();
        accounts.signIn(bob, "bob@correo.co");
        assertThat(bob.post("/lost-cases", body).json().at("/error/fields").has("pet.photo_urls")).isTrue();
    }

    @Test
    void theBodyIsCheckedAgainstTheContract() {
        assertThat(publish(PublishBodies.kira(PHONE, null, "[]", "2026-10-14T08:00:00-05:00", 6000)).errorCode())
                .isEqualTo("validation_failed");
        ApiResponse future = publish(PublishBodies.kira(PHONE, null, "[]", "2026-10-14T18:00:00Z", 300));
        assertThat(future.errorCode()).isEqualTo("validation_failed");
        assertThat(future.json().at("/error/fields").has("last_seen_at")).isTrue();
    }

    @Test
    void nobodySignedInIsUnauthorized() {
        assertThat(clients.newBrowser().post("/lost-cases", PublishBodies.kira(PHONE, null)).status()).isEqualTo(401);
    }
}
```

`B/src/test/java/co/scuby/cases/CaseCodesTest.java`:

```java
package co.scuby.cases;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class CaseCodesTest {

    @Test
    void lookupsUpperCaseAndAcceptAnyFiveAlphanumerics() {
        assertThat(CaseCodes.normalize("7k3pq")).contains("7K3PQ");
        // The mock's purged fixture GONE5 has an O, which new codes never use: lookups must still
        // accept it so it can answer `gone`. Only generation is restricted to the alphabet.
        assertThat(CaseCodes.normalize("gone5")).contains("GONE5");
        assertThat(CaseCodes.normalize("7K3P")).isEmpty();
        assertThat(CaseCodes.normalize("7K3PQ1")).isEmpty();
        assertThat(CaseCodes.normalize("../x")).isEmpty();
    }

    @Test
    void theAlphabetHasNoAmbiguousCharacters() {
        assertThat(CaseCodes.ALPHABET).doesNotContain("0", "1", "I", "L", "O").hasSize(31);
    }
}
```

`B/src/test/java/co/scuby/cases/PlaceNamesTest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.flags.FeatureFlags;
import co.scuby.platform.flags.Flag;
import org.junit.jupiter.api.Test;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PlaceNamesTest {

    static final GeoPoint LAURELES = new GeoPoint(6.2447, -75.5916);

    @Test
    void flagOffStoresNothingSoTheGenericLabelRenders() {
        FeatureFlags flags = mock(FeatureFlags.class);
        when(flags.isEnabled(eq(Flag.REVERSE_GEOCODING), any())).thenReturn(false);
        assertThat(new PlaceNames(p -> Optional.of("Laureles"), flags).forNewCase(LAURELES, UUID.randomUUID())).isNull();
    }

    @Test
    void flagOnStoresWhatTheNamerSays() {
        FeatureFlags flags = mock(FeatureFlags.class);
        when(flags.isEnabled(eq(Flag.REVERSE_GEOCODING), any())).thenReturn(true);
        assertThat(new PlaceNames(p -> Optional.of("Laureles"), flags).forNewCase(LAURELES, UUID.randomUUID())).isEqualTo("Laureles");
        assertThat(new PlaceNames(p -> Optional.empty(), flags).forNewCase(LAURELES, UUID.randomUUID())).isNull();
    }
}
```

`B/src/test/java/co/scuby/cases/ActiveCasePlanTest.java`:

```java
package co.scuby.cases;

import co.scuby.support.IntegrationTest;
import co.scuby.support.PlanAssert;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.UUID;

/** The active_case_exists check (design · Queries and indexes). */
@IntegrationTest
class ActiveCasePlanTest {

    @Autowired DSLContext db;
    @Autowired TestDb testDb;
    @Autowired PublishLostService service;

    @BeforeEach
    void setUp() { testDb.reset(); }

    @Test
    void theActiveCaseLookupDoesNotScanEveryCase() {
        db.execute("INSERT INTO scuby.person (id, display_name, email, created_at) VALUES ('00000000-0000-0000-0000-000000000001', 'Seed', 'seed@x.co', now())");
        db.execute("""
                INSERT INTO scuby.pet (id, name, species, custody_state, created_at)
                SELECT ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, 'P' || g, 'dog', 'claimed', now()
                FROM generate_series(1, 20000) g""");
        db.execute("""
                INSERT INTO scuby.lost_case (code, pet_id, created_by, status, published_at, contact_phone, phone_has_whatsapp,
                  expose_whatsapp, expose_email, in_app_only, last_seen_lat, last_seen_lng, last_seen_radius_m, last_seen_at)
                SELECT upper(substr(md5(g::text), 1, 5)), ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid,
                  '00000000-0000-0000-0000-000000000001', CASE WHEN g % 10 = 0 THEN 'active' ELSE 'expired' END,
                  timestamptz '2026-01-01' + g * interval '10 minutes', '+573007152284', true, true, false, false,
                  6.2 + (g % 100) * 0.001, -75.6 + (g % 77) * 0.001, 300, timestamptz '2026-01-01' + g * interval '10 minutes'
                FROM generate_series(1, 20000) g
                ON CONFLICT DO NOTHING""");
        db.execute("ANALYZE scuby.lost_case");
        PlanAssert.assertNoSeqScanOn(db, service.activeCaseQuery(UUID.fromString("00000000-0000-0000-0001-000000000010")), "lost_case");
    }
}
```

(The seeded codes are hex and may include `0`/`1`: that is fine for a plan check — the column's CHECK below allows any 5 upper-case alphanumerics for the same legacy reason as `normalize`.)

- [ ] **Step 2: Run to see them fail**

Run: `[mvn] -q test -Dtest='PublishLostTest,CaseCodesTest,PlaceNamesTest,ActiveCasePlanTest'`
Expected: compilation FAILURE (`LOST_CASE`, `PublishLostService` … not found).

- [ ] **Step 3: Migration (no performance index yet)**

`B/src/main/resources/db/migration/V20261030_1020__lost_cases.sql`:

```sql
-- Lost cases (docs/product/04-lost-workflow.md · The case; docs/product/10-sharing.md · codes).
-- Written only by the cases feature. The code is the case's identity and its URL (/c/7K3PQ); codes
-- are generated from 23456789ABCDEFGHJKMNPQRSTUVWXYZ and never reused (purged_case_code keeps
-- the purged ones so a printed poster still resolves: GET answers `gone`).
-- last_seen is an area: the stored radius is the owner's uncertainty; the 200 m public floor is
-- applied when answering, never stored. place_name NULL = render the generic localized label.
-- Points: lat/lng columns written by the app + a generated geography column for PostGIS.
CREATE TABLE lost_case (
  code                text PRIMARY KEY CHECK (code ~ '^[A-Z0-9]{5}$'),
  pet_id              uuid NOT NULL REFERENCES pet (id),
  created_by          uuid NOT NULL REFERENCES person (id),
  status              text NOT NULL CHECK (status IN ('active', 'reunited', 'expired', 'cancelled')),
  published_at        timestamptz NOT NULL,
  resolved_at         timestamptz,
  contact_phone       text NOT NULL CHECK (contact_phone ~ '^\+[1-9][0-9]{6,14}$'),
  phone_has_whatsapp  boolean NOT NULL,
  expose_whatsapp     boolean NOT NULL,
  expose_email        boolean NOT NULL,
  in_app_only         boolean NOT NULL,
  last_seen_lat       double precision NOT NULL CHECK (last_seen_lat BETWEEN -90 AND 90),
  last_seen_lng       double precision NOT NULL CHECK (last_seen_lng BETWEEN -180 AND 180),
  last_seen_point     public.geography(Point, 4326) GENERATED ALWAYS AS
                        (public.ST_SetSRID(public.ST_MakePoint(last_seen_lng, last_seen_lat), 4326)::public.geography) STORED,
  last_seen_radius_m  double precision NOT NULL CHECK (last_seen_radius_m > 0 AND last_seen_radius_m <= 5000),
  last_seen_at        timestamptz NOT NULL,
  place_name          text
);

CREATE TABLE purged_case_code (
  code       text PRIMARY KEY CHECK (code ~ '^[A-Z0-9]{5}$'),
  purged_at  timestamptz NOT NULL
);
```

Check after `[mvn] -q generate-sources` that `target/generated-sources/jooq/co/scuby/db/generated/tables/LostCase.java` contains a field `LAST_SEEN_POINT` (type `Object` — jOOQ OSS does not know `geography`; a codegen warning about an unknown type is expected). If the field is missing, use `DSL.field(DSL.name("lost_case", "last_seen_point"))` wherever this plan writes `LOST_CASE.LAST_SEEN_POINT`, and note it in the report.

- [ ] **Step 4: Code**

`CasesSecurityRules.java`:

```java
package co.scuby.cases;

import co.scuby.platform.security.SecurityRules;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AuthorizeHttpRequestsConfigurer;
import org.springframework.stereotype.Component;

/** cases' `session` endpoints (openapi.json security: session). Case reads, the feed and sightings are public. */
@Component
class CasesSecurityRules implements SecurityRules {
    @Override
    public void authorize(AuthorizeHttpRequestsConfigurer<HttpSecurity>.AuthorizationManagerRequestMatcherRegistry rules) {
        rules.requestMatchers(HttpMethod.POST, "/lost-cases").authenticated();
    }
}
```

`CaseCodes.java`:

```java
package co.scuby.cases;

import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PURGED_CASE_CODE;

/** Case codes (docs/product/10-sharing.md): 5 characters, unambiguous alphabet, never reused. */
@Component
class CaseCodes {

    static final String ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    private static final Pattern LOOKUP = Pattern.compile("^[A-Z0-9]{5}$");
    private static final SecureRandom RANDOM = new SecureRandom();

    private final DSLContext db;

    CaseCodes(DSLContext db) {
        this.db = db;
    }

    String newCode() {
        for (int attempt = 0; attempt < 10; attempt++) {
            StringBuilder code = new StringBuilder(5);
            for (int i = 0; i < 5; i++) code.append(ALPHABET.charAt(RANDOM.nextInt(ALPHABET.length())));
            String c = code.toString();
            boolean taken = db.fetchExists(DSL.selectOne().from(LOST_CASE).where(LOST_CASE.CODE.eq(c))
                    .unionAll(DSL.selectOne().from(PURGED_CASE_CODE).where(PURGED_CASE_CODE.CODE.eq(c))));
            if (!taken) return c;
        }
        throw new IllegalStateException("no free case code after 10 attempts");
    }

    /** Lookups are case-insensitive; anything that cannot be a code is simply unknown. */
    static Optional<String> normalize(String raw) {
        String upper = raw == null ? "" : raw.toUpperCase(Locale.ROOT);
        return LOOKUP.matcher(upper).matches() ? Optional.of(upper) : Optional.empty();
    }
}
```

`PlaceNamer.java`:

```java
package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;

import java.util.Optional;

/** Reverse geocoding: the barrio a point is in (docs/product/10-sharing.md). Provider chosen by the place-names spike. */
@FunctionalInterface
interface PlaceNamer {
    Optional<String> nameFor(GeoPoint point);
}
```

`NoPlaceNamer.java`:

```java
package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import org.springframework.stereotype.Component;

import java.util.Optional;

/** No provider is wired in this slice: even with reverse_geocoding on, the generic label renders. */
@Component
class NoPlaceNamer implements PlaceNamer {
    @Override
    public Optional<String> nameFor(GeoPoint point) {
        return Optional.empty();
    }
}
```

`PlaceNames.java`:

```java
package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.flags.FeatureFlags;
import co.scuby.platform.flags.Flag;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;

import java.util.UUID;

/** Computed once at publish and stored; null renders the generic label (PublicTextDerivation.placeName). */
@Component
class PlaceNames {

    private final PlaceNamer namer;
    private final FeatureFlags flags;

    PlaceNames(PlaceNamer namer, FeatureFlags flags) {
        this.namer = namer;
        this.flags = flags;
    }

    @Nullable String forNewCase(GeoPoint point, UUID publisher) {
        if (!flags.isEnabled(Flag.REVERSE_GEOCODING, publisher)) return null;
        return namer.nameFor(point).orElse(null);
    }
}
```

`PublishLostRequest.java`:

```java
package co.scuby.cases;

import co.scuby.pets.Pets;
import co.scuby.platform.db.GeoPoint;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.jspecify.annotations.Nullable;

import java.time.OffsetDateTime;
import java.util.List;

/** PublishLostRequest (web/src/contracts/owner.ts). */
record PublishLostRequest(
        @Nullable String petId,
        @NotNull @Valid PetInput pet,
        @NotNull @Valid PointInput lastSeenPoint,
        @NotNull @Positive @DecimalMax("5000") Double lastSeenRadiusM,
        @NotNull OffsetDateTime lastSeenAt,
        @Nullable @Pattern(regexp = "^\\+[1-9]\\d{6,14}$") String phone,
        @NotNull Boolean phoneHasWhatsapp,
        @NotNull @Valid ContactPrefs contactPrefs,
        @Nullable @Pattern(regexp = "^\\d{6}$") String otpCode) {

    record PetInput(@NotBlank @Size(max = 60) String name,
                    @NotNull Pets.Species species,
                    @NotNull Pets.Size size,
                    @NotNull List<@NotNull Pets.Color> colors,
                    @Nullable @Size(max = 500) String marks,
                    @Nullable @Size(max = 40) String chipNumber,
                    @NotNull @Size(max = 6) List<@NotBlank String> photoUrls) {

        Pets.NewPet toNewPet() {
            return new Pets.NewPet(name, species, size, colors, marks, chipNumber, photoUrls);
        }
    }

    record ContactPrefs(@NotNull Boolean exposeWhatsapp, @NotNull Boolean exposeEmail, @NotNull Boolean inAppOnly) {}
}

/** A wire point `{lat, lng}` (web/src/contracts/primitives.ts). */
record PointInput(@NotNull @DecimalMin("-90") @DecimalMax("90") Double lat,
                  @NotNull @DecimalMin("-180") @DecimalMax("180") Double lng) {
    GeoPoint toGeoPoint() {
        return new GeoPoint(lat, lng);
    }
}
```

(Two top-level types in one file are allowed only if the second is package-private — it is. If the build's style rules object, move `PointInput` to its own `PointInput.java`.)

`PublishView.java`:

```java
package co.scuby.cases;

/** The contract's Publish union: `{phone_step: "otp"}` or `{code}`. */
final class PublishView {

    private PublishView() {}

    record PhoneStep(String phoneStep) {
        static final PhoneStep OTP = new PhoneStep("otp");
    }

    record Published(String code) {}
}
```

`PublishLostService.java`:

```java
package co.scuby.cases;

import co.scuby.identity.PublisherPhone;
import co.scuby.pets.Pets;
import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.security.Account;
import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import co.scuby.uploads.PhotoAttachments;
import co.scuby.uploads.UploadPurpose;
import org.jooq.DSLContext;
import org.jooq.Record1;
import org.jooq.Select;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;

/** docs/product/04-lost-workflow.md · Publishing: pet (or reuse), owner link, case — one transaction. */
@Service
class PublishLostService {

    static final Duration CLOCK_DRIFT = Duration.ofMinutes(5);

    private final DSLContext db;
    private final Clock clock;
    private final Pets pets;
    private final PhotoAttachments photos;
    private final PublisherPhone publisherPhone;
    private final CaseCodes codes;
    private final PlaceNames placeNames;

    PublishLostService(DSLContext db, Clock clock, Pets pets, PhotoAttachments photos,
                       PublisherPhone publisherPhone, CaseCodes codes, PlaceNames placeNames) {
        this.db = db;
        this.clock = clock;
        this.pets = pets;
        this.photos = photos;
        this.publisherPhone = publisherPhone;
        this.codes = codes;
        this.placeNames = placeNames;
    }

    @Transactional
    public Object publish(Account account, Caller caller, PublishLostRequest request) {
        UUID me = account.personId();
        Instant now = clock.instant();

        if (request.petId() != null) {
            pets.requireOwnedBy(request.petId(), me);
            String open = activeCaseQuery(UUID.fromString(request.petId())).fetchOptional(Record1::value1).orElse(null);
            if (open != null) throw activeCaseExists(open);
        } else {
            photos.requireAttachable(request.pet().photoUrls(), UploadPurpose.pet, caller, "pet.photo_urls");
        }
        if (request.lastSeenAt().toInstant().isAfter(now.plus(CLOCK_DRIFT))) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "last_seen_at is in the future",
                    Map.of("last_seen_at", "in the future"), Map.of());
        }

        PublisherPhone.Outcome phone = publisherPhone.resolve(me, request.phone(), request.otpCode(), caller);
        if (phone instanceof PublisherPhone.CodeSent) return PublishView.PhoneStep.OTP;
        PublisherPhone.Ready ready = (PublisherPhone.Ready) phone;

        UUID petId = request.petId() != null ? UUID.fromString(request.petId()) : pets.createOwned(me, request.pet().toNewPet());
        GeoPoint point = request.lastSeenPoint().toGeoPoint();
        String code = codes.newCode();
        OffsetDateTime at = now.atOffset(ZoneOffset.UTC);
        int inserted = db.insertInto(LOST_CASE)
                .set(LOST_CASE.CODE, code)
                .set(LOST_CASE.PET_ID, petId)
                .set(LOST_CASE.CREATED_BY, me)
                .set(LOST_CASE.STATUS, "active")
                .set(LOST_CASE.PUBLISHED_AT, at)
                .set(LOST_CASE.CONTACT_PHONE, ready.phone())
                .set(LOST_CASE.PHONE_HAS_WHATSAPP, request.phoneHasWhatsapp())
                .set(LOST_CASE.EXPOSE_WHATSAPP, request.contactPrefs().exposeWhatsapp())
                .set(LOST_CASE.EXPOSE_EMAIL, request.contactPrefs().exposeEmail())
                .set(LOST_CASE.IN_APP_ONLY, request.contactPrefs().inAppOnly())
                .set(LOST_CASE.LAST_SEEN_LAT, point.lat())
                .set(LOST_CASE.LAST_SEEN_LNG, point.lng())
                .set(LOST_CASE.LAST_SEEN_RADIUS_M, request.lastSeenRadiusM())
                .set(LOST_CASE.LAST_SEEN_AT, request.lastSeenAt().withOffsetSameInstant(ZoneOffset.UTC))
                .set(LOST_CASE.PLACE_NAME, placeNames.forNewCase(point, me))
                .onConflictDoNothing()
                .execute();
        if (inserted == 0) {   // a concurrent publish won the one-active-case-per-pet race (or, practically never, the code)
            String open = activeCaseQuery(petId).fetchOptional(Record1::value1)
                    .orElseThrow(() -> new IllegalStateException("case code collision"));
            throw activeCaseExists(open);
        }
        return new PublishView.Published(code);
    }

    Select<Record1<String>> activeCaseQuery(UUID petId) {
        return db.select(LOST_CASE.CODE).from(LOST_CASE)
                 .where(LOST_CASE.PET_ID.eq(petId)).and(LOST_CASE.STATUS.eq("active"));
    }

    private static ApiException activeCaseExists(String code) {
        return new ApiException(ErrorCode.ACTIVE_CASE_EXISTS, "the pet already has an active lost case",
                Map.of(), Map.of("case_code", code));
    }
}
```

`onConflictDoNothing()` without a target covers both the code primary key and the one-active-case unique index (Step 7).

`PublishLostController.java`:

```java
package co.scuby.cases;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Account;
import co.scuby.platform.security.Caller;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@ApiComponent
@RestController
class PublishLostController {

    private final PublishLostService service;

    PublishLostController(PublishLostService service) {
        this.service = service;
    }

    /** 200 with `{phone_step: "otp"}` or `{code}` (the contract's publishLost). */
    @PostMapping("/lost-cases")
    Object publish(Account account, Caller caller, @Valid @RequestBody PublishLostRequest body) {
        return service.publish(account, caller, body);
    }
}
```

`TestDb.MUTABLE_TABLES`: add `"lost_case"`, `"purged_case_code"`. `StatementCeilings`: add `Map.entry("POST /lost-cases", 14)`.

- [ ] **Step 5: Run the endpoint tests**

Run: `[mvn] -q test -Dtest='PublishLostTest,CaseCodesTest,PlaceNamesTest,ArchitectureTest'`
Expected: PASS. Record the measured statement count of each publish path (otp, check, verified, flag-off) in the report and lower the ceiling to the highest measured value.

- [ ] **Step 6: Measure the active-case check — expect a seq scan**

Run: `[mvn] -q test -Dtest=ActiveCasePlanTest`
Expected: FAIL with `Seq Scan on lost_case`. Copy the plan to the report ("lost_case active check — before").

- [ ] **Step 7: Earn the index (it is also an invariant)**

`B/src/main/resources/db/migration/V20261030_1030__one_active_case_per_pet.sql`:

```sql
-- Serves PublishLostService.activeCaseQuery: SELECT code FROM lost_case WHERE pet_id = ? AND status = 'active'
-- (the active_case_exists check), and enforces 04's invariant "a pet has at most one active lost case"
-- against concurrent publishes (the INSERT is ON CONFLICT DO NOTHING).
-- Plan before (20,000 cases, 10 % active): Seq Scan on lost_case (A2 report). After: Index Scan on this index.
-- Write cost: one entry per active case; leaves the index when the case closes. Overlaps: none.
-- Needs human approval before merge.
CREATE UNIQUE INDEX lost_case_one_active_per_pet ON lost_case (pet_id) WHERE status = 'active';
```

Run: `[mvn] -q test -Dtest='ActiveCasePlanTest,PublishLostTest'`
Expected: PASS; the plan uses `lost_case_one_active_per_pet`. Copy it ("after") and add the index to **Indexes for human approval**.

- [ ] **Step 8: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add backend/src/main/resources/db/migration/V20261030_1020__lost_cases.sql backend/src/main/resources/db/migration/V20261030_1030__one_active_case_per_pet.sql backend/src/main/java/co/scuby/cases backend/src/test/java/co/scuby/cases backend/src/test/java/co/scuby/support
git commit -m "feat: POST /lost-cases — pet, owner link and case in one transaction, phone step, photo checks, one active case per pet"
```

---
### Task 5: `GET /cases/{code}` — access → facts → `LostCaseDerivation` → record

The same URL answers more to the publisher (`docs/eng/api.md` · Conventions). The access policy decides `OWNER` (the session's person created the case — a device never makes you owner) or `PUBLIC`; facts are loaded **according to the access** — for `PUBLIC`, hidden pins are not queried and reporters' numbers are selected as `NULL`, so they cannot leak; the pure derivation builds the response: `viewer`, the 200 m public floor on `last_seen.radius_m` (center unchanged), `null` for every field the viewer may not see, `mine`/`editable_until`, `contact` (only while active; `display_name` «First L.»; `whatsapp_url` only when exposed and the number has WhatsApp). Claims and check-ins are not in this slice (`claims: []`, `pending_checkin: null`, `open_claim_count: 0`). Unknown code → `not_found`; a purged code → `gone`; lookups upper-case the path. The `sighting` table is created here (this endpoint reads it; Task 7 writes it).

**Files:**
- Create: `B/src/main/resources/db/migration/V20261030_1040__sightings.sql`
- Create: `B/src/main/java/co/scuby/platform/web/LocaleConfiguration.java`
- Create in `B/src/main/java/co/scuby/cases/`: `Access.java`, `Viewer.java`, `CaseAccessPolicy.java`, `LostCaseFacts.java`, `LostCaseQueries.java`, `LostCaseView.java`, `PublicTextDerivation.java`, `LostCaseDerivation.java`, `CaseReads.java`, `CaseController.java`
- Create: `B/src/test/java/co/scuby/support/CaseFixtures.java`; modify `TestSupportConfiguration.java`, `TestDb.java`, `StatementCeilings.java`
- Test: `B/src/test/java/co/scuby/cases/PublicTextDerivationTest.java`, `LostCaseDerivationTest.java`, `CaseEndpointTest.java`, `CaseSightingsPlanTest.java`

**Interfaces:**
- Consumes: `Caller`, `CaseCodes.normalize`, `GeoPoint`, `MutableClock`, `Accounts`.
- Produces:
  - Table `sighting` (id, case_code, lat, lng, generated `point`, seen_at, created_at, note, photo_urls, reporter_person_id, reporter_device_hash, reporter_ip_hash, contact_phone, status, highlighted_by_owner, client_id; `UNIQUE (case_code, client_id)`).
  - `enum Access { OWNER, PUBLIC }`; `record Viewer(Access access, @Nullable UUID personId, String deviceHash)`; `CaseAccessPolicy.accessFor(UUID createdBy, Caller caller) → Access`.
  - `record LostCaseFacts(String code, String status, @Nullable Instant resolvedAt, UUID createdBy, PetFacts pet, GeoPoint center, double radiusM, Instant lastSeenAt, @Nullable String placeName, String publisherName, String contactPhone, boolean phoneHasWhatsapp, boolean exposeWhatsapp, List<SightingFacts> sightings)` with nested `PetFacts(@Nullable String name, String species, @Nullable String size, List<String> colors, @Nullable String marks, List<String> photoUrls)` and `SightingFacts(UUID id, GeoPoint point, Instant seenAt, Instant createdAt, @Nullable String note, List<String> photoUrls, @Nullable UUID reporterPersonId, String reporterDeviceHash, @Nullable String contactPhone, boolean hidden, boolean highlighted)`.
  - `LostCaseDerivation.derive(LostCaseFacts, Viewer, Instant now, Locale) → LostCaseView`; constants `PUBLIC_RADIUS_FLOOR_M = 200`, `EDIT_WINDOW = 15 min`.
  - `PublicTextDerivation`: `publicName(String) → String`, `placeName(@Nullable String, Locale) → String`, `summary(String species, @Nullable String size, List<String> colors, Locale) → String`, `whatsappUrl(String e164) → String`. Task 6 reuses them.
  - `LostCaseQueries`: `Optional<LostCaseFacts> loadCase(String code)` (with an empty sightings list), `boolean isPurged(String code)`, `List<SightingFacts> sightings(String code, Access)`, `Select<?> sightingsQuery(String code, Access)` (for the plan check).
  - Test support `CaseFixtures` (see Step 1).

- [ ] **Step 1: Test fixtures and the failing tests**

`B/src/test/java/co/scuby/support/CaseFixtures.java`:

```java
package co.scuby.support;

import co.scuby.platform.db.GeoPoint;
import org.jooq.DSLContext;
import org.jspecify.annotations.Nullable;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.PURGED_CASE_CODE;
import static co.scuby.db.generated.Tables.RESPONSIBILITY_LINK;
import static co.scuby.db.generated.Tables.SIGHTING;

/** Seeds cases and sightings directly (the endpoints that write them have their own tests). */
public final class CaseFixtures {

    /** Medellín, the mock's DEFAULT_CENTER; Luna's radius is 100 m like the mock's fixture. */
    public static final GeoPoint MEDELLIN = new GeoPoint(6.2442, -75.5812);
    public static final String LUNA_PHONE = "+573114829017";

    private final DSLContext db;

    CaseFixtures(DSLContext db) {
        this.db = db;
    }

    public String luna(UUID owner) {
        return lostCase(owner, "7K3PQ", "Luna", "dog", MEDELLIN, 100, "active",
                MutableClock.START.minusSeconds(2 * 86_400));
    }

    public String lostCase(UUID owner, String code, String petName, String species, GeoPoint at, double radiusM,
                           String status, Instant publishedAt) {
        UUID pet = UUID.randomUUID();
        db.insertInto(PET).set(PET.ID, pet).set(PET.NAME, petName).set(PET.SPECIES, species)
          .set(PET.SIZE, "small").set(PET.COLORS, new String[]{"black", "tan"})
          .set(PET.PHOTO_URLS, new String[]{"http://localhost/dev-media/" + "a".repeat(64) + ".jpg"})
          .set(PET.CUSTODY_STATE, "claimed").set(PET.CREATED_AT, publishedAt.atOffset(ZoneOffset.UTC)).execute();
        db.insertInto(RESPONSIBILITY_LINK).set(RESPONSIBILITY_LINK.ID, UUID.randomUUID())
          .set(RESPONSIBILITY_LINK.PERSON_ID, owner).set(RESPONSIBILITY_LINK.PET_ID, pet)
          .set(RESPONSIBILITY_LINK.ROLE, "owner").set(RESPONSIBILITY_LINK.ACTIVE_FROM, publishedAt.atOffset(ZoneOffset.UTC)).execute();
        db.insertInto(LOST_CASE)
          .set(LOST_CASE.CODE, code).set(LOST_CASE.PET_ID, pet).set(LOST_CASE.CREATED_BY, owner)
          .set(LOST_CASE.STATUS, status).set(LOST_CASE.PUBLISHED_AT, publishedAt.atOffset(ZoneOffset.UTC))
          .set(LOST_CASE.RESOLVED_AT, "active".equals(status) ? null : publishedAt.plusSeconds(86_400).atOffset(ZoneOffset.UTC))
          .set(LOST_CASE.CONTACT_PHONE, LUNA_PHONE).set(LOST_CASE.PHONE_HAS_WHATSAPP, true)
          .set(LOST_CASE.EXPOSE_WHATSAPP, true).set(LOST_CASE.EXPOSE_EMAIL, false).set(LOST_CASE.IN_APP_ONLY, false)
          .set(LOST_CASE.LAST_SEEN_LAT, at.lat()).set(LOST_CASE.LAST_SEEN_LNG, at.lng())
          .set(LOST_CASE.LAST_SEEN_RADIUS_M, radiusM).set(LOST_CASE.LAST_SEEN_AT, publishedAt.atOffset(ZoneOffset.UTC))
          .execute();
        return code;
    }

    public UUID sighting(String code, GeoPoint at, Instant seenAt, Instant createdAt, @Nullable UUID reporterPerson,
                         String reporterDeviceHash, @Nullable String contactPhone, String status) {
        UUID id = UUID.randomUUID();
        db.insertInto(SIGHTING)
          .set(SIGHTING.ID, id).set(SIGHTING.CASE_CODE, code)
          .set(SIGHTING.LAT, at.lat()).set(SIGHTING.LNG, at.lng())
          .set(SIGHTING.SEEN_AT, seenAt.atOffset(ZoneOffset.UTC)).set(SIGHTING.CREATED_AT, createdAt.atOffset(ZoneOffset.UTC))
          .set(SIGHTING.REPORTER_PERSON_ID, reporterPerson).set(SIGHTING.REPORTER_DEVICE_HASH, reporterDeviceHash)
          .set(SIGHTING.REPORTER_IP_HASH, "f".repeat(64)).set(SIGHTING.CONTACT_PHONE, contactPhone)
          .set(SIGHTING.STATUS, status)
          .execute();
        return id;
    }

    public void purge(String code) {
        db.insertInto(PURGED_CASE_CODE).set(PURGED_CASE_CODE.CODE, code)
          .set(PURGED_CASE_CODE.PURGED_AT, MutableClock.START.atOffset(ZoneOffset.UTC)).execute();
    }
}
```

Register in `TestSupportConfiguration`: `@Bean CaseFixtures caseFixtures(DSLContext db) { return new CaseFixtures(db); }`.

`B/src/test/java/co/scuby/cases/PublicTextDerivationTest.java`:

```java
package co.scuby.cases;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.util.List;
import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThat;

/** Display text the server composes (docs/eng/api.md · Language). Human review: the copy. */
class PublicTextDerivationTest {

    static final Locale ES = Locale.forLanguageTag("es");
    static final Locale EN = Locale.forLanguageTag("en");

    @ParameterizedTest
    @CsvSource({
            "Carolina Mejía, Carolina M.",
            "ana gomez ruiz, ana G.",
            "Carolina, Carolina",
            "'  Juan   Perez ', Juan P.",
    })
    void publicName(String displayName, String expected) {
        assertThat(PublicTextDerivation.publicName(displayName)).isEqualTo(expected);
    }

    @Test
    void placeNameIsTheStoredOneOrTheGenericLabelInTheRequestLanguage() {
        assertThat(PublicTextDerivation.placeName("Laureles", EN)).isEqualTo("Laureles");
        assertThat(PublicTextDerivation.placeName(null, ES)).isEqualTo("Zona marcada en el mapa");
        assertThat(PublicTextDerivation.placeName(null, EN)).isEqualTo("Area marked on the map");
        assertThat(PublicTextDerivation.placeName(null, Locale.FRENCH)).isEqualTo("Zona marcada en el mapa");
    }

    @Test
    void summaryAsTheMockComposesItAndInEnglish() {
        assertThat(PublicTextDerivation.summary("dog", "medium", List.of("brown"), ES)).isEqualTo("Perro · Mediano · Café");
        assertThat(PublicTextDerivation.summary("cat", "small", List.of("black", "tan"), ES)).isEqualTo("Gato · Pequeño · Negro y canela");
        assertThat(PublicTextDerivation.summary("other", null, List.of("white", "gray", "orange"), ES)).isEqualTo("Animal · Blanco, gris y naranja");
        assertThat(PublicTextDerivation.summary("dog", null, List.of(), ES)).isEqualTo("Perro");
        assertThat(PublicTextDerivation.summary("dog", "large", List.of("black", "tan"), EN)).isEqualTo("Dog · Large · Black and tan");
    }

    @Test
    void whatsappUrlDropsThePlus() {
        assertThat(PublicTextDerivation.whatsappUrl("+573007152284")).isEqualTo("https://wa.me/573007152284");
    }
}
```

`B/src/test/java/co/scuby/cases/LostCaseDerivationTest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Who sees what on a lost case (docs/product/04-lost-workflow.md · Location precision; docs/eng/api.md).
 * Human review: these tables are the rules.
 */
class LostCaseDerivationTest {

    static final Instant NOW = Instant.parse("2026-10-14T17:00:00Z");
    static final UUID OWNER = UUID.fromString("00000000-0000-0000-0000-00000000000a");
    static final UUID HELPER = UUID.fromString("00000000-0000-0000-0000-00000000000b");
    static final String MY_DEVICE = "1".repeat(64);
    static final String OTHER_DEVICE = "2".repeat(64);
    static final Locale ES = Locale.forLanguageTag("es");

    static LostCaseFacts.SightingFacts sighting(String id, Instant seenAt, Instant createdAt, UUID reporter, String device,
                                                String phone, boolean hidden) {
        return new LostCaseFacts.SightingFacts(UUID.fromString("00000000-0000-0000-0000-0000000000" + id),
                new GeoPoint(6.25, -75.59), seenAt, createdAt, null, List.of(), reporter, device, phone, hidden, false);
    }

    static LostCaseFacts facts(String status, double radius, String placeName, String name, boolean exposeWhatsapp,
                               boolean hasWhatsapp, List<LostCaseFacts.SightingFacts> sightings) {
        return new LostCaseFacts("7K3PQ", status, "active".equals(status) ? null : NOW, OWNER,
                new LostCaseFacts.PetFacts(name, "dog", "small", List.of("black"), null, List.of()),
                new GeoPoint(6.2442, -75.5812), radius, NOW.minus(Duration.ofDays(2)), placeName,
                "Carolina Mejía", "+573114829017", hasWhatsapp, exposeWhatsapp, sightings);
    }

    static LostCaseFacts luna(List<LostCaseFacts.SightingFacts> sightings) {
        return facts("active", 100, null, "Luna", true, true, sightings);
    }

    static final Viewer OWNER_VIEW = new Viewer(Access.OWNER, OWNER, OTHER_DEVICE);
    static final Viewer STRANGER = new Viewer(Access.PUBLIC, null, MY_DEVICE);

    @ParameterizedTest(name = "radius {0}, {1} → {2}")
    @CsvSource({
            "100,  OWNER,  100",
            "100,  PUBLIC, 200",
            "200,  PUBLIC, 200",
            "350,  PUBLIC, 350",
            "5000, PUBLIC, 5000",
            "50,   OWNER,  50",
    })
    void thePublicRadiusIsFlooredAt200AndTheCenterNeverMoves(double stored, Access access, double expected) {
        Viewer v = access == Access.OWNER ? OWNER_VIEW : STRANGER;
        LostCaseView view = LostCaseDerivation.derive(facts("active", stored, null, "Luna", true, true, List.of()), v, NOW, ES);
        assertThat(view.lastSeen().radiusM()).isEqualTo(expected);
        assertThat(view.lastSeen().center()).isEqualTo(new GeoPoint(6.2442, -75.5812));
        assertThat(view.viewer()).isEqualTo(access == Access.OWNER ? "owner" : "public");
    }

    @Test
    void aStrangerGetsNoHiddenPinsAndNoReportersNumbersEvenIfTheFactsHadThem() {
        var facts = luna(List.of(
                sighting("01", NOW.minusSeconds(7200), NOW.minusSeconds(7200), HELPER, OTHER_DEVICE, "+573001112233", false),
                sighting("02", NOW.minusSeconds(3600), NOW.minusSeconds(3600), null, OTHER_DEVICE, "+573004445566", true)));
        LostCaseView view = LostCaseDerivation.derive(facts, STRANGER, NOW, ES);
        assertThat(view.sightings()).hasSize(1);
        assertThat(view.sightings()).allSatisfy(s -> {
            assertThat(s.contactPhone()).isNull();
            assertThat(s.hidden()).isFalse();
        });
        assertThat(view.claims()).isEmpty();
        assertThat(view.pendingCheckin()).isNull();
        assertThat(view.openClaimCount()).isZero();
    }

    @Test
    void theOwnerGetsHiddenPinsFlaggedAndReportersNumbers() {
        var facts = luna(List.of(
                sighting("01", NOW.minusSeconds(7200), NOW.minusSeconds(7200), HELPER, OTHER_DEVICE, "+573001112233", false),
                sighting("02", NOW.minusSeconds(3600), NOW.minusSeconds(3600), null, OTHER_DEVICE, null, true)));
        LostCaseView view = LostCaseDerivation.derive(facts, OWNER_VIEW, NOW, ES);
        assertThat(view.sightings()).extracting(LostCaseView.SightingView::hidden).containsExactly(false, true);
        assertThat(view.sightings().getFirst().contactPhone()).isEqualTo("+573001112233");
        assertThat(view.sightings()).extracting(LostCaseView.SightingView::source).containsExactly("registered", "anonymous");
    }

    @Test
    void sightingsComeOldestFirst() {
        var facts = luna(List.of(
                sighting("03", NOW.minusSeconds(60), NOW.minusSeconds(60), null, OTHER_DEVICE, null, false),
                sighting("01", NOW.minusSeconds(9000), NOW.minusSeconds(9000), null, OTHER_DEVICE, null, false),
                sighting("02", NOW.minusSeconds(3000), NOW.minusSeconds(3000), null, OTHER_DEVICE, null, false)));
        assertThat(LostCaseDerivation.derive(facts, STRANGER, NOW, ES).sightings())
                .extracting(s -> s.id().substring(34)).containsExactly("01", "02", "03");
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource({
            // case,                               reporterIsMe, sameDevice, createdMinutesAgo, hidden, mine,  editable
            "'my device, 5 min ago',               false,        true,       5,                 false,  true,  true",
            "'my account, other device',           true,         false,      5,                 false,  true,  true",
            "'mine, exactly 15 min ago',           false,        true,       15,                false,  true,  false",
            "'mine, 16 min ago',                   false,        true,       16,                false,  true,  false",
            "'mine but hidden by the owner',       false,        true,       5,                 true,   true,  false",
            "'someone else',                       false,        false,      5,                 false,  false, false",
    })
    void mineAndTheCorrectionWindow(String label, boolean reporterIsMe, boolean sameDevice, int minutesAgo,
                                    boolean hidden, boolean mine, boolean editable) {
        Instant created = NOW.minus(Duration.ofMinutes(minutesAgo));
        var s = sighting("01", created, created, reporterIsMe ? HELPER : null, sameDevice ? MY_DEVICE : OTHER_DEVICE, null, hidden);
        // A hidden pin reaches only the owner: in that row the viewer is the owner (but not the reporter).
        Viewer me = new Viewer(hidden ? Access.OWNER : Access.PUBLIC, HELPER, MY_DEVICE);
        var view = LostCaseDerivation.derive(luna(List.of(s)), me, NOW, ES).sightings().getFirst();
        assertThat(view.mine()).isEqualTo(mine);
        assertThat(view.editableUntil()).isEqualTo(editable ? created.plus(Duration.ofMinutes(15)) : null);
    }

    @ParameterizedTest(name = "status={0} expose={1} whatsapp={2}")
    @CsvSource(nullValues = "null", value = {
            "active,    true,  true,  https://wa.me/573114829017",
            "active,    false, true,  null",
            "active,    true,  false, null",
    })
    void contactWhileActive(String status, boolean expose, boolean hasWhatsapp, String url) {
        var view = LostCaseDerivation.derive(facts(status, 100, null, "Luna", expose, hasWhatsapp, List.of()), STRANGER, NOW, ES);
        assertThat(view.contact().displayName()).isEqualTo("Carolina M.");
        assertThat(view.contact().whatsappUrl()).isEqualTo(url);
    }

    @Test
    void noContactOnceTheCaseIsClosedAndTheResolutionTimeShows() {
        var view = LostCaseDerivation.derive(facts("reunited", 100, null, "Toby", true, true, List.of()), STRANGER, NOW, ES);
        assertThat(view.contact()).isNull();
        assertThat(view.status()).isEqualTo("reunited");
        assertThat(view.resolvedAt()).isEqualTo(NOW);
    }

    @Test
    void textFieldsAndDefaults() {
        var view = LostCaseDerivation.derive(facts("active", 100, null, null, true, true, List.of()), STRANGER, NOW, ES);
        assertThat(view.pet().name()).isEqualTo("");
        assertThat(view.lastSeen().placeName()).isEqualTo("Zona marcada en el mapa");
        assertThat(view.vertical()).isEqualTo("lost");
        assertThat(view.code()).isEqualTo("7K3PQ");
        var named = LostCaseDerivation.derive(facts("active", 100, "Laureles", "Luna", true, true, List.of()), STRANGER, NOW, ES);
        assertThat(named.lastSeen().placeName()).isEqualTo("Laureles");
    }

    @Test
    void theDerivationDoesNotChangeItsInput() {
        var list = new ArrayList<>(List.of(sighting("02", NOW, NOW, null, OTHER_DEVICE, null, false),
                sighting("01", NOW.minusSeconds(5), NOW.minusSeconds(5), null, OTHER_DEVICE, null, false)));
        LostCaseDerivation.derive(luna(list), STRANGER, NOW, ES);
        assertThat(list.getFirst().id().toString()).endsWith("02");
    }
}
```

`B/src/test/java/co/scuby/cases/CaseEndpointTest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.crypto.Hashing;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.TestDb;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class CaseEndpointTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;

    ApiClient owner;
    UUID carolina;

    @BeforeEach
    void setUp() {
        testDb.reset();
        owner = clients.newBrowser();
        carolina = accounts.signIn(owner, "carolina@correo.co");
        cases.luna(carolina);
        UUID helper = accounts.person("helper@correo.co");
        var t = MutableClock.START;
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, t.minusSeconds(7200), t.minusSeconds(7200), helper, "3".repeat(64), "+573001112233", "visible");
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, t.minusSeconds(3600), t.minusSeconds(3600), null, "4".repeat(64), "+573004445566", "hidden_by_owner");
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, t.minusSeconds(600), t.minusSeconds(600), null, "5".repeat(64), null, "visible");
    }

    /** Leak test (design · guardrail 6): as a non-owner, every owner-only field is null or empty. */
    private void assertNothingOwnerOnly(ApiResponse r) {
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/viewer")).isEqualTo("public");
        assertThat(r.json().get("claims")).isEmpty();
        assertThat(r.isNull("/pending_checkin")).isTrue();
        assertThat(r.json().at("/last_seen/radius_m").asDouble()).isEqualTo(200.0);
        assertThat(r.json().get("sightings")).hasSize(2);
        r.json().get("sightings").forEach(s -> {
            assertThat(s.get("contact_phone").isNull()).isTrue();
            assertThat(s.get("hidden").asBoolean()).isFalse();
        });
    }

    @Test
    void anAnonymousStrangerGetsNothingOwnerOnly() {
        assertNothingOwnerOnly(clients.newBrowser().get("/cases/{code}", "7K3PQ"));
    }

    @Test
    void aSignedInStrangerGetsNothingOwnerOnly() {
        ApiClient stranger = clients.newBrowser();
        accounts.signIn(stranger, "stranger@correo.co");
        assertNothingOwnerOnly(stranger.get("/cases/{code}", "7K3PQ"));
    }

    @Test
    void theOwnerGetsAllOfItAndTheCodeIsCaseInsensitive() {
        ApiResponse r = owner.get("/cases/{code}", "7k3pq");
        assertThat(r.str("/viewer")).isEqualTo("owner");
        assertThat(r.json().at("/last_seen/radius_m").asDouble()).isEqualTo(100.0);
        assertThat(r.json().get("sightings")).hasSize(3);
        assertThat(r.str("/sightings/0/contact_phone")).isEqualTo("+573001112233");
        assertThat(r.json().at("/sightings/1/hidden").asBoolean()).isTrue();
        assertThat(r.str("/contact/whatsapp_url")).isEqualTo("https://wa.me/573114829017");
        assertThat(r.str("/contact/display_name")).isEqualTo("carolina");
    }

    @Test
    void theDeviceThatReportedSeesItsPinAsMine() {
        ApiClient reporter = clients.newBrowser();
        reporter.get("/config");   // receives a device cookie
        String device = Hashing.sha256Hex(reporter.cookie("device").orElseThrow());
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, MutableClock.START.minusSeconds(60), MutableClock.START.minusSeconds(60), null, device, null, "visible");
        ApiResponse r = reporter.get("/cases/{code}", "7K3PQ");
        assertThat(r.str("/sightings/2/editable_until")).isEqualTo("2026-10-14T17:14:00Z");
        assertThat(r.json().at("/sightings/2/mine").asBoolean()).isTrue();
        assertThat(r.json().at("/sightings/0/mine").asBoolean()).isFalse();
        assertThat(clients.newBrowser().get("/cases/{code}", "7K3PQ").json().get("sightings"))
                .allSatisfy(s -> assertThat(s.get("mine").asBoolean()).isFalse());
    }

    @Test
    void aPurgedCodeIsGoneAndAnUnknownOneNotFound() {
        cases.purge("GONE5");
        assertThat(clients.newBrowser().get("/cases/{code}", "GONE5").errorCode()).isEqualTo("gone");
        assertThat(clients.newBrowser().get("/cases/{code}", "ZZZZZ").errorCode()).isEqualTo("not_found");
        assertThat(clients.newBrowser().get("/cases/{code}", "not-a-code").errorCode()).isEqualTo("not_found");
    }

    @Test
    void aClosedCaseStillResolvesWithoutContact() {
        cases.lostCase(carolina, "H4PPY", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "reunited", MutableClock.START.minusSeconds(5 * 86_400));
        ApiResponse r = clients.newBrowser().get("/cases/{code}", "H4PPY");
        assertThat(r.str("/status")).isEqualTo("reunited");
        assertThat(r.isNull("/contact")).isTrue();
        assertThat(r.str("/resolved_at")).isNotNull();
    }

    @Test
    void theStatementCountDoesNotGrowWithSightings() {
        for (int i = 0; i < 25; i++) {
            cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, MutableClock.START.minusSeconds(100 + i), MutableClock.START.minusSeconds(100 + i), null, "6".repeat(64), null, "visible");
        }
        ApiResponse r = owner.get("/cases/{code}", "7K3PQ");    // ApiClient enforces the ceiling (3)
        assertThat(r.json().get("sightings")).hasSize(28);
        assertThat(r.statements()).hasSizeLessThanOrEqualTo(3);
    }

    @Test
    void displayTextFollowsAcceptLanguage() {
        assertThat(clients.newBrowser().header("Accept-Language", "en").get("/cases/{code}", "7K3PQ").str("/last_seen/place_name"))
                .isEqualTo("Area marked on the map");
        assertThat(clients.newBrowser().get("/cases/{code}", "7K3PQ").str("/last_seen/place_name"))
                .isEqualTo("Zona marcada en el mapa");
    }
}
```

`B/src/test/java/co/scuby/cases/CaseSightingsPlanTest.java`:

```java
package co.scuby.cases;

import co.scuby.support.IntegrationTest;
import co.scuby.support.PlanAssert;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** A case's sightings (design · Queries and indexes): served by the replay key's unique index (case_code, client_id). */
@IntegrationTest
class CaseSightingsPlanTest {

    @Autowired DSLContext db;
    @Autowired TestDb testDb;
    @Autowired LostCaseQueries queries;

    @BeforeEach
    void setUp() { testDb.reset(); }

    @Test
    void aCasesSightingsAreReadByIndex() {
        SeedVolume.casesAndSightings(db, 2_000, 20_000);
        for (Access access : Access.values()) {
            PlanAssert.assertNoSeqScanOn(db, queries.sightingsQuery("C000A", access), "sighting");
        }
    }
}
```

and the shared seeding helper (also used by Tasks 6 and 7) `B/src/test/java/co/scuby/cases/SeedVolume.java`:

```java
package co.scuby.cases;

import org.jooq.DSLContext;

/** Thousands of rows for plan checks. Codes C0001…CFFFF (hex, so 5 characters up to 65,535 cases); cases spread over ~0.5° around Medellín; 10 % active. */
final class SeedVolume {

    private SeedVolume() {}

    static void casesAndSightings(DSLContext db, int cases, int sightings) {
        db.execute("INSERT INTO scuby.person (id, display_name, email, created_at) VALUES ('00000000-0000-0000-0000-000000000001', 'Seed', 'seed@x.co', now()) ON CONFLICT DO NOTHING");
        db.execute("""
                INSERT INTO scuby.pet (id, name, species, custody_state, created_at)
                SELECT ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, 'P' || g,
                       (ARRAY['dog','cat','other'])[1 + g % 3], 'claimed', now()
                FROM generate_series(1, ?) g""", cases);
        db.execute("""
                INSERT INTO scuby.lost_case (code, pet_id, created_by, status, published_at, contact_phone, phone_has_whatsapp,
                  expose_whatsapp, expose_email, in_app_only, last_seen_lat, last_seen_lng, last_seen_radius_m, last_seen_at)
                SELECT 'C' || upper(lpad(to_hex(g), 4, '0')), ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid,
                  '00000000-0000-0000-0000-000000000001', CASE WHEN g % 10 = 0 THEN 'active' ELSE 'expired' END,
                  timestamptz '2026-01-01' + g * interval '2 hours', '+573007152284', true, true, false, false,
                  6.0 + (g % 97) * 0.005, -75.8 + (g % 89) * 0.005, 300, timestamptz '2026-01-01' + g * interval '2 hours'
                FROM generate_series(1, ?) g""", cases);
        db.execute("""
                INSERT INTO scuby.sighting (id, case_code, lat, lng, seen_at, created_at, reporter_person_id,
                  reporter_device_hash, reporter_ip_hash, status)
                SELECT gen_random_uuid(), 'C' || upper(lpad(to_hex(1 + g % ?), 4, '0')), 6.25, -75.59,
                  timestamptz '2026-01-01' + g * interval '5 minutes', timestamptz '2026-01-01' + g * interval '5 minutes',
                  CASE WHEN g % 4 = 0 THEN '00000000-0000-0000-0000-000000000001'::uuid END,
                  md5((g % 3000)::text) || md5('d'), md5((g % 700)::text) || md5('i'),
                  CASE WHEN g % 10 = 0 THEN 'hidden_by_owner' ELSE 'visible' END
                FROM generate_series(1, ?) g""", cases, sightings);
        db.execute("ANALYZE scuby.lost_case");
        db.execute("ANALYZE scuby.sighting");
        db.execute("ANALYZE scuby.pet");
    }
}
```

- [ ] **Step 2: Run to see them fail**

Run: `[mvn] -q test -Dtest='PublicTextDerivationTest,LostCaseDerivationTest,CaseEndpointTest,CaseSightingsPlanTest'`
Expected: compilation FAILURE (`SIGHTING`, `LostCaseDerivation`, … not found).

- [ ] **Step 3: Migration**

`B/src/main/resources/db/migration/V20261030_1040__sightings.sql`:

```sql
-- «Lo vi» sightings on a lost case (docs/product/04-lost-workflow.md · Sightings, Validation).
-- Written only by the cases feature. Visible at once; the owner may hide (status) or highlight.
-- Reporter = reporter_person_id when signed in, else the device (reporter_device_hash); the IP is
-- kept only as an HMAC (reporter_ip_hash) for the second rate-limit key. contact_phone is owner-only.
-- (case_code, client_id) is the replay key of an offline retry (docs/eng/api.md · Conventions); its
-- unique index also serves "a case's sightings" (case_code prefix) — no separate index needed.
CREATE TABLE sighting (
  id                    uuid PRIMARY KEY,
  case_code             text NOT NULL REFERENCES lost_case (code),
  lat                   double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng                   double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  point                 public.geography(Point, 4326) GENERATED ALWAYS AS
                          (public.ST_SetSRID(public.ST_MakePoint(lng, lat), 4326)::public.geography) STORED,
  seen_at               timestamptz NOT NULL,
  created_at            timestamptz NOT NULL,
  note                  text CHECK (length(note) <= 500),
  photo_urls            text[] NOT NULL DEFAULT '{}' CHECK (cardinality(photo_urls) <= 3),
  reporter_person_id    uuid REFERENCES person (id) ON DELETE SET NULL,
  reporter_device_hash  text NOT NULL CHECK (reporter_device_hash ~ '^[0-9a-f]{64}$'),
  reporter_ip_hash      text NOT NULL CHECK (reporter_ip_hash ~ '^[0-9a-f]{64}$'),
  contact_phone         text CHECK (contact_phone ~ '^\+[1-9][0-9]{6,14}$'),
  status                text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden_by_owner', 'removed_by_moderation')),
  highlighted_by_owner  boolean NOT NULL DEFAULT false,
  client_id             text CHECK (length(client_id) BETWEEN 8 AND 64),
  CONSTRAINT sighting_replay_key UNIQUE (case_code, client_id)
);
```

(The `CaseFixtures.sighting` helper writes `reporter_ip_hash = 'fff…'` and test device hashes like `"3".repeat(64)` — both match the CHECKs. The `SeedVolume` hashes are `md5||md5` = 64 hex characters.)

- [ ] **Step 4: Code**

`B/src/main/java/co/scuby/platform/web/LocaleConfiguration.java`:

```java
package co.scuby.platform.web;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.LocaleResolver;
import org.springframework.web.servlet.i18n.AcceptHeaderLocaleResolver;

import java.util.List;
import java.util.Locale;

/** Accept-Language → the language of server-composed text (docs/eng/api.md · Language): es (default) or en. */
@Configuration(proxyBeanMethods = false)
public class LocaleConfiguration {

    @Bean
    LocaleResolver localeResolver() {
        AcceptHeaderLocaleResolver resolver = new AcceptHeaderLocaleResolver();
        resolver.setSupportedLocales(List.of(Locale.forLanguageTag("es"), Locale.forLanguageTag("en")));
        resolver.setDefaultLocale(Locale.forLanguageTag("es"));
        return resolver;
    }
}
```

`Access.java`:

```java
package co.scuby.cases;

/** What a viewer may see of a case (design · Responses). */
enum Access { OWNER, PUBLIC }
```

`Viewer.java`:

```java
package co.scuby.cases;

import org.jspecify.annotations.Nullable;

import java.util.UUID;

/** Who is looking, as the derivation needs it: the access, and who they are for `mine`. */
record Viewer(Access access, @Nullable UUID personId, String deviceHash) {}
```

`CaseAccessPolicy.java`:

```java
package co.scuby.cases;

import co.scuby.platform.security.Caller;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * The one place that decides who sees a case's private side (human review focus): only the person
 * who published it, by session. A device cookie never makes anyone the owner.
 */
@Component
class CaseAccessPolicy {
    Access accessFor(UUID createdBy, Caller caller) {
        return createdBy.equals(caller.personId()) ? Access.OWNER : Access.PUBLIC;
    }
}
```

`LostCaseFacts.java`:

```java
package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import org.jspecify.annotations.Nullable;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** What the database says about a lost case, loaded according to the viewer's access. */
record LostCaseFacts(String code, String status, @Nullable Instant resolvedAt, UUID createdBy, PetFacts pet,
                     GeoPoint center, double radiusM, Instant lastSeenAt, @Nullable String placeName,
                     String publisherName, String contactPhone, boolean phoneHasWhatsapp, boolean exposeWhatsapp,
                     List<SightingFacts> sightings) {

    record PetFacts(@Nullable String name, String species, @Nullable String size, List<String> colors,
                    @Nullable String marks, List<String> photoUrls) {}

    record SightingFacts(UUID id, GeoPoint point, Instant seenAt, Instant createdAt, @Nullable String note,
                         List<String> photoUrls, @Nullable UUID reporterPersonId, String reporterDeviceHash,
                         @Nullable String contactPhone, boolean hidden, boolean highlighted) {}

    LostCaseFacts withSightings(List<SightingFacts> loaded) {
        return new LostCaseFacts(code, status, resolvedAt, createdBy, pet, center, radiusM, lastSeenAt, placeName,
                publisherName, contactPhone, phoneHasWhatsapp, exposeWhatsapp, List.copyOf(loaded));
    }
}
```

`LostCaseQueries.java`:

```java
package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.Select;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.List;
import java.util.Optional;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PERSON;
import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.PURGED_CASE_CODE;
import static co.scuby.db.generated.Tables.SIGHTING;

/** Reads for GET /cases/{code}: one query for the case, one for its sightings — never one per sighting. */
@Component
class LostCaseQueries {

    private final DSLContext db;

    LostCaseQueries(DSLContext db) {
        this.db = db;
    }

    Optional<LostCaseFacts> loadCase(String code) {
        return db.select(LOST_CASE.CODE, LOST_CASE.STATUS, LOST_CASE.RESOLVED_AT, LOST_CASE.CREATED_BY,
                         LOST_CASE.LAST_SEEN_LAT, LOST_CASE.LAST_SEEN_LNG, LOST_CASE.LAST_SEEN_RADIUS_M, LOST_CASE.LAST_SEEN_AT,
                         LOST_CASE.PLACE_NAME, LOST_CASE.CONTACT_PHONE, LOST_CASE.PHONE_HAS_WHATSAPP, LOST_CASE.EXPOSE_WHATSAPP,
                         PET.NAME, PET.SPECIES, PET.SIZE, PET.COLORS, PET.MARKS, PET.PHOTO_URLS, PERSON.DISPLAY_NAME)
                 .from(LOST_CASE)
                 .join(PET).on(PET.ID.eq(LOST_CASE.PET_ID))
                 .join(PERSON).on(PERSON.ID.eq(LOST_CASE.CREATED_BY))
                 .where(LOST_CASE.CODE.eq(code))
                 .fetchOptional(r -> new LostCaseFacts(
                         r.get(LOST_CASE.CODE), r.get(LOST_CASE.STATUS),
                         r.get(LOST_CASE.RESOLVED_AT) == null ? null : r.get(LOST_CASE.RESOLVED_AT).toInstant(),
                         r.get(LOST_CASE.CREATED_BY),
                         new LostCaseFacts.PetFacts(r.get(PET.NAME), r.get(PET.SPECIES), r.get(PET.SIZE),
                                 Arrays.asList(r.get(PET.COLORS)), r.get(PET.MARKS), Arrays.asList(r.get(PET.PHOTO_URLS))),
                         new GeoPoint(r.get(LOST_CASE.LAST_SEEN_LAT), r.get(LOST_CASE.LAST_SEEN_LNG)),
                         r.get(LOST_CASE.LAST_SEEN_RADIUS_M), r.get(LOST_CASE.LAST_SEEN_AT).toInstant(),
                         r.get(LOST_CASE.PLACE_NAME), r.get(PERSON.DISPLAY_NAME), r.get(LOST_CASE.CONTACT_PHONE),
                         r.get(LOST_CASE.PHONE_HAS_WHATSAPP), r.get(LOST_CASE.EXPOSE_WHATSAPP), List.of()));
    }

    boolean isPurged(String code) {
        return db.fetchExists(PURGED_CASE_CODE, PURGED_CASE_CODE.CODE.eq(code));
    }

    List<LostCaseFacts.SightingFacts> sightings(String code, Access access) {
        return sightingsQuery(code, access).fetch(LostCaseQueries::toSighting);
    }

    /** PUBLIC: hidden and removed pins are not queried, and reporters' numbers are selected as NULL. */
    Select<? extends Record> sightingsQuery(String code, Access access) {
        var phone = access == Access.OWNER ? SIGHTING.CONTACT_PHONE : DSL.castNull(SIGHTING.CONTACT_PHONE).as(SIGHTING.CONTACT_PHONE.getName());
        var visibility = access == Access.OWNER
                ? SIGHTING.STATUS.ne("removed_by_moderation")
                : SIGHTING.STATUS.eq("visible");
        return db.select(SIGHTING.ID, SIGHTING.LAT, SIGHTING.LNG, SIGHTING.SEEN_AT, SIGHTING.CREATED_AT, SIGHTING.NOTE,
                         SIGHTING.PHOTO_URLS, SIGHTING.REPORTER_PERSON_ID, SIGHTING.REPORTER_DEVICE_HASH, phone,
                         SIGHTING.STATUS, SIGHTING.HIGHLIGHTED_BY_OWNER)
                 .from(SIGHTING)
                 .where(SIGHTING.CASE_CODE.eq(code)).and(visibility)
                 .orderBy(SIGHTING.SEEN_AT);
    }

    private static LostCaseFacts.SightingFacts toSighting(Record r) {
        return new LostCaseFacts.SightingFacts(r.get(SIGHTING.ID), new GeoPoint(r.get(SIGHTING.LAT), r.get(SIGHTING.LNG)),
                r.get(SIGHTING.SEEN_AT).toInstant(), r.get(SIGHTING.CREATED_AT).toInstant(), r.get(SIGHTING.NOTE),
                Arrays.asList(r.get(SIGHTING.PHOTO_URLS)), r.get(SIGHTING.REPORTER_PERSON_ID),
                r.get(SIGHTING.REPORTER_DEVICE_HASH), r.get(SIGHTING.CONTACT_PHONE.getName(), String.class),
                !"visible".equals(r.get(SIGHTING.STATUS)), r.get(SIGHTING.HIGHLIGHTED_BY_OWNER));
    }
}
```

`LostCaseView.java`:

```java
package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import org.jspecify.annotations.Nullable;

import java.time.Instant;
import java.util.List;

/** The contract's LostCase (web/src/contracts/case.ts). Every field present; null where the viewer may not see. */
record LostCaseView(String code, String vertical, String status, @Nullable Instant resolvedAt, String viewer,
                    PetView pet, LastSeenView lastSeen, int openClaimCount, List<SightingView> sightings,
                    List<Object> claims, @Nullable Object pendingCheckin, @Nullable ContactView contact) {

    record PetView(String name, String species, @Nullable String size, List<String> colors, @Nullable String marks,
                   List<String> photoUrls) {}

    record LastSeenView(GeoPoint center, double radiusM, Instant at, String placeName) {}

    record SightingView(String id, GeoPoint point, Instant seenAt, @Nullable String note, List<String> photoUrls,
                        String source, boolean highlightedByOwner, @Nullable String contactPhone, boolean hidden,
                        boolean mine, @Nullable Instant editableUntil) {}

    record ContactView(String displayName, @Nullable String whatsappUrl) {}
}
```

(`claims` is `List<Object>` and `pending_checkin` `Object` on purpose: they are always `[]` / `null` until «lo tengo» and the follow-up loop arrive; typing them now would be code without a consumer.)

`PublicTextDerivation.java`:

```java
package co.scuby.cases;

import org.jspecify.annotations.Nullable;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Collectors;

/** Text the server composes for display, in the request's language (es default, en). Pure. */
final class PublicTextDerivation {

    private PublicTextDerivation() {}

    private static final Map<String, String> SPECIES_ES = Map.of("dog", "perro", "cat", "gato", "other", "animal");
    private static final Map<String, String> SPECIES_EN = Map.of("dog", "dog", "cat", "cat", "other", "animal");
    private static final Map<String, String> SIZE_ES = Map.of("small", "pequeño", "medium", "mediano", "large", "grande");
    private static final Map<String, String> SIZE_EN = Map.of("small", "small", "medium", "medium", "large", "large");
    private static final Map<String, String> COLOR_ES = Map.of("black", "negro", "white", "blanco", "brown", "café",
            "tan", "canela", "gray", "gris", "yellow", "amarillo", "orange", "naranja");
    private static final Map<String, String> COLOR_EN = Map.of("black", "black", "white", "white", "brown", "brown",
            "tan", "tan", "gray", "gray", "yellow", "yellow", "orange", "orange");

    static boolean english(Locale locale) {
        return "en".equals(locale.getLanguage());
    }

    /** «Carolina Mejía» → «Carolina M.»: the public face of a publisher (as the client mock). */
    static String publicName(String displayName) {
        String[] parts = displayName.strip().split("\\s+");
        if (parts.length < 2) return parts[0];
        return parts[0] + " " + Character.toUpperCase(parts[1].charAt(0)) + ".";
    }

    static String placeName(@Nullable String stored, Locale locale) {
        if (stored != null) return stored;
        return english(locale) ? "Area marked on the map" : "Zona marcada en el mapa";
    }

    /** «Perro · Mediano · Negro y canela». */
    static String summary(String species, @Nullable String size, List<String> colors, Locale locale) {
        boolean en = english(locale);
        String and = en ? " and " : " y ";
        List<String> named = colors.stream().map(c -> (en ? COLOR_EN : COLOR_ES).get(c)).toList();
        String colorText = named.isEmpty() ? null
                : named.size() == 1 ? named.getFirst()
                : String.join(", ", named.subList(0, named.size() - 1)) + and + named.getLast();
        return java.util.stream.Stream.of((en ? SPECIES_EN : SPECIES_ES).get(species),
                        size == null ? null : (en ? SIZE_EN : SIZE_ES).get(size), colorText)
                .filter(java.util.Objects::nonNull)
                .map(p -> Character.toUpperCase(p.charAt(0)) + p.substring(1))
                .collect(Collectors.joining(" · "));
    }

    static String whatsappUrl(String e164) {
        return "https://wa.me/" + e164.substring(1);
    }
}
```

`LostCaseDerivation.java`:

```java
package co.scuby.cases;

import org.jspecify.annotations.Nullable;

import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * Facts + viewer + time → the LostCase response (design · Responses: facts → derivation → record).
 * Pure: no clock, no security context, no I/O.
 */
final class LostCaseDerivation {

    static final double PUBLIC_RADIUS_FLOOR_M = 200;
    static final Duration EDIT_WINDOW = Duration.ofMinutes(15);

    private LostCaseDerivation() {}

    static LostCaseView derive(LostCaseFacts facts, Viewer viewer, Instant now, Locale locale) {
        boolean owner = viewer.access() == Access.OWNER;
        var pet = facts.pet();
        List<LostCaseView.SightingView> sightings = facts.sightings().stream()
                .filter(s -> owner || !s.hidden())
                .sorted(Comparator.comparing(LostCaseFacts.SightingFacts::seenAt))
                .map(s -> sighting(s, viewer, owner, now))
                .toList();
        return new LostCaseView(
                facts.code(), "lost", facts.status(), facts.resolvedAt(), owner ? "owner" : "public",
                new LostCaseView.PetView(pet.name() == null ? "" : pet.name(), pet.species(), pet.size(),
                        pet.colors(), pet.marks(), pet.photoUrls()),
                new LostCaseView.LastSeenView(facts.center(),
                        owner ? facts.radiusM() : Math.max(facts.radiusM(), PUBLIC_RADIUS_FLOOR_M),
                        facts.lastSeenAt(), PublicTextDerivation.placeName(facts.placeName(), locale)),
                0, sightings, List.of(), null, contact(facts));
    }

    private static LostCaseView.SightingView sighting(LostCaseFacts.SightingFacts s, Viewer viewer, boolean owner, Instant now) {
        boolean mine = (viewer.personId() != null && viewer.personId().equals(s.reporterPersonId()))
                || viewer.deviceHash().equals(s.reporterDeviceHash());
        Instant until = s.createdAt().plus(EDIT_WINDOW);
        Instant editableUntil = mine && !s.hidden() && now.isBefore(until) ? until : null;
        return new LostCaseView.SightingView(s.id().toString(), s.point(), s.seenAt(), s.note(), s.photoUrls(),
                s.reporterPersonId() != null ? "registered" : "anonymous", s.highlighted(),
                owner ? s.contactPhone() : null, owner && s.hidden(), mine, editableUntil);
    }

    private static LostCaseView.@Nullable ContactView contact(LostCaseFacts facts) {
        if (!"active".equals(facts.status())) return null;
        String whatsapp = facts.exposeWhatsapp() && facts.phoneHasWhatsapp()
                ? PublicTextDerivation.whatsappUrl(facts.contactPhone()) : null;
        return new LostCaseView.ContactView(PublicTextDerivation.publicName(facts.publisherName()), whatsapp);
    }
}
```

`CaseReads.java`:

```java
package co.scuby.cases;

import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.util.Locale;

/** Access → facts → derivation for GET /cases/{code}. No transaction: two autocommit reads. */
@Component
class CaseReads {

    private final LostCaseQueries queries;
    private final CaseAccessPolicy policy;
    private final Clock clock;

    CaseReads(LostCaseQueries queries, CaseAccessPolicy policy, Clock clock) {
        this.queries = queries;
        this.policy = policy;
        this.clock = clock;
    }

    LostCaseView view(String rawCode, Caller caller, Locale locale) {
        String code = CaseCodes.normalize(rawCode).orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "no such case"));
        LostCaseFacts found = queries.loadCase(code).orElseThrow(() -> queries.isPurged(code)
                ? new ApiException(ErrorCode.GONE, "this case was purged")
                : new ApiException(ErrorCode.NOT_FOUND, "no such case"));
        Access access = policy.accessFor(found.createdBy(), caller);
        LostCaseFacts facts = found.withSightings(queries.sightings(code, access));
        return LostCaseDerivation.derive(facts, new Viewer(access, caller.personId(), caller.deviceHash()), clock.instant(), locale);
    }
}
```

`CaseController.java`:

```java
package co.scuby.cases;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Caller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.Locale;

@ApiComponent
@RestController
class CaseController {

    private final CaseReads reads;

    CaseController(CaseReads reads) {
        this.reads = reads;
    }

    @GetMapping("/cases/{code}")
    LostCaseView get(@PathVariable String code, Caller caller, Locale locale) {
        return reads.view(code, caller, locale);
    }
}
```

`TestDb.MUTABLE_TABLES`: add `"sighting"`. `StatementCeilings`: add `Map.entry("GET /cases/{code}", 3)`.

- [ ] **Step 5: Run**

Run: `[mvn] -q test -Dtest='PublicTextDerivationTest,LostCaseDerivationTest,CaseEndpointTest,CaseSightingsPlanTest,ArchitectureTest'`
Expected: PASS. `CaseSightingsPlanTest` prints an index scan on `sighting_replay_key` for both accesses: **no new index**; record the plans in the report (the replay key's unique index is itself new in this task — list `sighting_replay_key` under Indexes for human approval, justified as the replay key and as the per-case read path).

Run: `[mvn] verify` — PIT now mutates `LostCaseDerivation` and `PublicTextDerivation`; the score must be ≥ 80 %. If a surviving mutant shows an untested rule, add a row to the table (never lower the threshold). Record the score.

- [ ] **Step 6: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add backend/src/main/resources/db/migration/V20261030_1040__sightings.sql backend/src/main/java/co/scuby/platform/web/LocaleConfiguration.java backend/src/main/java/co/scuby/cases backend/src/test/java/co/scuby/cases backend/src/test/java/co/scuby/support
git commit -m "feat: GET /cases/{code} — access policy, facts by access, pure LostCaseDerivation with the 200 m public floor, gone/not_found"
```

---
### Task 6: `GET /feed` — nearest first, national fallback

**Rule (design · Behaviour decisions, Feed):** with `lat` and `lng`, open lost cases within `scuby.feed.near-radius-m` (25 km) ordered by distance band (≤ 2 km, ≤ 5 km, ≤ 10 km, ≤ 25 km) then newest `published_at` first → scope `local`. Nothing near, or no `lat`/`lng` → scope `national`, newest first. At most `scuby.feed.max-items` (100) items either way. `vertical`/`species` filter in the query, before the scope is decided. A non-`lost` `vertical` yields no items (`national`). Item fields (client mock `feedItem`): `title` = pet name, `summary` = composed look («Perro · Pequeño · Negro y canela») in the request's language, `place_name` (stored or the generic label), `point` = the case's center (never moved), `photo_url` = first pet photo or `null`, `happened_at` = `last_seen_at`, `possible_find` = `false` (no claims in this slice), `sightings_count` and `last_sighting_at` over **visible** sightings, `detail` = `null`. The query parameters are absent from `openapi.json` (`parameters: []`): implemented from `web/src/contracts/feed.ts`, reported to the client side (Task 11).

**Files:**
- Create (after the plan checks fail): `B/src/main/resources/db/migration/V20261030_1050__feed_indexes.sql`
- Create in `B/src/main/java/co/scuby/cases/`: `Vertical.java`, `FeedProperties.java`, `FeedQuery.java`, `FeedRow.java`, `FeedQueries.java`, `FeedView.java`, `FeedDerivation.java`, `FeedReads.java`, `FeedController.java`
- Modify: `B/src/main/resources/application.yml` (thin-slice block), `StatementCeilings.java`
- Test: `B/src/test/java/co/scuby/cases/FeedDerivationTest.java`, `FeedEndpointTest.java`, `FeedPlanTest.java`

**Interfaces:**
- Consumes: `PublicTextDerivation.summary/placeName`, `Spatial.distanceMeters/withinMeters/geography`, `GeoPoint`, `Pets.Species`, `CaseFixtures`, `SeedVolume`.
- Produces: `enum Vertical { lost, found, adoption, help }`; `record FeedRow(String code, @Nullable String petName, String species, @Nullable String size, List<String> colors, @Nullable String firstPhotoUrl, @Nullable String placeName, GeoPoint center, Instant lastSeenAt, int sightingsCount, @Nullable Instant lastSightingAt)`; `enum FeedDerivation.Scope { local, national }`; `FeedDerivation.derive(List<FeedRow>, Scope, Locale) → FeedView`; `FeedQueries.localQuery(GeoPoint, @Nullable String species, double radiusM, int limit)`, `FeedQueries.nationalQuery(@Nullable String species, int limit)` (both `Select<? extends Record>`), `FeedQueries.fetch(Select) → List<FeedRow>`.

- [ ] **Step 1: Write the failing tests**

`B/src/test/java/co/scuby/cases/FeedDerivationTest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThat;

class FeedDerivationTest {

    static final Instant T = Instant.parse("2026-10-14T13:00:00Z");

    static FeedRow row(String code, String photo, String place, int count, Instant last) {
        return new FeedRow(code, "Luna", "cat", "small", List.of("black", "tan"), photo, place,
                new GeoPoint(6.2442, -75.5812), T, count, last);
    }

    @Test
    void itemsKeepTheQueryOrderAndCarryTheLostCardFields() {
        FeedView view = FeedDerivation.derive(List.of(
                row("AAAAA", "http://x/a.jpg", null, 2, T.plusSeconds(60)),
                row("BBBBB", null, "Laureles", 0, null)), FeedDerivation.Scope.local, Locale.forLanguageTag("es"));
        assertThat(view.scope()).isEqualTo("local");
        assertThat(view.items()).extracting(FeedView.FeedItem::code).containsExactly("AAAAA", "BBBBB");
        FeedView.FeedItem a = view.items().getFirst();
        assertThat(a.vertical()).isEqualTo("lost");
        assertThat(a.title()).isEqualTo("Luna");
        assertThat(a.summary()).isEqualTo("Gato · Pequeño · Negro y canela");
        assertThat(a.placeName()).isEqualTo("Zona marcada en el mapa");
        assertThat(a.photoUrl()).isEqualTo("http://x/a.jpg");
        assertThat(a.happenedAt()).isEqualTo(T);
        assertThat(a.possibleFind()).isFalse();
        assertThat(a.sightingsCount()).isEqualTo(2);
        assertThat(a.lastSightingAt()).isEqualTo(T.plusSeconds(60));
        assertThat(a.detail()).isNull();
        FeedView.FeedItem b = view.items().get(1);
        assertThat(b.placeName()).isEqualTo("Laureles");
        assertThat(b.photoUrl()).isNull();
        assertThat(b.lastSightingAt()).isNull();
    }

    @Test
    void englishTextAndAnUnnamedPet() {
        var unnamed = new FeedRow("CCCCC", null, "dog", null, List.of(), null, null, new GeoPoint(4.7, -74.0), T, 0, null);
        FeedView view = FeedDerivation.derive(List.of(unnamed), FeedDerivation.Scope.national, Locale.forLanguageTag("en"));
        assertThat(view.scope()).isEqualTo("national");
        assertThat(view.items().getFirst().title()).isEqualTo("");
        assertThat(view.items().getFirst().summary()).isEqualTo("Dog");
        assertThat(view.items().getFirst().placeName()).isEqualTo("Area marked on the map");
    }
}
```

`B/src/test/java/co/scuby/cases/FeedEndpointTest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.TestDb;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class FeedEndpointTest {

    // Distances from Medellín's center (6.2442, -75.5812): ~1 km, ~4 km, ~20 km; Bogotá ~240 km.
    static final GeoPoint ONE_KM = new GeoPoint(6.2532, -75.5812);
    static final GeoPoint FOUR_KM = new GeoPoint(6.2802, -75.5812);
    static final GeoPoint TWENTY_KM = new GeoPoint(6.4242, -75.5812);
    static final GeoPoint BOGOTA = new GeoPoint(4.711, -74.0721);

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;

    ApiClient api;
    UUID owner;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
        owner = accounts.person("owner@correo.co");
    }

    private Instant daysAgo(int d) {
        return MutableClock.START.minusSeconds(d * 86_400L);
    }

    private List<String> codes(ApiResponse r) {
        List<String> out = new ArrayList<>();
        r.json().get("items").forEach(i -> out.add(i.get("code").asString()));
        return out;
    }

    @Test
    void withoutAPointTheFeedIsNationalNewestFirstOpenCasesOnly() {
        cases.lostCase(owner, "AAAA2", "Uno", "dog", ONE_KM, 300, "active", daysAgo(3));
        cases.lostCase(owner, "BBBB2", "Dos", "dog", BOGOTA, 300, "active", daysAgo(1));
        cases.lostCase(owner, "CCCC2", "Tres", "dog", FOUR_KM, 300, "expired", daysAgo(0));
        ApiResponse r = api.get("/feed");
        assertThat(r.str("/scope")).isEqualTo("national");
        assertThat(codes(r)).containsExactly("BBBB2", "AAAA2");
    }

    @Test
    void nearAPointTheNearestBandComesFirstThenTheNewest() {
        cases.lostCase(owner, "NEAR2", "Cerca", "dog", ONE_KM, 300, "active", daysAgo(10));
        cases.lostCase(owner, "MID22", "Medio", "dog", FOUR_KM, 300, "active", daysAgo(1));
        cases.lostCase(owner, "MID33", "Medio2", "dog", FOUR_KM, 300, "active", daysAgo(2));
        cases.lostCase(owner, "FAR22", "Lejos", "dog", TWENTY_KM, 300, "active", daysAgo(0));
        cases.lostCase(owner, "BOG22", "Bogotá", "dog", BOGOTA, 300, "active", daysAgo(0));
        ApiResponse r = api.get("/feed?lat={lat}&lng={lng}", 6.2442, -75.5812);
        assertThat(r.str("/scope")).isEqualTo("local");
        assertThat(codes(r)).containsExactly("NEAR2", "MID22", "MID33", "FAR22");
    }

    // Port of backend.test.ts «falls back to the whole country when nothing is near».
    @Test
    void nothingNearFallsBackToTheWholeCountry() {
        cases.lostCase(owner, "NEAR2", "Cerca", "dog", ONE_KM, 300, "active", daysAgo(1));
        ApiResponse r = api.get("/feed?lat={lat}&lng={lng}", 4.711, -74.0721);
        assertThat(r.str("/scope")).isEqualTo("national");
        assertThat(codes(r)).containsExactly("NEAR2");
    }

    @Test
    void filtersApplyBeforeTheScopeIsDecided() {
        cases.lostCase(owner, "DOG22", "Perro", "dog", ONE_KM, 300, "active", daysAgo(1));
        cases.lostCase(owner, "CAT22", "Gato", "cat", BOGOTA, 300, "active", daysAgo(1));
        ApiResponse r = api.get("/feed?lat={lat}&lng={lng}&species=cat", 6.2442, -75.5812);
        assertThat(r.str("/scope")).isEqualTo("national");
        assertThat(codes(r)).containsExactly("CAT22");
        assertThat(api.get("/feed?vertical=found").json().get("items")).isEmpty();
        assertThat(codes(api.get("/feed?vertical=lost"))).containsExactlyInAnyOrder("DOG22", "CAT22");
    }

    @Test
    void anItemCarriesTheCardFields() {
        cases.lostCase(owner, "LUNA2", "Luna", "cat", ONE_KM, 100, "active", daysAgo(1));
        cases.sighting("LUNA2", ONE_KM, daysAgo(0).minusSeconds(3600), daysAgo(0).minusSeconds(3600), null, "3".repeat(64), null, "visible");
        cases.sighting("LUNA2", ONE_KM, daysAgo(0).minusSeconds(60), daysAgo(0).minusSeconds(60), null, "3".repeat(64), null, "hidden_by_owner");
        ApiResponse r = api.get("/feed");
        assertThat(r.str("/items/0/title")).isEqualTo("Luna");
        assertThat(r.str("/items/0/summary")).isEqualTo("Gato · Pequeño · Negro y canela");
        assertThat(r.str("/items/0/place_name")).isEqualTo("Zona marcada en el mapa");
        assertThat(r.json().at("/items/0/point/lat").asDouble()).isEqualTo(ONE_KM.lat());
        assertThat(r.json().at("/items/0/sightings_count").asInt()).isEqualTo(1);
        assertThat(r.str("/items/0/last_sighting_at")).isEqualTo("2026-10-14T16:00:00Z");
        assertThat(r.json().at("/items/0/possible_find").asBoolean()).isFalse();
        assertThat(r.isNull("/items/0/detail")).isTrue();
        assertThat(r.str("/items/0/photo_url")).endsWith(".jpg");
    }

    @Test
    void atMostOneHundredItemsAndTheStatementCountDoesNotGrow() {
        for (int i = 0; i < 105; i++) {
            cases.lostCase(owner, "Z%04d".formatted(i), "P" + i, "dog", BOGOTA, 300, "active", daysAgo(1).plusSeconds(i));
        }
        ApiResponse r = api.get("/feed?lat={lat}&lng={lng}", 6.2442, -75.5812);   // ceiling enforced by ApiClient
        assertThat(r.json().get("items")).hasSize(100);
        assertThat(codes(r).getFirst()).isEqualTo("Z0104");
    }

    @Test
    void aBadQueryIsValidationFailed() {
        assertThat(api.get("/feed?lat={lat}&lng={lng}", 200, 0).errorCode()).isEqualTo("validation_failed");
        assertThat(api.get("/feed?species=dragon").errorCode()).isEqualTo("validation_failed");
    }
}
```

`B/src/test/java/co/scuby/cases/FeedPlanTest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import co.scuby.support.IntegrationTest;
import co.scuby.support.PlanAssert;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** The feed (design · Queries and indexes): neither branch may scan every case or every sighting. */
@IntegrationTest
class FeedPlanTest {

    @Autowired DSLContext db;
    @Autowired TestDb testDb;
    @Autowired FeedQueries queries;

    @BeforeEach
    void setUp() {
        testDb.reset();
        SeedVolume.casesAndSightings(db, 20_000, 40_000);
    }

    @Test
    void theLocalFeedUsesIndexes() {
        var q = queries.localQuery(new GeoPoint(6.2442, -75.5812), null, 25_000, 100);
        PlanAssert.assertNoSeqScanOn(db, q, "lost_case");
        PlanAssert.assertNoSeqScanOn(db, q, "sighting");
    }

    @Test
    void theNationalFeedUsesIndexes() {
        var q = queries.nationalQuery(null, 100);
        PlanAssert.assertNoSeqScanOn(db, q, "lost_case");
        PlanAssert.assertNoSeqScanOn(db, q, "sighting");
    }
}
```

- [ ] **Step 2: Run to see them fail**

Run: `[mvn] -q test -Dtest='FeedDerivationTest,FeedEndpointTest,FeedPlanTest'`
Expected: compilation FAILURE (`FeedDerivation`, `FeedQueries` not found).

- [ ] **Step 3: Code**

`Vertical.java`:

```java
package co.scuby.cases;

/** The four verticals (web/src/contracts/primitives.ts). Only `lost` exists in this slice. */
enum Vertical { lost, found, adoption, help }
```

`FeedProperties.java`:

```java
package co.scuby.cases;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** scuby.feed.*: what counts as near, and the cap while the contract has no paging. */
@ConfigurationProperties("scuby.feed")
record FeedProperties(double nearRadiusM, int maxItems) {}
```

`FeedQuery.java`:

```java
package co.scuby.cases;

import co.scuby.pets.Pets;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import org.jspecify.annotations.Nullable;

/** GET /feed query (web/src/contracts/feed.ts; missing from openapi.json — reported). */
record FeedQuery(@Nullable Vertical vertical,
                 Pets.@Nullable Species species,
                 @Nullable @DecimalMin("-90") @DecimalMax("90") Double lat,
                 @Nullable @DecimalMin("-180") @DecimalMax("180") Double lng) {}
```

`FeedRow.java`:

```java
package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import org.jspecify.annotations.Nullable;

import java.time.Instant;
import java.util.List;

/** One open lost case as the feed needs it (the facts of a feed item). */
record FeedRow(String code, @Nullable String petName, String species, @Nullable String size, List<String> colors,
               @Nullable String firstPhotoUrl, @Nullable String placeName, GeoPoint center, Instant lastSeenAt,
               int sightingsCount, @Nullable Instant lastSightingAt) {}
```

`FeedView.java`:

```java
package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import org.jspecify.annotations.Nullable;

import java.time.Instant;
import java.util.List;

/** The contract's Feed (web/src/contracts/feed.ts). */
record FeedView(String scope, List<FeedItem> items) {

    record FeedItem(String code, String vertical, String title, String species, @Nullable String summary,
                    String placeName, GeoPoint point, @Nullable String photoUrl, Instant happenedAt,
                    boolean possibleFind, @Nullable Integer sightingsCount, @Nullable Instant lastSightingAt,
                    @Nullable String detail) {}
}
```

`FeedDerivation.java`:

```java
package co.scuby.cases;

import java.util.List;
import java.util.Locale;

/** Feed rows (already ordered and capped by the query) → the contract's Feed. Pure. */
final class FeedDerivation {

    enum Scope { local, national }

    private FeedDerivation() {}

    static FeedView derive(List<FeedRow> rows, Scope scope, Locale locale) {
        return new FeedView(scope.name(), rows.stream().map(r -> new FeedView.FeedItem(
                r.code(), "lost", r.petName() == null ? "" : r.petName(), r.species(),
                PublicTextDerivation.summary(r.species(), r.size(), r.colors(), locale),
                PublicTextDerivation.placeName(r.placeName(), locale), r.center(), r.firstPhotoUrl(),
                r.lastSeenAt(), false, r.sightingsCount(), r.lastSightingAt(), null)).toList());
    }
}
```

`FeedQueries.java`:

```java
package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.db.Spatial;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.Select;
import org.jooq.impl.DSL;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;

import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.List;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.SIGHTING;

/** The feed in one query per branch; per-row sighting counts are correlated subqueries on the replay-key index. */
@Component
class FeedQueries {

    private final DSLContext db;

    FeedQueries(DSLContext db) {
        this.db = db;
    }

    private static final Field<Integer> SIGHTINGS = DSL.field(DSL.selectCount().from(SIGHTING)
            .where(SIGHTING.CASE_CODE.eq(LOST_CASE.CODE)).and(SIGHTING.STATUS.eq("visible"))).as("sightings_count");
    private static final Field<OffsetDateTime> LAST_SIGHTING = DSL.field(DSL.select(DSL.max(SIGHTING.SEEN_AT)).from(SIGHTING)
            .where(SIGHTING.CASE_CODE.eq(LOST_CASE.CODE)).and(SIGHTING.STATUS.eq("visible"))).as("last_sighting_at");

    Select<? extends Record> localQuery(GeoPoint near, @Nullable String species, double radiusM, int limit) {
        Field<Double> distance = Spatial.distanceMeters(LOST_CASE.LAST_SEEN_POINT, Spatial.geography(near));
        Field<Integer> band = DSL.when(distance.le(2_000.0), 0).when(distance.le(5_000.0), 1)
                                 .when(distance.le(10_000.0), 2).otherwise(3);
        return base(species)
                .and(Spatial.withinMeters(LOST_CASE.LAST_SEEN_POINT, Spatial.geography(near), radiusM))
                .orderBy(band, LOST_CASE.PUBLISHED_AT.desc())
                .limit(limit);
    }

    Select<? extends Record> nationalQuery(@Nullable String species, int limit) {
        return base(species).orderBy(LOST_CASE.PUBLISHED_AT.desc()).limit(limit);
    }

    List<FeedRow> fetch(Select<? extends Record> query) {
        return query.fetch(r -> new FeedRow(
                r.get(LOST_CASE.CODE), r.get(PET.NAME), r.get(PET.SPECIES), r.get(PET.SIZE),
                Arrays.asList(r.get(PET.COLORS)),
                r.get(PET.PHOTO_URLS).length == 0 ? null : r.get(PET.PHOTO_URLS)[0],
                r.get(LOST_CASE.PLACE_NAME), new GeoPoint(r.get(LOST_CASE.LAST_SEEN_LAT), r.get(LOST_CASE.LAST_SEEN_LNG)),
                r.get(LOST_CASE.LAST_SEEN_AT).toInstant(), r.get(SIGHTINGS),
                r.get(LAST_SIGHTING) == null ? null : r.get(LAST_SIGHTING).toInstant()));
    }

    private org.jooq.SelectConditionStep<Record> base(@Nullable String species) {
        Condition speciesFilter = species == null ? DSL.noCondition() : PET.SPECIES.eq(species);
        return db.select(LOST_CASE.CODE, LOST_CASE.PLACE_NAME, LOST_CASE.LAST_SEEN_LAT, LOST_CASE.LAST_SEEN_LNG,
                         LOST_CASE.LAST_SEEN_AT, PET.NAME, PET.SPECIES, PET.SIZE, PET.COLORS, PET.PHOTO_URLS,
                         SIGHTINGS, LAST_SIGHTING)
                 .from(LOST_CASE).join(PET).on(PET.ID.eq(LOST_CASE.PET_ID))
                 .where(LOST_CASE.STATUS.eq("active")).and(speciesFilter);
    }
}
```

(`db.select(...)` with 12 fields returns a `Record12<…>`-typed step; declare `base` as returning `SelectConditionStep<? extends Record>` or use `db.select(List.of(...fields))` (`Collection<SelectFieldOrAsterisk>` overload) to get `SelectConditionStep<Record>` — choose whichever compiles; behaviour is identical.)

`FeedReads.java`:

```java
package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Locale;

@Component
class FeedReads {

    private final FeedQueries queries;
    private final FeedProperties properties;

    FeedReads(FeedQueries queries, FeedProperties properties) {
        this.queries = queries;
        this.properties = properties;
    }

    FeedView feed(FeedQuery query, Locale locale) {
        if (query.vertical() != null && query.vertical() != Vertical.lost) {
            return FeedDerivation.derive(List.of(), FeedDerivation.Scope.national, locale);
        }
        String species = query.species() == null ? null : query.species().name();
        if (query.lat() != null && query.lng() != null) {
            List<FeedRow> near = queries.fetch(queries.localQuery(new GeoPoint(query.lat(), query.lng()), species,
                    properties.nearRadiusM(), properties.maxItems()));
            if (!near.isEmpty()) return FeedDerivation.derive(near, FeedDerivation.Scope.local, locale);
        }
        return FeedDerivation.derive(queries.fetch(queries.nationalQuery(species, properties.maxItems())),
                FeedDerivation.Scope.national, locale);
    }
}
```

`FeedController.java`:

```java
package co.scuby.cases;

import co.scuby.platform.roles.ApiComponent;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Locale;

@ApiComponent
@RestController
class FeedController {

    private final FeedReads reads;

    FeedController(FeedReads reads) {
        this.reads = reads;
    }

    @GetMapping("/feed")
    FeedView feed(@Valid FeedQuery query, Locale locale) {
        return reads.feed(query, locale);
    }
}
```

`application.yml`, thin-slice `scuby:` block:

```yaml
  feed:
    near-radius-m: 25000
    max-items: 100
```

`StatementCeilings`: add `Map.entry("GET /feed", 3)` (session lookup when signed in, local query, national fallback).

- [ ] **Step 4: Run the behaviour tests**

Run: `[mvn] -q test -Dtest='FeedDerivationTest,FeedEndpointTest,ArchitectureTest'`
Expected: PASS. If `aBadQueryIsValidationFailed` answers 422 without the envelope's `validation_failed` code, the binding error is reaching Spring as `MethodArgumentNotValidException`/`BindException` — `ApiErrorHandler.handleMethodArgumentNotValid` already maps it; fix only if it is not.

- [ ] **Step 5: Measure the feed — expect seq scans on `lost_case`**

Run: `[mvn] -q test -Dtest=FeedPlanTest`
Expected: FAIL with `Seq Scan on lost_case` (both branches). The `sighting` subqueries should already use `sighting_replay_key`. Copy the plans into the report ("feed — before").

- [ ] **Step 6: Earn the indexes**

`B/src/main/resources/db/migration/V20261030_1050__feed_indexes.sql`:

```sql
-- GET /feed (design · Behaviour decisions, Feed; FeedQueries). Plans before: Seq Scan on lost_case for
-- both branches (20,000 cases, 10 % active; A2 report). Plans after: these indexes.
-- 1. Local branch: ST_DWithin(last_seen_point, :here, 25 km) AND status = 'active' → GiST on the
--    geography, partial on active cases (closed cases leave the index, so it stays the size of the
--    open set, not of history).
-- 2. National branch: status = 'active' ORDER BY published_at DESC LIMIT 100 → a partial b-tree read
--    in order, stopping after 100 rows.
-- Write cost: two entries per active case, removed when it closes; no cost for sightings.
-- Overlaps: lost_case_one_active_per_pet (pet_id) — different column, no overlap.
-- Need human approval before merge.
CREATE INDEX lost_case_active_point_idx ON lost_case USING gist (last_seen_point) WHERE status = 'active';
CREATE INDEX lost_case_active_published_idx ON lost_case (published_at DESC) WHERE status = 'active';
```

Run: `[mvn] -q test -Dtest='FeedPlanTest,FeedEndpointTest'`
Expected: PASS; copy the "after" plans and list both indexes under **Indexes for human approval**. If the national plan still seq-scans with 2,000 active rows of 20,000, report the plan and stop (stuck rule) — do not add further indexes unmeasured.

Run: `[mvn] verify` — PIT includes `FeedDerivation`; record the score.

- [ ] **Step 7: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add backend/src/main/resources/db/migration/V20261030_1050__feed_indexes.sql backend/src/main/java/co/scuby/cases backend/src/main/resources/application.yml backend/src/test/java/co/scuby/cases backend/src/test/java/co/scuby/support/StatementCeilings.java
git commit -m "feat: GET /feed — nearest distance band then newest, national fallback, capped at 100, filters before scope"
```

---

### Task 7: `POST /cases/{code}/sightings` — «Lo vi»

Order of checks (design table at the top; `docs/product/04-lost-workflow.md` · Validation; `docs/eng/api.md` · replays): the body against the contract (`validation_failed`, before anything); the case (unknown, purged → `not_found`); **`client_id` replay** — the same key on the same case answers the sighting it created, `201` with its id, before any other check and whoever sends it; status `active` else `invalid_transition`; `seen_at` > now + 5 min → `seen_at_in_future`; `seen_at` < `last_seen_at` − 24 h → `seen_at_before_case`; distance from the case's center > 30 km (PostGIS on `geography`) → `sighting_too_far`; `contact_phone` must be a supported mobile (`validation_failed` on `contact_phone`); photos must be this caller's processed `sighting` uploads (`validation_failed` on `photo_urls`); rate limits (reporter = account when signed in, else device: 5 per case, 20 overall per rolling 24 h; IP as second key: 20 per case, 80 overall) → `rate_limited`; insert (visible at once). Answer `201 {"id": …}`.

**Files:**
- Create (after the plan checks fail): `B/src/main/resources/db/migration/V20261030_1060__sighting_rate_limit_indexes.sql`
- Create in `B/src/main/java/co/scuby/cases/`: `SightingRequest.java`, `SightingRulesDerivation.java`, `SightingProperties.java`, `SightingQueries.java`, `SightingService.java`, `SightingController.java`
- Modify: `application.yml` (thin-slice block), `StatementCeilings.java`
- Test: `B/src/test/java/co/scuby/cases/SightingRulesDerivationTest.java`, `SightingEndpointTest.java`, `SightingRateLimitPlanTest.java`

**Interfaces:**
- Consumes: `PhoneNumbers.requireMobile(String, String)` (identity), `PhotoAttachments.requireAttachable(...)` + `UploadPurpose.sighting` (uploads), `Caller`, `CaseCodes.normalize`, `PointInput`, `Spatial`, `CaseFixtures`, `SeedVolume`.
- Produces:
  - `SightingRulesDerivation`: `enum Refusal { SEEN_AT_IN_FUTURE, SEEN_AT_BEFORE_CASE, SIGHTING_TOO_FAR }`, `static Optional<Refusal> check(Instant seenAt, Instant now, Instant lastSeenAt, double distanceM)`, `record Counts(int onCase, int total)`, `record Limits(int perCase, int perReporter, int perCasePerIp, int perIp)`, `static boolean limited(Counts reporter, Counts ip, Limits limits)`; constants `CLOCK_DRIFT = 5 min`, `BEFORE_CASE = 24 h`, `MAX_DISTANCE_M = 30_000`.
  - `SightingQueries`: `Optional<CaseForSighting> caseFor(String code, GeoPoint point)` (`record CaseForSighting(String status, Instant lastSeenAt, double distanceM)`), `Optional<UUID> replay(String code, String clientId)`, `Select<Record2<Integer,Integer>> reporterCountsQuery(Caller, String code, Instant since)`, `Select<Record2<Integer,Integer>> ipCountsQuery(String ipHash, String code, Instant since)`, `UUID insert(...)`.
  - `POST /cases/{code}/sightings` → 201 `{id}`; statement ceiling 8.

- [ ] **Step 1: Write the failing tests**

`B/src/test/java/co/scuby/cases/SightingRulesDerivationTest.java`:

```java
package co.scuby.cases;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;

/** docs/product/04-lost-workflow.md · Validation, and the design's rate limits. Human review: these tables are the rules. */
class SightingRulesDerivationTest {

    static final Instant NOW = Instant.parse("2026-10-14T17:00:00Z");
    static final Instant LAST_SEEN = NOW.minus(Duration.ofDays(2));

    @ParameterizedTest(name = "seen {0} min from now, {1} m away → {2}")
    @CsvSource(nullValues = "none", value = {
            "0,      100,    none",
            "5,      100,    none",                  // exactly the 5-minute drift: accepted
            "6,      100,    SEEN_AT_IN_FUTURE",
            "-4320,  100,    none",                  // exactly 24 h before last seen (last seen = 2 days ago): accepted
            "-4321,  100,    SEEN_AT_BEFORE_CASE",
            "0,      30000,  none",                  // exactly 30 km: accepted
            "0,      30001,  SIGHTING_TOO_FAR",
            "60,     99999,  SEEN_AT_IN_FUTURE",      // order: future, before, too far
            "-5000,  99999,  SEEN_AT_BEFORE_CASE",
    })
    void validation(long minutesFromNow, double distance, String expected) {
        Optional<SightingRulesDerivation.Refusal> r = SightingRulesDerivation.check(
                NOW.plus(Duration.ofMinutes(minutesFromNow)), NOW, LAST_SEEN, distance);
        assertThat(r.map(Enum::name).orElse(null)).isEqualTo(expected);
    }

    @ParameterizedTest(name = "reporter {0}/{1}, ip {2}/{3} → {4}")
    @CsvSource({
            "0,  0,  0,  0,  false",
            "4,  19, 19, 79, false",
            "5,  5,  0,  0,  true",     // 5 per reporter per case
            "0,  20, 0,  0,  true",     // 20 per reporter
            "0,  0,  20, 20, true",     // 20 per IP per case
            "0,  0,  0,  80, true",     // 80 per IP
    })
    void rateLimits(int onCase, int total, int ipOnCase, int ipTotal, boolean limited) {
        var limits = new SightingRulesDerivation.Limits(5, 20, 20, 80);
        assertThat(SightingRulesDerivation.limited(new SightingRulesDerivation.Counts(onCase, total),
                new SightingRulesDerivation.Counts(ipOnCase, ipTotal), limits)).isEqualTo(limited);
    }
}
```

`B/src/test/java/co/scuby/cases/SightingEndpointTest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.crypto.Hashing;
import co.scuby.platform.db.GeoPoint;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;

import java.time.Duration;
import java.util.UUID;

import static co.scuby.db.generated.Tables.SIGHTING;
import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class SightingEndpointTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired MutableClock clock;
    @Autowired DSLContext db;

    ApiClient api;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
        cases.luna(accounts.person("carolina@correo.co"));
    }

    static String body(String seenAt, String extra) {
        return """
                {"point":{"lat":6.2455,"lng":-75.5905},"seen_at":"%s","note":null,"contact_phone":null%s}""".formatted(seenAt, extra);
    }

    private ApiResponse report(ApiClient as, String extra) {
        return as.post("/cases/{code}/sightings", body(clock.instant().toString(), extra), "7K3PQ");
    }

    @Test
    void anAnonymousSightingIsVisibleAtOnceAndKeyedToTheDevice() {
        ApiResponse r = report(api, "");
        assertThat(r.status()).isEqualTo(201);
        UUID id = UUID.fromString(r.str("/id"));
        var row = db.selectFrom(SIGHTING).where(SIGHTING.ID.eq(id)).fetchOne();
        assertThat(row.getStatus()).isEqualTo("visible");
        assertThat(row.getReporterPersonId()).isNull();
        assertThat(row.getReporterDeviceHash()).isEqualTo(Hashing.sha256Hex(api.cookie("device").orElseThrow()));
        ApiResponse luna = api.get("/cases/{code}", "7K3PQ");
        assertThat(luna.json().at("/sightings/0/mine").asBoolean()).isTrue();
        assertThat(luna.str("/sightings/0/editable_until")).isEqualTo("2026-10-14T17:15:00Z");
    }

    @Test
    void aSignedInReporterIsTheAccount() {
        UUID me = accounts.signIn(api, "helper@correo.co");
        UUID id = UUID.fromString(report(api, "").str("/id"));
        assertThat(db.selectFrom(SIGHTING).where(SIGHTING.ID.eq(id)).fetchOne().getReporterPersonId()).isEqualTo(me);
    }

    @Test
    void aReplayIsTheSameSightingBeforeAnyCheckEvenOnAClosedCase() {
        String first = report(api, ",\"client_id\":\"c0ffee-replay-1\"").str("/id");
        db.execute("UPDATE scuby.lost_case SET status = 'reunited' WHERE code = '7K3PQ'");
        ApiResponse again = clients.newBrowser().post("/cases/{code}/sightings",
                body(clock.instant().toString(), ",\"client_id\":\"c0ffee-replay-1\""), "7K3PQ");
        assertThat(again.status()).isEqualTo(201);
        assertThat(again.str("/id")).isEqualTo(first);
        assertThat(db.fetchCount(SIGHTING)).isEqualTo(1);
    }

    @Test
    void unknownAndPurgedCodesAreNotFoundAndAClosedCaseIsInvalidTransition() {
        cases.purge("GONE5");
        assertThat(api.post("/cases/{code}/sightings", body(clock.instant().toString(), ""), "ZZZZZ").errorCode()).isEqualTo("not_found");
        assertThat(api.post("/cases/{code}/sightings", body(clock.instant().toString(), ""), "GONE5").errorCode()).isEqualTo("not_found");
        db.execute("UPDATE scuby.lost_case SET status = 'reunited' WHERE code = '7K3PQ'");
        assertThat(report(api, "").errorCode()).isEqualTo("invalid_transition");
    }

    @Test
    void timeAndDistanceRulesWithFiveMinutesOfClockDrift() {
        assertThat(api.post("/cases/{code}/sightings", body(clock.instant().plusSeconds(240).toString(), ""), "7K3PQ").status()).isEqualTo(201);
        assertThat(api.post("/cases/{code}/sightings", body(clock.instant().plusSeconds(360).toString(), ""), "7K3PQ").errorCode()).isEqualTo("seen_at_in_future");
        assertThat(api.post("/cases/{code}/sightings", body(clock.instant().minus(Duration.ofDays(4)).toString(), ""), "7K3PQ").errorCode()).isEqualTo("seen_at_before_case");
        String bogota = """
                {"point":{"lat":4.711,"lng":-74.0721},"seen_at":"%s","note":null,"contact_phone":null}""".formatted(clock.instant());
        assertThat(api.post("/cases/{code}/sightings", bogota, "7K3PQ").errorCode()).isEqualTo("sighting_too_far");
    }

    @Test
    void aContactPhoneMustBeASupportedMobile() {
        String withLandline = body(clock.instant().toString(), "").replace("\"contact_phone\":null", "\"contact_phone\":\"+5716012345\"");
        ApiResponse r = api.post("/cases/{code}/sightings", withLandline, "7K3PQ");
        assertThat(r.errorCode()).isEqualTo("validation_failed");
        assertThat(r.json().at("/error/fields").has("contact_phone")).isTrue();
    }

    @Test
    void photosMustBeThisCallersProcessedSightingUploads() {
        byte[] bytes = "pin-photo".getBytes();
        String sha = Hashing.sha256Hex(bytes);
        String url = api.post("/uploads", """
                {"purpose":"sighting","sha256":"%s","content_type":"image/jpeg","bytes":%d}""".formatted(sha, bytes.length)).str("/url");
        api.rawBytes(HttpMethod.PUT, "/dev-media/{sha}.jpg", bytes, "image/jpeg", sha);
        String withPhoto = ",\"photo_urls\":[\"" + url + "\"]";
        ApiResponse stranger = report(clients.newBrowser(), withPhoto);
        assertThat(stranger.json().at("/error/fields").has("photo_urls")).isTrue();
        assertThat(report(api, withPhoto).status()).isEqualTo(201);
    }

    @Test
    void fivePerReporterPerCaseADayAndTheAccountIsTheKeyWhenSignedIn() {
        for (int i = 0; i < 5; i++) assertThat(report(api, "").status()).isEqualTo(201);
        assertThat(report(api, "").errorCode()).isEqualTo("rate_limited");
        accounts.signIn(api, "helper@correo.co");                 // same device, now an account: a different reporter
        assertThat(report(api, "").status()).isEqualTo(201);
        clock.advance(Duration.ofHours(25));
        assertThat(report(clients.newBrowser(), "").status()).isEqualTo(201);
    }

    @Test
    void twentyPerReporterOverall() {
        UUID owner = accounts.person("owner2@correo.co");
        for (int c = 0; c < 4; c++) {
            String code = cases.lostCase(owner, "R%04d".formatted(c), "P" + c, "dog", CaseFixtures.MEDELLIN, 300, "active", MutableClock.START.minusSeconds(3600));
            for (int i = 0; i < 5; i++) {
                assertThat(api.post("/cases/{code}/sightings", body(clock.instant().toString(), ""), code).status()).isEqualTo(201);
            }
        }
        assertThat(report(api, "").errorCode()).isEqualTo("rate_limited");
    }

    @Test
    void theIpIsASecondKeyAcrossDevices() {
        for (int i = 0; i < 20; i++) {
            assertThat(report(clients.newBrowser().from("198.51.100.20"), "").status()).isEqualTo(201);
        }
        assertThat(report(clients.newBrowser().from("198.51.100.20"), "").errorCode()).isEqualTo("rate_limited");
        assertThat(report(clients.newBrowser().from("198.51.100.21"), "").status()).isEqualTo(201);
    }

    @Test
    void theStatementCeilingHoldsOnTheFullPath() {
        byte[] bytes = "pin-photo-2".getBytes();
        String sha = Hashing.sha256Hex(bytes);
        accounts.signIn(api, "helper@correo.co");
        String url = api.post("/uploads", """
                {"purpose":"sighting","sha256":"%s","content_type":"image/jpeg","bytes":%d}""".formatted(sha, bytes.length)).str("/url");
        api.rawBytes(HttpMethod.PUT, "/dev-media/{sha}.jpg", bytes, "image/jpeg", sha);
        String full = body(clock.instant().toString(), ",\"photo_urls\":[\"" + url + "\"],\"client_id\":\"full-path-1\"")
                .replace("\"contact_phone\":null", "\"contact_phone\":\"+573001112233\"");
        assertThat(api.post("/cases/{code}/sightings", full, "7K3PQ").status()).isEqualTo(201);   // ceiling enforced
    }
}
```

`B/src/test/java/co/scuby/cases/SightingRateLimitPlanTest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.security.Caller;
import co.scuby.support.IntegrationTest;
import co.scuby.support.PlanAssert;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.util.UUID;

/** The «Lo vi» rate-limit counts (design · Queries and indexes): per account, per device, per IP. */
@IntegrationTest
class SightingRateLimitPlanTest {

    static final Instant SINCE = Instant.parse("2026-10-13T17:00:00Z");

    @Autowired DSLContext db;
    @Autowired TestDb testDb;
    @Autowired SightingQueries queries;

    @BeforeEach
    void setUp() {
        testDb.reset();
        SeedVolume.casesAndSightings(db, 2_000, 40_000);
    }

    @Test
    void perAccount() {
        Caller signedIn = new Caller(UUID.fromString("00000000-0000-0000-0000-000000000001"), "a".repeat(64), "b".repeat(64));
        PlanAssert.assertNoSeqScanOn(db, queries.reporterCountsQuery(signedIn, "C000A", SINCE), "sighting");
    }

    @Test
    void perDevice() {
        Caller anonymous = new Caller(null, "a".repeat(64), "b".repeat(64));
        PlanAssert.assertNoSeqScanOn(db, queries.reporterCountsQuery(anonymous, "C000A", SINCE), "sighting");
    }

    @Test
    void perIp() {
        PlanAssert.assertNoSeqScanOn(db, queries.ipCountsQuery("b".repeat(64), "C000A", SINCE), "sighting");
    }
}
```

- [ ] **Step 2: Run to see them fail**

Run: `[mvn] -q test -Dtest='SightingRulesDerivationTest,SightingEndpointTest,SightingRateLimitPlanTest'`
Expected: compilation FAILURE (`SightingRulesDerivation`, `SightingQueries` not found).

- [ ] **Step 3: Code**

`SightingRequest.java`:

```java
package co.scuby.cases;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.jspecify.annotations.Nullable;

import java.time.OffsetDateTime;
import java.util.List;

/** SightingRequest (web/src/contracts/actions.ts). photo_urls defaults to []. */
record SightingRequest(@NotNull @Valid PointInput point,
                       @NotNull OffsetDateTime seenAt,
                       @Nullable @Size(max = 500) String note,
                       @Nullable @Size(max = 3) List<@NotBlank String> photoUrls,
                       @Nullable @Pattern(regexp = "^\\+[1-9]\\d{6,14}$") String contactPhone,
                       @Nullable @Size(min = 8, max = 64) String clientId) {

    List<String> photos() {
        return photoUrls == null ? List.of() : photoUrls;
    }
}
```

`SightingRulesDerivation.java`:

```java
package co.scuby.cases;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/**
 * «Lo vi» rules (docs/product/04-lost-workflow.md · Validation) and the rate-limit decision. Pure.
 * The 15-minute rule of 04 is waived inside the earlier pin's 15-minute correction window — the same
 * 15 minutes — so it never fires; it is deliberately not implemented (reported as an open question).
 */
final class SightingRulesDerivation {

    enum Refusal { SEEN_AT_IN_FUTURE, SEEN_AT_BEFORE_CASE, SIGHTING_TOO_FAR }

    record Counts(int onCase, int total) {}

    record Limits(int perCase, int perReporter, int perCasePerIp, int perIp) {}

    static final Duration CLOCK_DRIFT = Duration.ofMinutes(5);
    static final Duration BEFORE_CASE = Duration.ofHours(24);
    static final double MAX_DISTANCE_M = 30_000;

    private SightingRulesDerivation() {}

    static Optional<Refusal> check(Instant seenAt, Instant now, Instant lastSeenAt, double distanceM) {
        if (seenAt.isAfter(now.plus(CLOCK_DRIFT))) return Optional.of(Refusal.SEEN_AT_IN_FUTURE);
        if (seenAt.isBefore(lastSeenAt.minus(BEFORE_CASE))) return Optional.of(Refusal.SEEN_AT_BEFORE_CASE);
        if (distanceM > MAX_DISTANCE_M) return Optional.of(Refusal.SIGHTING_TOO_FAR);
        return Optional.empty();
    }

    static boolean limited(Counts reporter, Counts ip, Limits limits) {
        return reporter.onCase() >= limits.perCase() || reporter.total() >= limits.perReporter()
                || ip.onCase() >= limits.perCasePerIp() || ip.total() >= limits.perIp();
    }
}
```

`SightingProperties.java`:

```java
package co.scuby.cases;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** scuby.sightings.*: «Lo vi» limits per rolling 24 h (reporter: 04 · Validation; IP: decided in the thin slice). */
@ConfigurationProperties("scuby.sightings")
record SightingProperties(int perCase, int perReporter, int perCasePerIp, int perIp) {
    SightingRulesDerivation.Limits limits() {
        return new SightingRulesDerivation.Limits(perCase, perReporter, perCasePerIp, perIp);
    }
}
```

`SightingQueries.java`:

```java
package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.db.Spatial;
import co.scuby.platform.security.Caller;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Record2;
import org.jooq.Select;
import org.jooq.impl.DSL;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.SIGHTING;

@Component
class SightingQueries {

    record CaseForSighting(String status, Instant lastSeenAt, double distanceM) {}

    private final DSLContext db;

    SightingQueries(DSLContext db) {
        this.db = db;
    }

    /** The case and the point's distance from its center, on geography (meters). */
    Optional<CaseForSighting> caseFor(String code, GeoPoint point) {
        var distance = Spatial.distanceMeters(LOST_CASE.LAST_SEEN_POINT, Spatial.geography(point));
        return db.select(LOST_CASE.STATUS, LOST_CASE.LAST_SEEN_AT, distance)
                 .from(LOST_CASE).where(LOST_CASE.CODE.eq(code))
                 .fetchOptional(r -> new CaseForSighting(r.value1(), r.value2().toInstant(), r.value3()));
    }

    Optional<UUID> replay(String code, String clientId) {
        return db.select(SIGHTING.ID).from(SIGHTING)
                 .where(SIGHTING.CASE_CODE.eq(code)).and(SIGHTING.CLIENT_ID.eq(clientId))
                 .fetchOptional(r -> r.value1());
    }

    /** Reporter = the account when signed in, else the device (04 · Validation). */
    Select<Record2<Integer, Integer>> reporterCountsQuery(Caller caller, String code, Instant since) {
        Condition reporter = caller.signedIn()
                ? SIGHTING.REPORTER_PERSON_ID.eq(caller.personId())
                : SIGHTING.REPORTER_DEVICE_HASH.eq(caller.deviceHash());
        return counts(reporter, code, since);
    }

    Select<Record2<Integer, Integer>> ipCountsQuery(String ipHash, String code, Instant since) {
        return counts(SIGHTING.REPORTER_IP_HASH.eq(ipHash), code, since);
    }

    private Select<Record2<Integer, Integer>> counts(Condition who, String code, Instant since) {
        return db.select(DSL.count().filterWhere(SIGHTING.CASE_CODE.eq(code)), DSL.count())
                 .from(SIGHTING)
                 .where(who).and(SIGHTING.CREATED_AT.gt(since.atOffset(ZoneOffset.UTC)));
    }

    /** ON CONFLICT on the replay key: a concurrent retry of the same client_id gets the first row's id. */
    UUID insert(String code, GeoPoint point, Instant seenAt, Instant now, @Nullable String note, List<String> photos,
                Caller caller, @Nullable String contactPhone, @Nullable String clientId) {
        Optional<UUID> id = db.insertInto(SIGHTING)
                .set(SIGHTING.ID, UUID.randomUUID())
                .set(SIGHTING.CASE_CODE, code)
                .set(SIGHTING.LAT, point.lat()).set(SIGHTING.LNG, point.lng())
                .set(SIGHTING.SEEN_AT, seenAt.atOffset(ZoneOffset.UTC))
                .set(SIGHTING.CREATED_AT, now.atOffset(ZoneOffset.UTC))
                .set(SIGHTING.NOTE, note)
                .set(SIGHTING.PHOTO_URLS, photos.toArray(String[]::new))
                .set(SIGHTING.REPORTER_PERSON_ID, caller.personId())
                .set(SIGHTING.REPORTER_DEVICE_HASH, caller.deviceHash())
                .set(SIGHTING.REPORTER_IP_HASH, caller.ipHash())
                .set(SIGHTING.CONTACT_PHONE, contactPhone)
                .set(SIGHTING.CLIENT_ID, clientId)
                .onConflict(SIGHTING.CASE_CODE, SIGHTING.CLIENT_ID).doNothing()
                .returning(SIGHTING.ID)
                .fetchOptional(r -> r.get(SIGHTING.ID));
        return id.orElseGet(() -> replay(code, clientId).orElseThrow());
    }
}
```

`SightingService.java`:

```java
package co.scuby.cases;

import co.scuby.identity.PhoneNumbers;
import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.security.Caller;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import co.scuby.uploads.PhotoAttachments;
import co.scuby.uploads.UploadPurpose;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

@Service
class SightingService {

    private final SightingQueries queries;
    private final PhoneNumbers phones;
    private final PhotoAttachments photos;
    private final SightingProperties properties;
    private final Clock clock;

    SightingService(SightingQueries queries, PhoneNumbers phones, PhotoAttachments photos,
                    SightingProperties properties, Clock clock) {
        this.queries = queries;
        this.phones = phones;
        this.photos = photos;
        this.properties = properties;
        this.clock = clock;
    }

    @Transactional
    public UUID report(String rawCode, SightingRequest request, Caller caller) {
        String code = CaseCodes.normalize(rawCode).orElseThrow(SightingService::notFound);
        GeoPoint point = request.point().toGeoPoint();
        SightingQueries.CaseForSighting found = queries.caseFor(code, point).orElseThrow(SightingService::notFound);
        if (request.clientId() != null) {
            Optional<UUID> replayed = queries.replay(code, request.clientId());
            if (replayed.isPresent()) return replayed.get();
        }
        if (!"active".equals(found.status())) throw new ApiException(ErrorCode.INVALID_TRANSITION, "the case is not active");

        Instant now = clock.instant();
        Instant seenAt = request.seenAt().toInstant();
        SightingRulesDerivation.check(seenAt, now, found.lastSeenAt(), found.distanceM()).ifPresent(refusal -> {
            throw new ApiException(ErrorCode.valueOf(refusal.name()), refusal.name().toLowerCase());
        });
        String contact = request.contactPhone() == null ? null : phones.requireMobile(request.contactPhone(), "contact_phone");
        photos.requireAttachable(request.photos(), UploadPurpose.sighting, caller, "photo_urls");

        Instant since = now.minus(Duration.ofHours(24));
        var reporter = queries.reporterCountsQuery(caller, code, since).fetchOne();
        var ip = queries.ipCountsQuery(caller.ipHash(), code, since).fetchOne();
        if (SightingRulesDerivation.limited(new SightingRulesDerivation.Counts(reporter.value1(), reporter.value2()),
                new SightingRulesDerivation.Counts(ip.value1(), ip.value2()), properties.limits())) {
            throw new ApiException(ErrorCode.RATE_LIMITED, "too many sightings");
        }
        return queries.insert(code, point, seenAt, now, request.note(), request.photos(), caller, contact, request.clientId());
    }

    private static ApiException notFound() {
        return new ApiException(ErrorCode.NOT_FOUND, "no such case");
    }
}
```

`SightingController.java`:

```java
package co.scuby.cases;

import co.scuby.platform.roles.ApiComponent;
import co.scuby.platform.security.Caller;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@ApiComponent
@RestController
class SightingController {

    record Created(String id) {}

    private final SightingService service;

    SightingController(SightingService service) {
        this.service = service;
    }

    /** 201 {id}, also for a replay (the contract lists only 201). */
    @PostMapping("/cases/{code}/sightings")
    @ResponseStatus(HttpStatus.CREATED)
    Created report(@PathVariable String code, Caller caller, @Valid @RequestBody SightingRequest body) {
        return new Created(service.report(code, body, caller).toString());
    }
}
```

`application.yml`, thin-slice `scuby:` block:

```yaml
  sightings:
    per-case: 5
    per-reporter: 20
    per-case-per-ip: 20
    per-ip: 80
```

`StatementCeilings`: add `Map.entry("POST /cases/{code}/sightings", 8)` (session lookup, case + distance, replay, supported_countries, upload lookup, reporter counts, IP counts, insert).

- [ ] **Step 4: Run the behaviour tests**

Run: `[mvn] -q test -Dtest='SightingRulesDerivationTest,SightingEndpointTest,ArchitectureTest'`
Expected: PASS.

- [ ] **Step 5: Measure the rate-limit counts — expect seq scans**

Run: `[mvn] -q test -Dtest=SightingRateLimitPlanTest`
Expected: three FAILs with `Seq Scan on sighting`. Copy the plans ("sighting rate limits — before").

- [ ] **Step 6: Earn the indexes**

`B/src/main/resources/db/migration/V20261030_1060__sighting_rate_limit_indexes.sql`:

```sql
-- «Lo vi» rate limits (SightingQueries.reporterCountsQuery / ipCountsQuery):
--   SELECT count(*) FILTER (WHERE case_code = ?), count(*) FROM sighting
--   WHERE <reporter_person_id = ? | reporter_device_hash = ? | reporter_ip_hash = ?> AND created_at > now - 24 h
-- Plans before (40,000 sightings): Seq Scan on sighting for each (A2 report). After: an index range scan
-- per key over the last day's rows of that reporter or IP.
-- Write cost: three index entries per sighting (sightings are low-volume writes; reads per sighting
-- are 2 counts). The person index is partial (anonymous pins never need it).
-- Overlaps: sighting_replay_key (case_code, client_id) — different leading column, no overlap.
-- Need human approval before merge.
CREATE INDEX sighting_reporter_person_recent_idx ON sighting (reporter_person_id, created_at) WHERE reporter_person_id IS NOT NULL;
CREATE INDEX sighting_reporter_device_recent_idx ON sighting (reporter_device_hash, created_at);
CREATE INDEX sighting_reporter_ip_recent_idx ON sighting (reporter_ip_hash, created_at);
```

Run: `[mvn] -q test -Dtest='SightingRateLimitPlanTest,SightingEndpointTest'`
Expected: PASS; copy the "after" plans; list the three indexes under **Indexes for human approval**.

Run: `[mvn] verify` — PIT includes `SightingRulesDerivation`; record the score.

- [ ] **Step 7: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add backend/src/main/resources/db/migration/V20261030_1060__sighting_rate_limit_indexes.sql backend/src/main/java/co/scuby/cases backend/src/main/resources/application.yml backend/src/test/java/co/scuby/cases backend/src/test/java/co/scuby/support/StatementCeilings.java
git commit -m "feat: POST /cases/{code}/sightings — replay first, 04 validation with 5 min drift, contact and photo checks, reporter and IP rate limits"
```

---
### Task 8: Port the client mock's scenarios (behaviour parity)

`docs/eng/backend.md` · Testing: "the real backend has a test for each [backend.test.ts scenario] it implements". This task collects, in one class, every scenario of `web/src/mocks/backend.test.ts` that the slice's endpoints implement, each named after the original and annotated with its line in that file and — where the design overrides the mock — the override and its reason. Scenarios already ported in earlier tasks are referenced, not duplicated.

**Files:**
- Test: `B/src/test/java/co/scuby/cases/LostParityTest.java`

**Interfaces:**
- Consumes: `ApiClients`, `Accounts`, `CaseFixtures`, `PublishBodies`, `RecordingSmsSender`, `RecordingEmailSender`, `MutableClock`, `TestDb`.
- Produces: nothing new (tests only).

**Scenario map** (also the class Javadoc below):

| backend.test.ts | Ported as | Override (design wins) |
|---|---|---|
| refuses a body the contract rejects, naming the field (113) | `refusesABodyTheContractRejects` | — |
| answers `unauthorized` on a session endpoint with nobody signed in (128) | `unauthorizedWithNobodySignedIn` | uses `GET /session` (`listMyCases` is not in the slice) |
| a stranger gets no claims, no reporters' numbers, no hidden pins, no check-in (134) | `aStrangerGetsNothingOwnerOnly` | `open_claim_count` is 0 (no claims in the slice; the mock seeds one); radius floored at 200 m (design: the server applies the floor) |
| the owner gets all of it (145) | `theOwnerGetsAllOfIt` | no claims in the slice |
| a purged code is `gone`, an unknown one `not_found` (167) | `goneAndNotFound` | — |
| is local around Medellín, newest published first, open cases only (174) | `withoutAPointTheFeedIsNational` + `nearMedellinTheFeedIsLocalNearestFirst` | without `lat`/`lng` the feed is **national** (contract `feed.ts`: "without lat/lng the server answers nationally"; the mock substituted Medellín); with a point, nearest band first, then newest (design: product/02 "proximity + recency") |
| falls back to the whole country when nothing is near (191) | `FeedEndpointTest.nothingNearFallsBackToTheWholeCountry` | — |
| «Lo vi» is visible at once and tells the owner (215) | `aSightingIsVisibleAtOnce` | no notification (not in the slice) |
| refuses with `sighting_too_far` / `seen_at_in_future` / `seen_at_before_case` (229) | `refusals` | — |
| is rate-limited: five per reporter per case a day (237) | `fivePerReporterPerCaseADay` | — |
| «Lo vi otra vez» inside the earlier pin's correction window (244) | `againInsideTheCorrectionWindow` | — |
| a replay with the same `client_id` (252) | `aReplayIsTheSameSighting` | — |
| cannot be added to a closed case (264) | `notOnAClosedCase` | — |
| asks for the SMS code first, then publishes into the feed and the owner's lists (286) | `asksForTheSmsCodeFirstThenPublishesIntoTheFeed` | `place_name` is the generic label, not «Laureles» (`reverse_geocoding` off); owner's lists (`/me/cases`, `/me/pets`) are not in the slice |
| blocks a second active case for the same pet, naming the open one (312) | `PublishLostTest.aSecondActiveCaseForTheSamePetNamesTheOpenOne` | the pet id comes from the database (`/me/pets` is not in the slice) |
| needs a number when the account has none verified (322) | `PublishLostTest.noNumberAnywhereIsPhoneRequired` | — |
| marks the pin as yours for fifteen minutes, and no one else's (1616) | `CaseEndpointTest.theDeviceThatReportedSeesItsPinAsMine` | — |
| a stranger on another device sees none of them as theirs (1625) | same test, last assertion | — |
| changes the phone only after the SMS code (1905) | `PhoneEndpointsTest.changesThePhoneOnlyAfterTheSmsCode` (A1) | — |
| photo uploads (2095–2130) | `UploadsTest` (three tests named after them) | — |

- [ ] **Step 1: Write the class**

`B/src/test/java/co/scuby/cases/LostParityTest.java`:

```java
package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.PublishBodies;
import co.scuby.support.RecordingSmsSender;
import co.scuby.support.TestDb;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Parity with web/src/mocks/backend.test.ts (line numbers in parentheses). Where the design overrides
 * the mock, the override is named; scenarios ported elsewhere are pointed to.
 * <ul>
 * <li>(113) refuses a body the contract rejects → refusesABodyTheContractRejects</li>
 * <li>(128) unauthorized with nobody signed in → unauthorizedWithNobodySignedIn — uses GET /session (listMyCases not in the slice)</li>
 * <li>(134) a stranger gets nothing owner-only → aStrangerGetsNothingOwnerOnly — open_claim_count 0 (no claims in the slice)</li>
 * <li>(145) the owner gets all of it → theOwnerGetsAllOfIt — no claims in the slice</li>
 * <li>(167) gone / not_found → goneAndNotFound</li>
 * <li>(174) feed local around Medellín, newest first → withoutAPointTheFeedIsNational + nearMedellinTheFeedIsLocalNearestFirst —
 *     no point = national (contract feed.ts); with a point, nearest band then newest (design, product/02)</li>
 * <li>(191) national fallback → FeedEndpointTest.nothingNearFallsBackToTheWholeCountry</li>
 * <li>(215) a sighting is visible at once → aSightingIsVisibleAtOnce — no notification (not in the slice)</li>
 * <li>(229) the three refusals → refusals</li>
 * <li>(237) five per reporter per case a day → fivePerReporterPerCaseADay</li>
 * <li>(244) «otra vez» inside the correction window → againInsideTheCorrectionWindow</li>
 * <li>(252) client_id replay → aReplayIsTheSameSighting</li>
 * <li>(264) not on a closed case → notOnAClosedCase</li>
 * <li>(286) SMS code first, then into the feed → asksForTheSmsCodeFirstThenPublishesIntoTheFeed —
 *     place_name is the generic label (reverse_geocoding off), not «Laureles»; owner's lists not in the slice</li>
 * <li>(312) active_case_exists → PublishLostTest.aSecondActiveCaseForTheSamePetNamesTheOpenOne (pet id from the DB)</li>
 * <li>(322) phone_required → PublishLostTest.noNumberAnywhereIsPhoneRequired</li>
 * <li>(1616, 1625) mine for fifteen minutes / not for others → CaseEndpointTest.theDeviceThatReportedSeesItsPinAsMine</li>
 * <li>(1905) phone changes only after the SMS code → PhoneEndpointsTest.changesThePhoneOnlyAfterTheSmsCode</li>
 * <li>(2095–2130) photo uploads → UploadsTest</li>
 * </ul>
 */
@IntegrationTest
class LostParityTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired RecordingSmsSender sms;
    @Autowired MutableClock clock;

    ApiClient api;
    UUID carolina;

    @BeforeEach
    void setUp() {
        testDb.reset();
        api = clients.newBrowser();
        carolina = accounts.person("carolina@correo.co");
        cases.luna(carolina);
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, clock.instant().minusSeconds(7200), clock.instant().minusSeconds(7200),
                accounts.person("andres@correo.co"), "3".repeat(64), "+573114829017", "hidden_by_owner");
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, clock.instant().minusSeconds(5400), clock.instant().minusSeconds(5400),
                null, "4".repeat(64), "+573001112233", "visible");
        cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, clock.instant().minusSeconds(3600), clock.instant().minusSeconds(3600),
                null, "5".repeat(64), null, "visible");
    }

    private ApiResponse sighting(ApiClient as, String fields) {
        String body = """
                {"point":{"lat":6.2455,"lng":-75.5905},"seen_at":"%s","note":null,"contact_phone":null%s}"""
                .formatted(clock.instant(), fields);
        return as.post("/cases/{code}/sightings", body, "7K3PQ");
    }

    private List<String> codes(ApiResponse r) {
        List<String> out = new ArrayList<>();
        r.json().get("items").forEach(i -> out.add(i.get("code").asString()));
        return out;
    }

    @Test
    void refusesABodyTheContractRejects() {
        ApiResponse r = api.post("/cases/{code}/sightings",
                "{\"point\":{\"lat\":200,\"lng\":0},\"seen_at\":\"ayer\",\"note\":null,\"contact_phone\":null}", "7K3PQ");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.errorCode()).isEqualTo("validation_failed");
    }

    @Test
    void unauthorizedWithNobodySignedIn() {
        assertThat(api.get("/session").errorCode()).isEqualTo("unauthorized");
    }

    @Test
    void aStrangerGetsNothingOwnerOnly() {
        ApiResponse luna = api.get("/cases/{code}", "7K3PQ");
        assertThat(luna.str("/viewer")).isEqualTo("public");
        assertThat(luna.json().get("claims")).isEmpty();
        assertThat(luna.json().get("open_claim_count").asInt()).isZero();
        assertThat(luna.json().get("sightings")).hasSize(2);
        luna.json().get("sightings").forEach(s -> assertThat(s.get("contact_phone").isNull()).isTrue());
        assertThat(luna.isNull("/pending_checkin")).isTrue();
    }

    @Test
    void theOwnerGetsAllOfIt() {
        ApiClient owner = clients.newBrowser();
        owner.setCookie("session", sessionFor(carolina));
        ApiResponse luna = owner.get("/cases/{code}", "7k3pq");
        assertThat(luna.str("/viewer")).isEqualTo("owner");
        assertThat(luna.json().get("sightings")).filteredOn(s -> s.get("hidden").asBoolean()).hasSize(1);
        assertThat(luna.json().get("sightings")).anyMatch(s -> !s.get("contact_phone").isNull());
    }

    @Test
    void goneAndNotFound() {
        cases.purge("GONE5");
        assertThat(api.get("/cases/{code}", "GONE5").errorCode()).isEqualTo("gone");
        assertThat(api.get("/cases/{code}", "ZZZZZ").errorCode()).isEqualTo("not_found");
    }

    @Test
    void withoutAPointTheFeedIsNational() {
        cases.lostCase(carolina, "M2TQ4", "Max", "dog", new GeoPoint(6.25, -75.57), 300, "active", clock.instant().minusSeconds(3600));
        cases.lostCase(carolina, "H4PPY", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "reunited", clock.instant().minusSeconds(60));
        ApiResponse feed = api.get("/feed");
        assertThat(feed.str("/scope")).isEqualTo("national");
        assertThat(codes(feed)).containsExactly("M2TQ4", "7K3PQ");          // newest first, open only
    }

    @Test
    void nearMedellinTheFeedIsLocalNearestFirst() {
        cases.lostCase(carolina, "M2TQ4", "Max", "dog", new GeoPoint(6.30, -75.57), 300, "active", clock.instant().minusSeconds(3600));
        ApiResponse feed = api.get("/feed?lat={lat}&lng={lng}", 6.2442, -75.5812);
        assertThat(feed.str("/scope")).isEqualTo("local");
        assertThat(codes(feed)).containsExactly("7K3PQ", "M2TQ4");          // Luna is at the center: nearest band
    }

    @Test
    void aSightingIsVisibleAtOnce() {
        sighting(api, "").str("/id");
        ApiResponse luna = api.get("/cases/{code}", "7K3PQ");
        assertThat(luna.json().get("sightings")).hasSize(3);
        assertThat(luna.json().get("sightings").get(2).get("mine").asBoolean()).isTrue();
    }

    @Test
    void refusals() {
        assertThat(api.post("/cases/{code}/sightings", """
                {"point":{"lat":4.711,"lng":-74.0721},"seen_at":"%s","note":null,"contact_phone":null}""".formatted(clock.instant()), "7K3PQ")
                .errorCode()).isEqualTo("sighting_too_far");
        assertThat(api.post("/cases/{code}/sightings", """
                {"point":{"lat":6.2455,"lng":-75.5905},"seen_at":"%s","note":null,"contact_phone":null}""".formatted(clock.instant().plus(Duration.ofHours(1))), "7K3PQ")
                .errorCode()).isEqualTo("seen_at_in_future");
        assertThat(api.post("/cases/{code}/sightings", """
                {"point":{"lat":6.2455,"lng":-75.5905},"seen_at":"%s","note":null,"contact_phone":null}""".formatted(clock.instant().minus(Duration.ofDays(4))), "7K3PQ")
                .errorCode()).isEqualTo("seen_at_before_case");
    }

    @Test
    void fivePerReporterPerCaseADay() {
        for (int i = 0; i < 5; i++) assertThat(sighting(api, "").status()).isEqualTo(201);
        assertThat(sighting(api, "").errorCode()).isEqualTo("rate_limited");
        clock.advance(Duration.ofHours(25));
        assertThat(sighting(api, "").status()).isEqualTo(201);
    }

    @Test
    void againInsideTheCorrectionWindow() {
        assertThat(sighting(api, "").status()).isEqualTo(201);
        clock.advance(Duration.ofSeconds(60));
        assertThat(sighting(api, "").status()).isEqualTo(201);
    }

    @Test
    void aReplayIsTheSameSighting() {
        String first = sighting(api, ",\"client_id\":\"c0ffee-replay-1\"").str("/id");
        clock.advance(Duration.ofSeconds(60));
        assertThat(sighting(api, ",\"client_id\":\"c0ffee-replay-1\"").str("/id")).isEqualTo(first);
        assertThat(sighting(api, ",\"client_id\":\"c0ffee-replay-2\"").str("/id")).isNotEqualTo(first);
        assertThat(api.get("/cases/{code}", "7K3PQ").json().get("sightings")).hasSize(4);
    }

    @Test
    void notOnAClosedCase() {
        cases.lostCase(carolina, "H4PPY", "Toby", "dog", CaseFixtures.MEDELLIN, 300, "reunited", clock.instant().minusSeconds(86_400));
        ApiResponse r = api.post("/cases/{code}/sightings", """
                {"point":{"lat":6.25,"lng":-75.59},"seen_at":"%s","note":null,"contact_phone":null}""".formatted(clock.instant()), "H4PPY");
        assertThat(r.errorCode()).isEqualTo("invalid_transition");
    }

    @Test
    void asksForTheSmsCodeFirstThenPublishesIntoTheFeed() {
        ApiClient ana = clients.newBrowser();
        accounts.signIn(ana, "ana.gomez@correo.co");
        assertThat(ana.post("/lost-cases", PublishBodies.kira("+573007152284", null)).str("/phone_step")).isEqualTo("otp");
        String wrong = sms.lastCodeFor("+573007152284").equals("000000") ? "111111" : "000000";
        assertThat(ana.post("/lost-cases", PublishBodies.kira("+573007152284", wrong)).errorCode()).isEqualTo("invalid_code");
        String code = ana.post("/lost-cases", PublishBodies.kira("+573007152284", sms.lastCodeFor("+573007152284"))).str("/code");
        ApiResponse feed = api.get("/feed");
        assertThat(feed.str("/items/0/code")).isEqualTo(code);
        assertThat(feed.str("/items/0/title")).isEqualTo("Kira");
        assertThat(feed.str("/items/0/place_name")).isEqualTo("Zona marcada en el mapa");
    }

    @Autowired org.jooq.DSLContext db;

    /** A session for an existing person (the parity tests seed Luna's owner before signing in). */
    private String sessionFor(UUID person) {
        String token = co.scuby.platform.crypto.Hashing.randomToken(32);
        db.execute("INSERT INTO scuby.session (token_hash, person_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                co.scuby.platform.crypto.Hashing.sha256Hex(token), person,
                clock.instant().atOffset(java.time.ZoneOffset.UTC), clock.instant().atOffset(java.time.ZoneOffset.UTC).plusMonths(12));
        return token;
    }
}
```

- [ ] **Step 2: Run**

Run: `[mvn] -q test -Dtest=LostParityTest`
Expected: PASS (14 tests). A failure here is a behaviour mismatch between the backend and the mock that this plan did not decide: fix the backend if the product docs or the design agree with the mock; otherwise record it in the report as a question and mark that test `@Disabled("<reason, link to report>")` — never change an assertion to match the backend silently.

- [ ] **Step 3: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add backend/src/test/java/co/scuby/cases/LostParityTest.java
git commit -m "test: port the client mock's lost-case, feed, sighting and publish scenarios, with the design's overrides named"
```

---

### Task 9: Spike — place names on Colombian points (report only)

Before `reverse_geocoding` is ever turned on, compare three ways to name the **barrio** of a point (`docs/product/10-sharing.md`: previews and posters show the barrio). No provider is wired into the backend in this task; the output is a committed report the humans decide from.

**Files:**
- Create: `W/docs/superpowers/specs/2026-10-30-place-names-spike.md` (the report, committed)
- Create (scratch, not committed): `/private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/place-names/` — scripts, downloaded data (each download in its own new directory; run Python with `-I`), raw answers

**Interfaces:** none (no code in the repo).

**The points** (use exactly these; add the answer a local would give where you can verify it from an official map, else leave "expected" blank):

| # | Point | lat, lng | Why |
|---|---|---|---|
| 1 | Laureles (Medellín) | 6.2447, -75.5916 | the mock's publish point |
| 2 | Belén, near the Laureles edge | 6.2310, -75.5990 | boundary between two barrios |
| 3 | El Poblado, Parque Lleras | 6.2087, -75.5677 | dense, well mapped |
| 4 | Envigado center | 6.1716, -75.5862 | different municipality, same metro |
| 5 | Bello center | 6.3373, -75.5579 | metro edge |
| 6 | Chapinero (Bogotá) | 4.6486, -74.0628 | Bogotá localidad vs barrio |
| 7 | Usaquén (Bogotá) | 4.6946, -74.0307 | Bogotá north |
| 8 | Kennedy (Bogotá) | 4.6283, -74.1532 | dense residential |
| 9 | San Antonio (Cali) | 3.4475, -76.5390 | third city |
| 10 | El Prado (Barranquilla) | 10.9990, -74.8040 | Caribbean coast |
| 11 | Getsemaní (Cartagena) | 10.4221, -75.5465 | tourist barrio |
| 12 | Jardín (Antioquia) | 5.5986, -75.8197 | small municipality |
| 13 | Villa de Leyva | 5.6333, -73.5254 | small municipality |
| 14 | Rural vereda near Guarne | 6.2800, -75.4400 | rural point: vereda, not barrio |
| 15 | Highway between Medellín and Santa Fe de Antioquia | 6.4500, -75.7500 | nothing nearby |

- [ ] **Step 1: Nominatim (OpenStreetMap)**

Write `/private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/place-names/nominatim.py`: for each point, `GET https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=…&lon=…&zoom=16&addressdetails=1&accept-language=es` with header `User-Agent: scuby-place-names-spike/2026-10-30 (+https://github.com/scubyDevTeam/scuby)`, **one request per second** (`time.sleep(1.1)` — the public usage policy), save each raw JSON, and extract `address.neighbourhood`, `address.suburb`, `address.quarter`, `address.city_district`, `address.city`/`town`/`village`. Run: `python3 -I …/nominatim.py`. Note which field holds the barrio for each city.

- [ ] **Step 2: PostGIS with open barrio polygons**

Find official open polygon layers (search the cities' open-data portals; record the exact dataset name, URL, licence and date): Medellín «Límite Barrio Vereda Catastro» (GeoMedellín / MEData), Bogotá barrios or sectors catastrales (Datos Abiertos Bogotá / IDECA), Cali and Barranquilla if available; for municipalities without a layer, OSM administrative boundaries via Overpass (`admin_level` 8–10) are the fallback — record which. Download each into its own new directory under the scratch folder, load into a throwaway PostGIS container (`docker run --rm -d --name scuby-spike-pg -e POSTGRES_PASSWORD=spike -p 127.0.0.1:55432:5432 scuby/postgres:17`, then `ogr2ogr` if installed, else `shp2pgsql`/GeoJSON via `psql` from the container), and answer each point with `SELECT name FROM barrios WHERE ST_Covers(geom, ST_SetSRID(ST_MakePoint(lng, lat), 4326))` (+ the nearest polygon within 500 m when none covers it). Stop and remove the container afterwards (`docker rm -f scuby-spike-pg`). Never use the compose database or the test containers.

- [ ] **Step 3: Amazon Location Service (only if already possible without creating anything)**

Run `aws sts get-caller-identity`. Only if it succeeds **and** `aws geo-places reverse-geocode --query-position <lng> <lat> --language es` works without creating any AWS resource, run it for the 15 points and save the raw answers. Do **not** create place indexes, API keys or any resource; do not change AWS configuration. Otherwise write "not measured (no credentials in this environment)" and record the current public price for stored results (design: ≈ $4 per 1,000) with the pricing page URL and date.

- [ ] **Step 4: Write the report**

`W/docs/superpowers/specs/2026-10-30-place-names-spike.md` — self-contained (a reader without this plan understands it):

```markdown
# Place names spike — reverse geocoding for Colombian points

> 2026-10-30. Input to turning on the `reverse_geocoding` flag (docs/eng/feature-flags.md · Registry).
> The backend stores one place name per case at publish (`PlaceNamer`); previews and posters show
> the barrio (docs/product/10-sharing.md). No provider is wired yet.

## Question
Which source names the barrio of a point best, at what cost and with what licence/attribution duty?

## Points and answers
| # | Point | Expected | Nominatim | PostGIS + open polygons | Amazon Location |
|---|---|---|---|---|---|
(one row per point, the barrio each source returned, "—" for nothing)

## Per source
For each: coverage (how many of 15 named a barrio/vereda correctly), failure modes (localidad
instead of barrio, wrong side of a boundary, empty in rural points), latency, cost at 1,000 and
10,000 publishes/month, licence and attribution (ODbL for OSM data; each city portal's licence;
Amazon's terms for **storing** results), operational cost (a dataset to refresh, an API to call).

## Recommendation
One paragraph: which to wire first and why, what to do where it has no answer (keep the generic
label), and what would change the decision. Decision to be taken by the team; record it in the
decision log when made.

## Raw data
Where the raw answers are summarised from (dataset names, URLs, dates). Raw files are not committed.
```

- [ ] **Step 5: Commit the report only**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add docs/superpowers/specs/2026-10-30-place-names-spike.md
git commit -m "doc: place-names spike — Nominatim vs open barrio polygons vs Amazon Location on 15 Colombian points"
```

---

### Task 10: Acceptance — the client's e2e specs against the local backend

The design's "done when": the client, built with `VITE_API_MOCK=false` against a backend running these endpoints, passes its **sign-in** (`web/e2e/auth.spec.ts`), **publish-lost** (`web/e2e/publish-lost.spec.ts`) and **lost-case** (`web/e2e/lost-case.spec.ts`) specs. Run them against the backend from A1's `run-local.sh` (Docker, `http://localhost:8080`), with the database seeded with the fixtures those specs open, fix every **backend-side** mismatch, and record every mismatch that is **contract-side or outside the slice**. `web/` is never edited; its Playwright config is overridden from the scratch folder.

**Known before running** (from reading the specs; verify, do not assume): `@AUTH-002`, `@PLOST-002` and `@PLOST-004` sign in with Google — the e2e run has no Google credential, so they cannot pass; `@AUTH-001`'s profile page reads `GET /me/profile`, and `@PLOST-001` opens «Mis casos» (`GET /me/cases`) — neither is in this slice's 13 endpoints; `@LINK-001` expects «Posible hallazgo», which needs an open claim (claims are not in the slice); `@PLOST-002`/`@PLOST-004` also need `/me/pets`, reopen and edit. Record each as "outside the slice" with the endpoint it needs. Everything else must pass or be explained.

**Files:**
- Create: `B/e2e/seed.sql` — the fixtures the specs open (committed)
- Create: `B/e2e/compose.e2e.yaml` — compose override with the e2e test bypass (committed)
- Create: `B/e2e/run-client-e2e.sh` — one command for the whole run (committed)
- Create (scratch, not committed): `/private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/a2-e2e/playwright.real.config.ts`
- Modify: backend files as the fixes require (each fix with its own test first — TDD as in earlier tasks)

**Interfaces:**
- Consumes: A1 `backend/run-local.sh`, `backend/compose.yaml` (service `backend`, profile `app`), profile `local`; every endpoint of this plan.
- Produces: `bash backend/e2e/run-client-e2e.sh` → seeds, starts, runs the three specs, prints Playwright's summary; the report section "Acceptance" (per test: pass / fail-fixed / fail-recorded with reason).

- [ ] **Step 1: Seed data the specs open**

The specs open `7K3PQ` (Luna, active, 3 visible sightings, the newest «hace 2 h», WhatsApp reachable), `H4PPY` (Toby, reunited), `GONE5` (purged) — `web/src/mocks/fixtures.ts` holds the mock's values; copy names and texts from there. `B/e2e/seed.sql`:

```sql
-- Fixtures for running the web client's e2e specs against a local backend (backend/e2e/run-client-e2e.sh).
-- Mirrors what web/e2e/lost-case.spec.ts opens from web/src/mocks/fixtures.ts. Times are relative to now()
-- (operator data: allowed here). Wipes the cases data of the local database first.
TRUNCATE scuby.sighting, scuby.lost_case, scuby.purged_case_code, scuby.responsibility_link, scuby.pet,
         scuby.upload, scuby.session, scuby.phone_otp, scuby.sms_send, scuby.email_code, scuby.person CASCADE;

INSERT INTO scuby.person (id, display_name, email, phone, phone_verified_at, created_at) VALUES
  ('00000000-0000-0000-0000-00000000ca01', 'Carolina Mejía', 'carolina@correo.co', '+573114829017', now(), now() - interval '30 days');

INSERT INTO scuby.pet (id, name, species, size, colors, marks, photo_urls, custody_state, created_at) VALUES
  ('00000000-0000-0000-0000-00000000be01', 'Luna', 'dog', 'small', '{black,tan}', 'Collar rojo', '{}', 'claimed', now() - interval '3 days'),
  ('00000000-0000-0000-0000-00000000be02', 'Toby', 'dog', 'medium', '{brown}', NULL, '{}', 'claimed', now() - interval '20 days');

INSERT INTO scuby.responsibility_link (id, person_id, pet_id, role, active_from) VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000be01', 'owner', now() - interval '3 days'),
  (gen_random_uuid(), '00000000-0000-0000-0000-00000000ca01', '00000000-0000-0000-0000-00000000be02', 'owner', now() - interval '20 days');

INSERT INTO scuby.lost_case (code, pet_id, created_by, status, published_at, resolved_at, contact_phone, phone_has_whatsapp,
  expose_whatsapp, expose_email, in_app_only, last_seen_lat, last_seen_lng, last_seen_radius_m, last_seen_at, place_name) VALUES
  ('7K3PQ', '00000000-0000-0000-0000-00000000be01', '00000000-0000-0000-0000-00000000ca01', 'active', now() - interval '2 days', NULL,
   '+573114829017', true, true, false, false, 6.2442, -75.5812, 100, now() - interval '2 days', NULL),
  ('H4PPY', '00000000-0000-0000-0000-00000000be02', '00000000-0000-0000-0000-00000000ca01', 'reunited', now() - interval '20 days', now() - interval '15 days',
   '+573114829017', true, true, false, false, 6.2500, -75.5900, 300, now() - interval '20 days', NULL);

INSERT INTO scuby.sighting (id, case_code, lat, lng, seen_at, created_at, note, reporter_device_hash, reporter_ip_hash, status) VALUES
  (gen_random_uuid(), '7K3PQ', 6.2460, -75.5830, now() - interval '30 hours', now() - interval '30 hours', NULL, repeat('a', 64), repeat('f', 64), 'visible'),
  (gen_random_uuid(), '7K3PQ', 6.2475, -75.5850, now() - interval '9 hours',  now() - interval '9 hours',  NULL, repeat('b', 64), repeat('f', 64), 'visible'),
  (gen_random_uuid(), '7K3PQ', 6.2490, -75.5870, now() - interval '2 hours',  now() - interval '2 hours',  NULL, repeat('c', 64), repeat('f', 64), 'visible');

INSERT INTO scuby.purged_case_code (code, purged_at) VALUES ('GONE5', now() - interval '40 days');
```

(Check `web/src/mocks/fixtures.ts` lines ~229–243 for Luna and the reunited Toby; adjust names, marks and points to the mock's values if they differ, so on-screen texts the specs assert — «Luna», «¡Toby ya está en casa!» — match.)

- [ ] **Step 2: The e2e override and the run script**

`B/e2e/compose.e2e.yaml`:

```yaml
# Compose override for running the web client's e2e specs against the local backend.
# The specs sign in as *@correo.co with code 123456 and verify +57 300 715 2284 with 123456
# (web/e2e/pages/parts.ts DEMO_CODE), so the test bypass covers exactly those for this run.
services:
  backend:
    environment:
      SCUBY_AUTH_TESTBYPASS_EMAILDOMAINS: correo.co,e2e.scuby.test
      SCUBY_AUTH_TESTBYPASS_SMSPREFIXES: "+573007152284,+5730000000"
```

`B/e2e/run-client-e2e.sh`:

```bash
#!/usr/bin/env bash
# Runs web/e2e's sign-in, publish-lost and lost-case specs against the backend running locally in Docker.
# Usage: bash backend/e2e/run-client-e2e.sh <playwright config override path>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
backend="$(dirname "$here")"
web="$(dirname "$backend")/web"
config="${1:?path to the Playwright config override}"

cd "$backend"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home}"
export PATH="$JAVA_HOME/bin:$PATH"
./mvnw -q -DskipTests package jib:dockerBuild -Djib.from.platforms=linux/arm64
docker compose -f compose.yaml -f e2e/compose.e2e.yaml --profile app up -d --wait
for _ in $(seq 1 90); do curl -sf http://localhost:8080/actuator/health >/dev/null && break; sleep 1; done
docker compose -f compose.yaml exec -T postgres psql -v ON_ERROR_STOP=1 -U scuby -d scuby < e2e/seed.sql

cd "$web"
pnpm install --frozen-lockfile
pnpm exec playwright test --config "$config" --workers=1 --grep "@auth|@publish-lost|@case-link"
```

`/private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/a2-e2e/playwright.real.config.ts` (imports the client's config by absolute path; changes only where the app points and the output folder):

```ts
import base from '/Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice/web/playwright.config.ts'

const web = '/Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice/web'
const server = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer

export default {
  ...base,
  testDir: `${web}/e2e`,
  outputDir: '/private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/a2-e2e/results',
  fullyParallel: false,
  workers: 1,
  webServer: {
    ...server,
    cwd: web,
    env: { ...server?.env, VITE_API_MOCK: 'false', VITE_API_URL: 'http://localhost:8080' },
  },
}
```

- [ ] **Step 3: Run**

Run: `bash /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice/backend/e2e/run-client-e2e.sh /private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/a2-e2e/playwright.real.config.ts 2>&1 | tee /private/tmp/claude-501/-Users-alejandrosuazabuiles-Desktop-scuby/4a32cac8-27dd-4e61-9ffc-3e46a06d97b9/scratchpad/a2-e2e/run-1.log`
Expected: Playwright's list reporter output and a summary `N passed, M failed`. The browser console and network failures are in the trace under `…/a2-e2e/results`; the backend log is `docker compose -f …/backend/compose.yaml logs backend`.

- [ ] **Step 4: Triage every failure**

For each failing test, open its trace/screenshot and the backend log, and classify:

1. **Backend bug** (the backend answered something the contract or the design does not allow, or a CORS/cookie/Origin problem): write a failing backend test reproducing it, fix, commit (`fix: …`), rebuild and re-run Step 3.
2. **Outside the slice** (the client called an endpoint not in the 13 — `GET /me/profile`, `GET /me/cases`, `GET /me/pets`, reopen, edit, Google sign-in without a credential, claims): record test key, the call, and what the slice would need.
3. **Contract-side** (the backend follows the contract/design and the client expects something else — e.g. a field the mock invented, a behaviour the design overrode): record it as a proposal to the client side with the evidence.

Repeat until every failure is class 2 or 3. Stuck rule applies per failure.

- [ ] **Step 5: Stop the stack**

Run: `docker compose -f /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice/backend/compose.yaml --profile app down`
Expected: containers removed.

- [ ] **Step 6: Commit the e2e harness**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add backend/e2e
git commit -m "test: run the client's sign-in, publish-lost and lost-case e2e specs against the local backend"
```

Write the report section "Acceptance": a table of every test in the three specs (`@AUTH-001`, `@AUTH-002`, `@PLOST-001`…`@PLOST-004`, `@LINK-001`…`@LINK-004`) with result and class, the fixes committed (SHAs), and the proposals.

---

### Task 11: Owning docs, proposals to the client side, final verification

**Files:**
- Modify: `W/docs/eng/backend.md`, `W/docs/eng/api.md`, `W/docs/product/04-lost-workflow.md`, `W/docs/product/00-product-map.md`, `B/CLAUDE.md`, `B/README.md`

- [ ] **Step 1: `docs/eng/backend.md`** — after the section `## Sessions` (added by A1), add:

```markdown
## Uploads and media

`POST /uploads` records who took a slot for which photo and purpose (account when signed in, else
device) and answers where to PUT the bytes. A publish or sighting attaches only photos its caller
took a slot for, for that purpose, within 24 h, and whose bytes are processed. Bytes go through a
`MediaStore`: **S3** in staging and production (a presigned PUT into `incoming/` signed with the
photo's SHA-256; "processed" = the ingest Lambda wrote `media/{sha}.jpg` — [infra.md](infra.md) ·
Media), a **development directory** in `local` and `test` (a dev-only `PUT/GET /dev-media/{sha}.jpg`
that checks the hash and counts as processed at once; refused under `prod`). At most 20 slots per
caller per 10 minutes.

## Place names

`place_name` is computed once at publish by a `PlaceNamer` and stored on the case. Behind the flag
`reverse_geocoding` (off): while off, or when the namer has no answer, nothing is stored and the
response carries a generic label in the request's language («Zona marcada en el mapa»). No provider
is wired yet; the comparison is in `docs/superpowers/specs/2026-10-30-place-names-spike.md`.

## Rate limits on rows

«Lo vi»: per reporter (account when signed in, else device) 5 per case and 20 overall per rolling
24 h ([04](../product/04-lost-workflow.md) · Validation); the IP (HMAC) is a second key with 20 per
case and 80 overall. SMS: [auth.md](auth.md) · OTP mechanics. Upload slots: above. Each count is one
indexed query over the rows the action writes anyway.
```

- [ ] **Step 2: `docs/product/04-lost-workflow.md`** — in `#### Validation`: change the `seen_at` in the future row's Bound from `reject` to `reject beyond 5 minutes (device clock drift)`; add a row after "Rate, per reporter global":

```markdown
| Rate, per IP (second key) | 20 per case, 80 per day | BE only | same |
```

- [ ] **Step 3: `docs/eng/api.md`** — (a) in `### Gaps found by the backend review (2026-10-23)`, replace the bullet `- **Feed order.** …` with:

```markdown
- **Feed order** — settled by the backend's thin slice (2026-10-29): nearest first by distance band
  (≤ 2, 5, 10, 25 km), newest first within a band; national, newest first, when nothing is near or no
  point is sent; at most 100 items. The contract's wording is to follow (below).
```

(b) After that section add:

```markdown
### Proposals from the backend thin slice (2026-10-29)

Contract or client changes the backend needs; each is made on the client side, which owns the pen
until the contract moves to `openapi.yaml` (decision #34).

- **Feed paging** — the feed is capped at 100 items with no way to ask for more.
- **`phone_step: unverified`** on publish responses ([O24](../open-items.md)) — with
  `publisher_phone_otp` off the backend publishes and the client cannot tell the number is unverified.
- **`GET /feed` query parameters** (`vertical`, `species`, `lat`, `lng`) are missing from
  `openapi.json` (`parameters: []`) although `web/src/contracts/feed.ts` defines them.
- **`seen_at` tolerance** — the server accepts up to 5 minutes in the future (device clock drift);
  the client's own check rejects any future time.
- **Nearest-first wording** — the contract's summary says "newest first"; `feed.ts` and
  [02](../product/02-flows.md) say proximity; align them on the rule above.
```

Then append one bullet per contract-side finding of Task 10 (test key, what the client expects, what the contract/design says), and one bullet listing the endpoints the e2e specs need beyond this slice (from Task 10's "outside the slice" rows).

- [ ] **Step 4: Decision #41 in `docs/product/00-product-map.md`** (append after #40):

```markdown
| 41 | Feed order and the public location floor *(2026-10-29)* | **The feed is nearest first** — distance bands ≤ 2, 5, 10, 25 km around the viewer's point, newest first within a band — **with a national fallback**, newest first, when nothing is near or no point is sent; at most 100 items until the contract pages. **The server applies the 200 m public floor** to a lost case's radius for everyone but its owner (the center is never moved) — [eng/api.md](../eng/api.md) · Gaps, [04](04-lost-workflow.md) · Location precision | Newest first only (the contract's summary and the client mock: a fresh case 20 km away outranks one around the corner, against [02](02-flows.md)'s "proximity + recency"); a single 25 km circle without bands (a case 24 km away ties with one next door); the floor only in the client (any other client — a script, a future app — would get the exact radius) |
```

- [ ] **Step 5: `backend/CLAUDE.md` and `backend/README.md`**

In `B/CLAUDE.md` · Package rules, after the first bullet add: `Foundations today: identity (accounts, sessions, phone), uploads (slots, media store), pets (pet + responsibility). Vertical: cases (lost cases, sightings, feed).` In `B/README.md` · Estructura, add lines:

```
├── uploads/     ranuras de subida, almacén de fotos (S3 en staging; carpeta de desarrollo en local/test)
├── pets/        la mascota y quién responde por ella
└── cases/       casos perdidos, avistamientos («Lo vi») y el feed
backend/e2e/     correr las pruebas e2e del cliente contra el backend local (run-client-e2e.sh)
```

- [ ] **Step 6: Final verification**

Run: `[mvn] verify`
Expected: `BUILD SUCCESS`; all tests green; PIT ≥ 80 % across `PhoneStepDerivation`, `LostCaseDerivation`, `PublicTextDerivation`, `FeedDerivation`, `SightingRulesDerivation` (record each class's score).

Run: `git -C /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice log --oneline origin/main..HEAD`
Expected: A1's and A2's commits, no merge commits, nothing pushed.

- [ ] **Step 7: Commit**

```bash
cd /Users/alejandrosuazabuiles/Desktop/scuby-monorepo/.worktrees/be-thin-slice
git add docs/eng/backend.md docs/eng/api.md docs/product/04-lost-workflow.md docs/product/00-product-map.md backend/CLAUDE.md backend/README.md
git commit -m "doc: uploads, place names, rate limits; feed order decision #41; proposals to the client side"
```

- [ ] **Step 8: Finish the report**

Final section of the A2 report: commits; statement counts vs ceilings per endpoint; PIT scores; **Indexes for human approval** (expected: `responsibility_link_one_active_owner`, `lost_case_one_active_per_pet`, `sighting_replay_key`, `lost_case_active_point_idx`, `lost_case_active_published_idx`, `sighting_reporter_person_recent_idx`, `sighting_reporter_device_recent_idx`, `sighting_reporter_ip_recent_idx` — each with its plan before/after); the acceptance table; open questions (IP limit numbers; the vacuous 15-minute rule; the 24 h attach window; the staging media URLs and bucket from infra; anything else found). Do not commit the report.

---

## Self-review notes (for the plan's reader)

- Spec coverage (design → task): uploads with `MediaStore`, dev PUT, ownership + purpose + processed checks, slot limits (1, 2); pets foundation (3); `POST /lost-cases` one transaction, `active_case_exists`, phone step per design, codes per product/10 (4); `GET /cases/{code}` access → facts → derivation → record, 200 m floor, leak tests, `gone`/`not_found` (5); feed bands, national fallback, cap (6); sightings — validation, replay before limits, IP second key, `mine`/`editable_until` (5, 7); `PlaceNamer` + generic label (4, 5) and the spike (9); mock scenarios ported with overrides named (8, plus earlier tasks); acceptance (10); owning docs + proposals (11). Query/index policy: plan checks only on the named queries (feed, a case's sightings, rate-limit counts, active-case check, plus the upload-slot count as a rate-limit count); every index measured, commented and listed.
- Not in this plan: notifications, check-ins and outbox events (design: not in this slice — product risk noted there); claims; found/adoption/help; telemetry (branch `be/observability`); a real reverse-geocoding provider (after the spike); real email/SMS providers (O23).
- Handoff: when `infra/b1-sandbox` merges, staging needs `SCUBY_MEDIA_BUCKET`, `SCUBY_MEDIA_REGION`, `SCUBY_MEDIA_PUBLIC_BASE_URL` and the instance role's S3 permissions (PutObject on `incoming/*` via presign, HeadObject on `media/*`).
