# Lost Vertical L1 — Design

> Design for the second backend slice: everything an owner and a helper do with a published lost case
> after it exists: edit, close, reopen, moderate pins, correct or delete one's own pin, «Lo tengo» and
> its answer, the caller's pets and the profile update. 13 endpoints of the contract. Decided
> 2026-11-01. The durable parts land in their owning docs as part of the implementation (§8); this file
> records the whole design in one place for the plans that implement it. Question ids such as `Q-A4`
> refer to the question index in the appendix, which restates each question.

## 1. Scope

| Group | Endpoints (contract operation) |
|---|---|
| Owner, case | `PATCH /lost-cases/{code}` (`editLost`), `PATCH /cases/{code}` (`editCase`), `POST /cases/{code}/reunite` (`reuniteCase`), `POST /cases/{code}/cancel` (`cancelCase`), `POST /cases/{code}/reopen` (`reopenCase`) |
| Owner, sightings and claims | `PATCH /cases/{code}/sightings/{sightingId}` (`moderateSighting`), `POST /cases/{code}/claims/{claimId}` (`answerRecoveryClaim`) |
| Reporter | `POST /cases/{code}/sightings/{sightingId}/correction` (`correctSighting`), `DELETE /cases/{code}/sightings/{sightingId}` (`deleteSighting`) |
| Helper | `POST /cases/{code}/recovery-claims` (`claimRecovery`) |
| Me | `GET /me/pets` (`listMyPets`), `PATCH /me/profile` (`updateProfile`) |

Existing reads change to carry claims: `GET /cases/{code}` (`claims[]`, `open_claim_count`), `GET /feed`
(`possible_find`), `GET /me/cases` (`open_claim_count`).

**Out of scope, and where it goes:**

| Item | Goes to |
|---|---|
| `POST /reports` (`sendReport`): auto-hide, «en revisión», operator queue | A moderation iteration together with operator tooling (open item O20). New open item O37 (§8) |
| `POST /cases/{code}/shares` (`recordShare`) | L2, with the worker and the events table. New open item O38 |
| Notifications, check-ins, outbox events, Conversations threads | L2. **L1 writes no notification, no check-in and no outbox row**; L2 derives what it needs from rows (§9) |
| `found_deceased`, `gave_up`, `no_response` resolutions | L2 (`no_response`, written by expiry) and a client proposal (`found_deceased`, `gave_up`, new open item O35) |
| Found, adoption and help verticals | Their own slices. `PATCH /cases/{code}` and the non-lost part of reopen are thin routes that answer `not_found` |

**Done when:**

1. The 13 endpoints run and every integration-tested response validates against the regenerated
   `docs/eng/openapi.json`; `ContractCoverageTest`, ArchUnit and PIT (≥ 80 % on every new `*Derivation`)
   pass in `./mvnw verify`.
2. The contract change of §6 is merged: `pnpm openapi`, `pnpm test` and `pnpm typecheck` pass in `web/`.
3. `bash backend/e2e/run-client-e2e.sh` (with the seed additions of §7.6): `@LINK-001` passes;
   `@PLOST-002` and `@PLOST-004` fail only at their «Continuar con Google» step: run locally with that step
   replaced by an email-code sign-in as the demo owner (`carolina@correo.co`), every later step passes;
   every spec that passed in the thin-slice run still passes.

## 2. Data model changes

Nothing is deployed, but `main` is shared and other branches may already have run its migrations, so
**every change is a new timestamped migration**. No existing migration is edited. None depends on another
branch's migration (decision #44). Each starts with the comment the repo requires (what it is for, which
doc owns it).

| Migration | Change |
|---|---|
| `V20261101_1000__lost_case_resolution.sql` | `lost_case` gets `resolution` and `resolution_attribution`, plus the CHECKs below |
| `V20261101_1010__sighting_deleted_by_reporter.sql` | `sighting.status` accepts `deleted_by_reporter` |
| `V20261101_1020__recovery_claims.sql` | The `recovery_claim` table and its integrity index |
| `V20261101_1030__recovery_claim_by_case_index.sql` | Performance index on `recovery_claim` (written after its failing plan check) |
| `V20261101_1040__responsibility_link_by_person_index.sql` | Performance index on `responsibility_link` (written after its failing plan check) |
| `V20261101_1050__person_city_length.sql` | `person.city` gets a length CHECK |

### 2.1 `lost_case`

```sql
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

- L1 writes only `reunited_home`, `false_alarm` and `duplicate`. The L2 migration that brings `no_response`
  (expiry), and `found_deceased`/`gave_up` if the client takes that proposal, replaces
  `lost_case_resolution_fits_status`.
- `resolution` may be NULL on a closed row so rows written before this migration (seeds, tests) stay valid;
  every L1 close sets it.
- `resolved_at` is when the case left `active` (close or expiry). The reopen window is measured from it.

### 2.2 `sighting`

```sql
ALTER TABLE sighting DROP CONSTRAINT sighting_status_check,
  ADD CONSTRAINT sighting_status_check
      CHECK (status IN ('visible', 'hidden_by_owner', 'removed_by_moderation', 'deleted_by_reporter'));
```

`deleted_by_reporter` is invisible to everyone, the owner included: the owner's sightings query changes
from `status <> 'removed_by_moderation'` to `status IN ('visible', 'hidden_by_owner')` (literals). The row
stays, so `(case_code, client_id)` stays taken and `sighting_by_case_recent_idx` is unchanged.

### 2.3 `recovery_claim`

```sql
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
  answered_at         timestamptz,
  CHECK ((lat IS NULL) = (lng IS NULL)),
  CHECK ((status = 'open') = (answered_at IS NULL))
);

-- Integrity: one open claim per claimant per case; settles the double-tap race (INSERT … ON CONFLICT).
CREATE UNIQUE INDEX recovery_claim_one_open_per_claimant
  ON recovery_claim (case_code, claimant_person_id) WHERE status = 'open';
```

- Written only by `cases`. `TestDb.MUTABLE_TABLES` gets `recovery_claim`.
- Keyed by `case_code`, like `sighting` (the product doc's `case_id` is the code).
- The claimant is always a person (a session is required). There is no device column.
- `point` is the pair `lat`/`lng`, filled only from `from_sighting_id` (the request carries no point).
- No `note` column: the contract's claim request has no note, and a column nothing writes is not added (a later contract change adds it with its migration).
- `stale` is not a stored status. A claim is stale when `status = 'open'` and `created_at + 7 days` is in
  the past (§3, `ClaimDerivation`).
- The foreign keys have no `ON DELETE` action: the purge (L2) and account deletion (L2, decision #28)
  decide what happens to claims.

### 2.4 The two performance indexes

Each is written after a failing `PlanAssert` check and listed for human approval in the task report. Their
migration comments carry the three growth answers, the query, the plan before/after, the write cost and the
overlaps.

| Index | Growth reason | Query it serves | Overlap |
|---|---|---|---|
| `recovery_claim_by_case_recent_idx ON recovery_claim (case_code, created_at DESC)` | Unbounded: claims are never deleted and «Lo tengo» has no rate limit (decision #54's reasoning). The claim count and list run on every owner view of a case, on every «Mis casos» row, and on the owner's own feed items. Without it each runs a full scan of all claims | Owner's `claims[]` (newest 50 + the open count), `MyCasesQueries` and `FeedQueries` correlated counts | `recovery_claim_one_open_per_claimant` shares the `case_code` prefix but is partial (`open` only), so it serves neither the list nor the count of all statuses; it stays as the integrity UNIQUE |
| `responsibility_link_by_person_active_idx ON responsibility_link (person_id) WHERE active_to IS NULL` | The table grows with every pet. `GET /me/pets` runs on every publish pet picker and every «Mis mascotas» view. Without it each is a full scan of every link | `GET /me/pets` (`WHERE person_id = ? AND role = 'owner' AND active_to IS NULL`) | `responsibility_link_one_active_owner (pet_id)` leads with `pet_id`, so it cannot serve a lookup by person |

The predicate `active_to IS NULL` is written in jOOQ as `isNull()`, which renders as a literal predicate.

### 2.5 `person.city`

```sql
ALTER TABLE person ADD CONSTRAINT person_city_length CHECK (length(city) <= 80);
```

Nothing writes `city` before L1, so no row can violate it. The request check uses `@CodePoints(max = 80)`.

## 3. Shared rules

**Constants: one per rule, in the derivation that owns it.**

| Constant | Value | Home | Used by |
|---|---|---|---|
| `REOPEN_WINDOW` | 30 days, inclusive (`!now.isAfter(resolvedAt + 30 d)`; SQL `resolved_at >= :now − 30 d`) | `LostLifecycleDerivation` | reopen, claim reactivation, `/me/pets` |
| `EDIT_WINDOW` | 15 minutes, exclusive (`now.isBefore(createdAt + 15 min)`; SQL `created_at > :now − 15 min`) | `LostCaseDerivation` (exists) | `editable_until`, correction, delete |
| `STALE_AFTER` | 7 days; stale iff `createdAt + 7 d` is before `now` (SQL non-stale: `created_at >= :now − 7 d`) | `ClaimDerivation` | claim wire status, `open_claim_count`, `possible_find` |
| `PREFILL_WINDOW` | 24 hours, exclusive (SQL `created_at > :now − 24 h`) | `ClaimDerivation` | `from_sighting_id` eligibility |
| `MAX_CLAIMS_SHOWN` | 50 | `LostCaseQueries` | owner's `claims[]` |

The 5-minute future tolerance of an edit reuses `PublishLostService.CLOCK_DRIFT` (the publish rule).
`now` is read once per request from the `Clock` bean and passed to every statement as a bind value.

**Owner.** The owner of a lost case is `lost_case.created_by` (`CaseAccessPolicy`). A device never makes
anyone the owner.

**Error order of the owner endpoints:** session (`unauthorized`) → the case exists (`not_found`) → the caller
is its owner (`forbidden`) → the body (`validation_failed`) → the status (`invalid_transition`). Errors
Jackson raises while reading the body (malformed JSON, a wrong type, an absent `@JsonProperty(required =
true)` field) cannot wait and answer `validation_failed` before any lookup; they reveal nothing about the
case. Bean-validation and business rules on the body run after the owner check: controllers bind the record
without `@Valid` and the service validates it explicitly. A malformed code or id in the path is
`not_found` (as `CaseCodes.normalize` does today).

**Transitions are one conditional statement each**, no locks (decision #59). A pre-read classifies the
errors in order; the conditional statement repeats the guard so a concurrent change cannot slip between
them; zero rows after a passing pre-read is the race loser and answers the code the re-classification gives.

**PATCH semantics** (`editLost`, `updateProfile`): an absent field is unchanged, an explicit `null` clears
where the contract allows it, `{}` is a valid no-op. A generic `Patch<T>` in `platform.web` (absent, null,
value) is deserialized through Jackson's absent-value and null-value hooks, so records keep the three
states apart.

**The claim badge.** `open_claim_count` and `possible_find` count claims with `status = 'open'`, not stale,
on an **active** case, and are **owner-only**: a non-owner (anonymous, a signed-in stranger, the claimant
themselves) gets `null`. The owner of a closed case gets `0`/`false`. Private facts are not queried for a
non-owner. Reason: «a claim must never reduce reach» (04 · Rule: a recovery claim must never reduce reach);
a public «Posible hallazgo» tells helpers the search may be over.

## 4. Endpoints

Every statement below is jOOQ; status literals are `DSL.inline`. Ceilings are the worst path on a
session-cache miss, measured and pinned by the endpoint tests (lower them if measured lower).

### 4.1 `PATCH /lost-cases/{code}` — edit

- **Auth:** session; owner. Declared in `CasesSecurityRules`.
- **Validation** (after the owner check): `photo_urls` 1..6 non-empty strings; `marks` ≤ 500 code points or
  `null`; `last_seen_point` lat −90..90, lng −180..180; `last_seen_radius_m` > 0 and ≤ 5000; `last_seen_at`
  not after `now + 5 min` (`validation_failed {last_seen_at}`); no lower bound, and existing sightings are
  not revalidated. Photos: each URL already in `pet.photo_urls` is accepted as is; the others go through
  `PhotoAttachments.requireAttachable(newOnes, pet, caller, "photo_urls")` **before** the transaction.
- **Order:** session → `not_found` → `forbidden` → body → status `active` else `invalid_transition`. `{}`
  on an active case answers 204 with no write; on any other status `invalid_transition`. An open claim
  never blocks an edit.
- **Writes**, one `TransactionTemplate`:
  1. When `photo_urls` or `marks` is sent: `Pets.updateLook(petId, change)` (§5) — `UPDATE pet SET
     photo_urls = ?, marks = ? WHERE id = ?` with only the sent fields.
  2. Always last, as the guard: `UPDATE lost_case SET <sent fields> WHERE code = ? AND created_by = ? AND
     status = 'active' RETURNING code` (`SET status = status` when only pet fields were sent). When the point
     differs from the stored exact point: `last_seen_lat/lng` = the point, `last_seen_public_lat/lng` =
     `LocationPrecisionDerivation.publicCenter(point)` (decision #69) and `place_name = NULL` (the generic
     label). The place namer is never called (a network call). Zero rows → `invalid_transition`, which rolls
     back step 1.
  The case row is locked only by the last statement, right before commit.
- **Never re-broadcasts** (decision #27); writes no notification.
- **The pet is shared:** its photos and `marks` change on every case of that pet, past ones included.
- **Response:** 204. **Ceiling 5:** session, pre-read (case + pet photos), upload lookup, pet update, case
  update.
- **Resolves:** Q-C1, Q-C2, Q-C5, Q-C6, Q-C7, Q-C8, Q-C9, Q-E4, Q-A3.

### 4.2 `PATCH /cases/{code}` — edit a found, adoption or help case

- **Auth:** session (declared). The body is not bound (no schema to read it against yet).
- No table exists for those verticals and a lost code uses `editLost`, so every code answers `not_found`
  without a query. The route exists so the contract is complete.
- **Ceiling 1** (session). **Resolves:** Q-C3, Q-C4.

### 4.3 `POST /cases/{code}/reunite`

- **Auth:** session; owner. **Body:** `resolution_attribution` required, one of `platform_sighting |
  platform_claim | platform_share | offline | unknown`; not checked against evidence.
- **Order:** session → `not_found` → `forbidden` → body → `active` else `invalid_transition`.
- **Statement:** `UPDATE lost_case SET status = 'reunited', resolution = 'reunited_home',
  resolution_attribution = ?, resolved_at = :now WHERE code = ? AND created_by = ? AND status = 'active'
  RETURNING code`. Zero rows → `invalid_transition`.
- Claims are untouched (open ones stop counting because the case is not active). The pet and its
  responsibility link are untouched.
- **Response:** 200 `Created {id: <case code>}`. **Ceiling 3:** session, pre-read, update.
- **Resolves:** Q-A1, Q-A2, Q-A7, Q-A9.

### 4.4 `POST /cases/{code}/cancel`

- As reunite, with **body** `resolution` required, `false_alarm | duplicate`, and `SET status = 'cancelled',
  resolution = ?, resolved_at = :now`.
- A cancelled case is still served by `GET /cases/{code}` with `status: cancelled` and `contact: null` (the
  current derivation already nulls the contact off `active`); the feed shows only active cases; «Mis casos»
  lists it; `/me/pets` treats it as neither active nor reopenable.
- **Response:** 200 `Created {id: <case code>}`. **Ceiling 3.** **Resolves:** Q-A1, Q-A2, Q-A8.

### 4.5 `POST /cases/{code}/reopen`

- **Auth:** session; owner. **No body.**
- **Order:** session → `not_found` → `forbidden` → `invalid_transition` (status not `expired`, or
  `resolved_at` outside `REOPEN_WINDOW`) → `active_case_exists` (the pet has another active case;
  `details.case_code` = that case). A purged code is `not_found` (the contract lists no `gone` here).
- **Statement:** `UPDATE lost_case SET status = 'active', resolution = NULL, resolution_attribution = NULL,
  resolved_at = NULL WHERE code = ? AND created_by = ? AND status = 'expired' AND resolved_at >= :now − 30 d
  AND NOT EXISTS (SELECT 1 FROM lost_case other WHERE other.pet_id = lost_case.pet_id AND other.status =
  'active') RETURNING code`. A concurrent publish that wins the pet is settled by
  `lost_case_one_active_per_pet`: the unique violation is caught (constraint name checked) and answered as
  `active_case_exists` after reading the other code. Zero rows → re-classify (status/window →
  `invalid_transition`, else `active_case_exists`).
- **Keeps** the sightings, the claims (a stale one stays stale) and the original `published_at`; **never
  re-broadcasts** and notifies no one.
- **Response:** 200 `Created {id: <case code>}`. **Ceiling 4:** session, pre-read, update, active-code read.
- **Resolves:** Q-A4, Q-A5, Q-A6, Q-I7.

### 4.6 `PATCH /cases/{code}/sightings/{sightingId}` — owner moderation

- **Auth:** session; owner (declared per method: the same path's `DELETE` is public).
- **Body:** `highlighted?: boolean`, `hidden?: boolean`.
- **Order:** session → case `not_found` → `forbidden` → the sighting is on this case and is `visible` or
  `hidden_by_owner`, else `not_found` (`removed_by_moderation` and `deleted_by_reporter` are invisible to the
  owner) → body. No status check: allowed on closed cases too.
- **Statement:** `UPDATE sighting SET highlighted_by_owner = ?, status = ? WHERE id = ? AND case_code = ? AND
  status IN ('visible', 'hidden_by_owner') RETURNING id`, with only the sent fields (`hidden: true` →
  `hidden_by_owner`, `false` → `visible`). The flags are independent: a hidden pin can be highlighted.
  Repeating a value is idempotent (200). `{}` answers 200 with no write. Zero rows → `not_found`.
- Hiding removes the pin from public views; the owner still sees it, with `hidden: true` and its
  `contact_phone`. Telling the reporter about a highlight is L2.
- **Response:** 200 `Created {id: <sighting id>}`. **Ceiling 3:** session, pre-read (case + sighting),
  update.
- **Resolves:** Q-D3, Q-D4, Q-D8 (idempotence; the notification is L2), Q-D9.

### 4.7 `POST /cases/{code}/sightings/{sightingId}/correction` — reporter

- **Auth:** public (device cookie or session). Not declared as `session`.
- **"Mine"** (session wins, `api.md` · Device identity): with a session, `reporter_person_id = :me`; with no
  session, `reporter_device_hash = :device`. `LostCaseDerivation` changes from OR to this rule for `mine`
  and `editable_until`.
- **Order:** the sighting is on this case and not `removed_by_moderation`/`deleted_by_reporter`, else
  `not_found` → mine, `visible` and inside `EDIT_WINDOW`, else `forbidden` (a pin the owner hid is no longer
  correctable) → the case is `active`, else `invalid_transition` → body: field rules (`validation_failed`),
  then `SightingRulesDerivation.check` in its order (`seen_at_in_future`, `seen_at_before_case`,
  `sighting_too_far`), the distance measured from the **snapped** center (`SightingQueries.caseFor`,
  decision #69).
- **Body:** `point`, `seen_at`, `note` (≤ 500 or `null`), all three required.
- **Statement:** `UPDATE sighting SET lat = ?, lng = ?, seen_at = ?, note = ? WHERE id = ? AND case_code = ?
  AND status = 'visible' AND created_at > :now − 15 min AND <mine> AND EXISTS (SELECT 1 FROM lost_case
  WHERE code = ? AND status = 'active')`. Zero rows → re-read and re-classify. Photos and contact stay; the
  window does not move.
- **Response:** 204. **Ceiling 4:** session, pre-read (sighting + case + distance), update, re-read.
- **Resolves:** Q-D1, Q-D4, Q-D5, Q-D6, Q-D7, Q-D10, Q-I2.

### 4.8 `DELETE /cases/{code}/sightings/{sightingId}` — reporter

- **Auth:** public; "mine" as in §4.7.
- **Order:** `not_found` → `forbidden` (as §4.7). No case-status check: allowed on a closed case while
  inside the window (the contract lists no `invalid_transition`).
- **Statement:** `UPDATE sighting SET status = 'deleted_by_reporter' WHERE id = ? AND case_code = ? AND
  status = 'visible' AND created_at > :now − 15 min AND <mine>`. Never a hard delete; `client_id` stays
  taken, so a replayed «Lo vi» with it answers the deleted row's id. Zero rows → re-read and re-classify.
- **Response:** 204. **Ceiling 4.** **Resolves:** Q-D2, Q-D10.

### 4.9 `POST /cases/{code}/recovery-claims` — «Lo tengo»

- **Auth:** **session** (contract change, §6); the claimant is the session's person. The client can say it is
  for safety.
- **Order:** session → the code exists (`not_found`; a purged code → `gone`) → the caller is not the owner
  (`forbidden`) → body → status.
- **Body:**
  - `phone` required, E.164, `PhoneNumbers.requireMobile(phone, "phone")` (a supported-country mobile,
    `validation_failed {phone}`).
  - `photo_urls` ≤ 5, `requireAttachable(urls, claim, caller, "photo_urls")` before the transaction. Stored,
    not exposed.
  - `from_sighting_id` optional: must be a `visible` sighting on this case whose `reporter_person_id` is the
    caller **or** whose `reporter_device_hash` is the caller's device (the device clause applies to this
    link only), created inside `PREFILL_WINDOW`; else `validation_failed {from_sighting_id}`. Its point is
    copied into `lat`/`lng`; its photos are never copied.
- **Status:** `active` → insert. `expired` with `resolved_at` inside `REOPEN_WINDOW` → reactivate (decision
  #29) and insert, in one transaction. `expired` outside the window (not yet purged), `reunited` or
  `cancelled` → `invalid_transition`. The pet has another active case → `active_case_exists`
  (`details.case_code`).
- **Writes**, one `TransactionTemplate`:
  1. Only for an expired case: the reopen `UPDATE` of §4.5 without the `created_by` guard. Zero rows is not
     an error here (a concurrent claim may have reactivated it first); a unique violation is
     `active_case_exists`.
  2. `INSERT INTO recovery_claim (…) SELECT …, 'open', :now FROM lost_case WHERE code = ? AND status =
     'active' ON CONFLICT (case_code, claimant_person_id) WHERE status = 'open' DO NOTHING RETURNING id`.
  Empty → select the caller's open claim on the case (the dedupe: it is returned, 201, idempotent; an open
  claim includes a stale one); none → re-read the status and classify. The reactivation holds the case row
  only until the insert right after it commits.
- No rate limit (as #54). Writes no notification and no check-in.
- **Response:** 201 `Claim {id, whatsapp_url}`. `whatsapp_url` is set only when the public-contact rule holds
  (`expose_whatsapp AND phone_has_whatsapp AND contact_phone_verified AND NOT in_app_only`, case active),
  evaluated after any reactivation: a successful insert proves the case is active, and the contact flags
  come from the pre-read (no L1 endpoint changes them). The URL is
  `https://wa.me/<digits>?text=<URL-encoded text>` with «Hola, vi tu aviso de {nombre} en Scuby ({código}) y
  creo que lo tengo.» (copy review pending). Otherwise `null`. No `mailto:`.
- **Ceiling 9:** session, pre-read (case + pet name + contact flags), `supported_countries`, from-sighting
  read, upload lookup, reactivation, insert, dedupe select, status re-read.
- **Resolves:** Q-B1, Q-B2, Q-B3, Q-B4, Q-B5, Q-B6, Q-B7, Q-B8, Q-B10, Q-A4.

### 4.10 `POST /cases/{code}/claims/{claimId}` — the owner's answer

- **Auth:** session; owner. **Body:** `status` required, `confirmed | dismissed`.
- **Order:** session → case `not_found` → `forbidden` → the claim is on this case, else `not_found` → body.
  Allowed in every case status; a purged case has no row, so `not_found`.
- **Statement:** `UPDATE recovery_claim SET status = ?, answered_at = :now WHERE id = ? AND case_code = ? AND
  status <> ? RETURNING id`. `confirmed ↔ dismissed` may change at any time; a stale (stored `open`) claim
  can be confirmed or dismissed. Repeating the current answer is a no-op 200 (zero rows, no write).
- Confirming never closes the case (only reunite does) and leaves other claims untouched; several claims
  may be confirmed.
- **Response:** 200 `Created {id: <claim id>}`. **Ceiling 3:** session, pre-read (case + claim), update.
- **Resolves:** Q-A10 (the check-in path is L2), Q-A11, Q-A2.

### 4.11 `GET /me/pets`

- **Auth:** session (declared in `CasesSecurityRules`; `/me/**` is also covered by identity's rules).
- **One query**, `MyPetsQueries`:

  ```sql
  SELECT pet.id, pet.name, pet.species, pet.size, pet.colors, pet.marks, pet.photo_urls, pet.created_at,
         max(lc.code) FILTER (WHERE lc.status = 'active')                          AS active_case_code,
         (array_agg(lc.code ORDER BY lc.resolved_at DESC)
            FILTER (WHERE lc.status = 'expired' AND lc.resolved_at >= :now − 30 d))[1] AS latest_reopenable,
         max(greatest(lc.published_at, lc.resolved_at))                            AS last_activity
  FROM responsibility_link rl
  JOIN pet ON pet.id = rl.pet_id
  LEFT JOIN lost_case lc ON lc.pet_id = pet.id AND lc.created_by = :me
  WHERE rl.person_id = :me AND rl.role = 'owner' AND rl.active_to IS NULL
  GROUP BY pet.id
  ORDER BY last_activity DESC NULLS LAST, pet.created_at DESC, pet.id
  ```

- `MyPetsDerivation`: `reopenable_case_code` = `latest_reopenable` only when `active_case_code` is null.
  Nameless pets are included, with `name: ""` (as the case view does).
- **Response:** 200 `Pets`. **Ceiling 2:** session, the query. The test pins the count at 1 pet and at 20.
- Lives in `cases` (it reads `lost_case`). **Resolves:** Q-E1, Q-E2, Q-E3.

### 4.12 `PATCH /me/profile`

- **Auth:** session (identity's `/me/**` rule). Lives in `identity` beside `GET /me/profile`.
- PATCH semantics of §3. All rules run after the session check.
  - `display_name`: trimmed; empty → `validation_failed {display_name}`; 1..80 code points after trimming.
    Sending it, even unchanged, sets `display_name_chosen = true` (the public name stops being «Alguien»,
    decision #48). There is no way back to "not chosen".
  - `bio`: ≤ 280 code points, or `null`; no links: `ProfileTextDerivation.hasLink` refuses, case-insensitive,
    `http://`, `https://`, `www.`, `wa.me`, `tel:`, `mailto:` and any domain-shaped token (a word, a dot,
    two or more letters: `word.tld`) → `validation_failed {bio}`.
  - `city`: free text ≤ 80 code points (the new CHECK), or `null`.
  - `notification_prefs`: all four booleans together (the contract requires them); stored only.
  - `photo_url`: the current `person.photo_url` is accepted as is; another one must pass the photo check
    with purpose `profile` (below); `null` returns to the initials.
- **Statement:** `UPDATE person SET <sent fields> WHERE id = :me RETURNING *`.
- **Response:** 200 `Profile`, built by `ProfileView.of` exactly as `GET /me/profile` (the phone is the
  verified one). The name is read live, so a rename shows on all the person's cases. No cache holds the
  name (`ActiveSession` caches only the person id and expiry).
- **Ceiling 4:** session, person read (only when a non-null `photo_url` is sent), upload lookup, update.
- **Resolves:** Q-F1 to Q-F8.

### 4.13 Changes to existing reads

| Read | Change | Ceiling |
|---|---|---|
| `GET /cases/{code}` | Owner only, one more query: `SELECT id, phone, created_at, status, count(*) FILTER (WHERE status = 'open' AND created_at >= :now − 7 d) OVER () FROM recovery_claim WHERE case_code = ? ORDER BY created_at DESC, id DESC LIMIT 50`. `LostCaseFacts` gets `@Nullable ClaimFacts` (null for a non-owner: not queried). `LostCaseDerivation`: owner → `claims[]` with the wire status from `ClaimDerivation` (`stale` when due), `open_claim_count` = the count on an active case, else 0; non-owner → `claims: []`, `open_claim_count: null`. `LostCaseView.openClaimCount` becomes `@Nullable Integer`. Sightings query excludes `deleted_by_reporter` for the owner | 3 → **4** (owner: session, case, sightings, claims; a stranger 3, anonymous 2) |
| `GET /feed` | `possible_find`: for an item whose `created_by` is the caller, `EXISTS` an open non-stale claim (correlated subquery); for every other item, and for anonymous callers, an inline `NULL` | 3, unchanged |
| `GET /me/cases` | `open_claim_count`: correlated count of open non-stale claims when the case is active, else 0. Stays a non-null int (the list is the caller's own) | 2, unchanged |

## 5. Package placement and module boundaries

| Package | New or changed |
|---|---|
| `cases` | `EditLostController`/`EditLostService`, `EditCaseController` (thin), `CaseLifecycleController`/`CaseLifecycleService` (reunite, cancel, reopen), `SightingModerationController`, correction and delete on `SightingController`/`SightingService`, `RecoveryClaimController`/`RecoveryClaimService`/`RecoveryClaimQueries`, `MyPetsController`/`MyPetsQueries`; derivations `LostLifecycleDerivation`, `ClaimDerivation`, `LostEditDerivation`, `MyPetsDerivation`, and the `mine` rule in `LostCaseDerivation`; `CasesSecurityRules` entries |
| `pets` | `Pets.updateLook(UUID petId, LookChange change)`: `public`, on the `@ModuleApi` class, `@Transactional(propagation = MANDATORY)`; `LookChange(@Nullable List<String> photoUrls, Patch<String> marks)`. The caller has already authorized the write (the case's owner). `Pets` stays the only writer of `pet` |
| `identity` | `ProfileController` gets the PATCH; `People.updateProfile`; `ProfileTextDerivation` (trim, link rule) |
| `platform` | `Patch<T>` and its Jackson hooks (`platform.web`); interface `ProfilePhotos { void requireAttachable(String url, Caller caller, String field); }` (a new `platform.media` package) |
| `uploads` | `ProfilePhotoCheck implements ProfilePhotos`, delegating to `PhotoAttachments` with purpose `profile` (keeps `Propagation.NEVER`) |

- `cases` owns `recovery_claim` (its only writer). `/me/pets` lives in `cases` because it reads `lost_case`;
  reads may join `pet` and `responsibility_link`.
- `identity` cannot depend on `uploads` (foundations depend only on `platform`), so the profile photo check
  goes through the `platform` interface, as `RequestAuthenticator` already does for the session filter.
- `CasesSecurityRules` adds: `PATCH /lost-cases/*`, `PATCH /cases/*`, `POST /cases/*/reunite`, `POST
  /cases/*/cancel`, `POST /cases/*/reopen`, `PATCH /cases/*/sightings/*`, `POST /cases/*/recovery-claims`,
  `POST /cases/*/claims/*`, `GET /me/pets`. `POST …/correction` and `DELETE /cases/*/sightings/*` stay
  public. Each rule names its method.

## 6. The contract change

Made by the backend in `web/src/contracts`, then `pnpm openapi` regenerates `docs/eng/openapi.json`, and
`pnpm test` and `pnpm typecheck` must pass.

| Where | Change |
|---|---|
| `case.ts` `lostCaseWire` | `open_claim_count: z.nullable(z.int().check(z.nonnegative()))`, comment: "Only the owner receives it (null otherwise): a claim must never reduce reach (docs/product/04 · Rule: a recovery claim must never reduce reach)". `LostCase.openClaimCount: number \| null` |
| `feed.ts` `feedItemWire` | `possible_find: z.nullable(z.boolean())`, same comment. `FeedItem.possibleFind: boolean \| null` |
| `endpoints/helpers.ts` `claimRecovery` | `auth: 'session'`; errors `['not_found', 'forbidden', 'invalid_transition', 'active_case_exists', 'gone']`; summary says a session is required, the owner cannot claim their own case, and a repeated claim answers the open one |
| `endpoints/lost.ts` `reopenCase` | errors `[...OWNER_ONLY, 'active_case_exists']` |
| `domain/lost/actions.ts` | `hasPossibleFind(openClaimCount: number \| null)` → `(openClaimCount ?? 0) > 0` |
| `mocks/serialize.ts` | `lostView`: `open_claim_count` is `null` unless `owner`; for the owner, the open count on an active case, else 0. `feedItem` takes the viewer and sends `possible_find: null` unless the viewer published the item |
| `mocks/api/helpers.ts` | `claimRecovery`: `forbidden` for the case's owner, `gone` for a purged code, `active_case_exists` when the reactivation would make a second active case for the pet, the caller's open claim returned on a repeat. The session check comes from the route wrapper |
| `mocks/backend.test.ts` | The stranger expects `openClaimCount` `null`; the claim scenarios sign in first |
| `web/e2e/lost-case.spec.ts` `@LINK-001` | The stranger's step drops the «Posible hallazgo» assertion; a last step signs in as the case's owner by email code (`carolina@correo.co`) and asserts «Posible hallazgo» |

Only the badge change was a product decision; the `claimRecovery` and `reopenCase` rows make the contract
list the auth and the codes the decided behaviour answers (§4.5, §4.9). Without them `ApiClient` refuses the
responses and `ContractCoverageTest` fails. The reason is recorded in decision rows #75 and #76 (§8). The
other mock behaviour that differs (answers revisable, delete as a status, session-wins `mine`) is listed in
the handoff, not changed.

`found-case.ts`'s `open_claim_count` (ownership claims) and `MyCases.open_claim_count` are unchanged.

## 7. Testing

### 7.1 Leak tests

As an anonymous caller, a signed-in stranger and **the claimant**: `GET /cases/{code}` has `claims: []`,
`open_claim_count: null`, every `sightings[].contact_phone: null`, no hidden pin; `GET /feed` has
`possible_find: null` on every item. As the owner: the same case has the claims, the count and the
contacts, including a hidden pin's contact. A pin `deleted_by_reporter` appears for nobody.

### 7.2 Races

Requests started together with a barrier, or an uncommitted row held from another connection; invariants are
asserted, never lock order; never a `500`.

| Test | Invariant |
|---|---|
| Reunite, cancel and edit against a signed-in «Lo vi» | The close never waits for the sighting's uncommitted insert; a sighting committed before the close stays; one inserted after the close commits is `invalid_transition`; an edit and a sighting both commit |
| A claim against reactivation | Two claimants on one expired case: one reactivation, two claims, case `active`. A claim against a publish for the same pet: exactly one active case, the loser `active_case_exists`. A claim against reopen: case `active`, claim stored, reopen 200 or `invalid_transition` |
| The same person claims twice at once | One row, both answers carry its id |
| A correction at the window edge | At `created_at + 15 min − 1 ms` 204; at `created_at + 15 min` `forbidden` (`MutableClock`); the same for delete |

### 7.3 Statement ceilings

One line per endpoint in `StatementCeilings` with the numbers of §4; `GET /cases/{code}` goes from 3 to 4
(the owner's claims query, the reason in the task report). Seeded rows prove each ceiling does not grow:
several claims and sightings on a case, 1 and 20 pets for `/me/pets`.

### 7.4 Derivations (table-tested, PIT ≥ 80 %)

| Derivation | Table |
|---|---|
| `LostLifecycleDerivation` | (action reunite/cancel/reopen/claim-reactivate × status × `resolved_at` at 29 d, exactly 30 d, 30 d + 1 ms) → allowed or `invalid_transition` |
| `ClaimDerivation` | Wire status (open at 7 d exactly, stale at 7 d + 1 ms; confirmed and dismissed never stale); badge (owner/non-owner × active/closed × counts); answer outcome (same answer → no change, `confirmed ↔ dismissed`, from open); `from_sighting` eligibility (person, device, other's, not visible, 24 h edge); WhatsApp URL and text (each flag of the contact rule) |
| `LostCaseDerivation` | `mine` and `editable_until`: session matches, session with a matching device only (not mine), no session with a matching device (mine) |
| `LostEditDerivation` | Which columns a body writes; point changed or equal; `last_seen_at` at now + 5 min and + 5 min 1 ms |
| `MyPetsDerivation` | Active hides reopenable; reopenable alone; neither |
| `ProfileTextDerivation` | Trim and empty name; each link pattern; text that is not a link («Hola. Soy», «3.5 kg») |

### 7.5 Error order

A `…PrecedenceTest` per endpoint (like `SightingPrecedenceTest`) sends requests failing two rules at once
and pins the first code of §3 and §4.

### 7.6 End to end

`backend/e2e/seed.sql` adds (and truncates `recovery_claim`): the pet Pelusa with an owner link to
`carolina@correo.co`; an expired lost case `PEL4S` for it, `resolved_at = now() − 3 days`, resolution NULL;
an open claim on `7K3PQ` by Andrés Rojas, phone `+573114829017`, created 3 hours ago. Expected to start
passing: `@LINK-001`, and `@PLOST-002`/`@PLOST-004` apart from their Google step (§1).

## 8. Docs to update (with the implementation)

**Decision log** (`product/00`), dated 2026-11-01, each with its rejected alternatives:

| # | Decision | Rejected |
|---|---|---|
| 71 | Lost-case owner actions: the owner is `created_by`; reunite/cancel/reopen are one conditional `UPDATE` each; reopen within 30 days of `resolved_at` inclusive, keeps sightings and `published_at`, never re-broadcasts; reopen and claim reactivation answer `active_case_exists` when the pet has another active case; a cancelled case is still served, without contact | The responsibility link as the check; refreshing `published_at` on reopen; letting a reopen create a second active case |
| 72 | Editing a lost case writes the shared pet through `Pets`; a moved point re-snaps the public center and resets the place name to the generic label; existing sightings are not revalidated; an open claim never blocks an edit | Calling the place namer in the edit; copying pet fields onto the case; revalidating sightings |
| 73 | A reporter's pin: "mine" is the person when signed in, else the device; delete is the status `deleted_by_reporter`, never a hard delete, and the `client_id` stays taken | Person-or-device for `mine`; a hard delete (frees the replay key, breaks `sightings_count` and a claim's `from_sighting_id`) |
| 74 | Owner moderation: hide and highlight are idempotent, independent and allowed in any case status; a moderated pin is `not_found` to the owner | Unhiding a moderated pin |
| 75 | «Lo tengo» needs a session; one open claim per person per case (a repeat answers it); the owner cannot claim; no rate limit; evidence stored, not shown; WhatsApp link with prefilled text under the public-contact rule; purged code `gone` | Anonymous claims; a rate limit now; copying the sighting's photos |
| 76 | `open_claim_count`/`possible_find` are owner-only and count open, non-stale claims on active cases; stale is derived (open and 7 days old) | A public badge (it reduces reach); denormalizing the count; a stored `stale` status |
| 77 | The owner's answer is revisable (`confirmed ↔ dismissed`), idempotent, in any case status, and never closes the case | One-shot answers; dismissing the other claims on confirm |
| 78 | `/me/pets`: active owner links, nameless pets included, one query, reopenable only without an active case | A query per pet; listing every expired case |
| 79 | Profile update: sending a name marks it chosen; the bio refuses links and domain-shaped tokens; `city` is free text ≤ 80 until a cities table exists | Three link patterns only; a cities table now |

**Owning docs:**

- `product/04`: `lost_case` resolution values written in L1; `sighting` status `deleted_by_reporter` and the
  "mine" rule (Correction window); `recovery_claim` (session, claimant a person, evidence stored, prefill
  rule with the device clause, stale derived); identity ladder (the anonymous «Lo tengo» row now asks to sign
  in); editing (the pet is shared, so the change shows on old cases); the owner-only badge. Patch 01 and 02
  where they describe an anonymous claimant, in the same change.
- `eng/api.md`: Device identity (session wins also for correction and delete; the claimant is a person);
  Errors (`active_case_exists` on reopen and claims, `gone` on claims); `Created.id` of case actions is the
  case code; remove the «Posible hallazgo» gap.
- `eng/auth.md` · Profile: the chosen-name rule, the exact bio rule, `city` (link O34).
- `eng/backend.md`: Concurrency (one open claim per claimant, reactivation then insert, transitions);
  kept performance indexes (the two new ones); Code structure (`ProfilePhotos`, `Patch<T>`); Testing (the
  race tests).

**Open items** (`open-items.md`, Open), O34–O38:

| # | Item |
|---|---|
| O34 | Cities and departments: a table per country tied to `supported_countries`, an autocomplete endpoint, and the contract change of `city` to an id. Its only consumer is adoption. Source: https://github.com/alejosuaza1022/Departamentos-municipios-Colombia-a-DB |
| O35 | `found_deceased` and `gave_up`: proposed to the client (which endpoint or field, which status) |
| O36 | Claim evidence: expose a claim's photos, point and `from_sighting_id` in `claims[]` (proposed to the client) |
| O37 | Reports leave L1: `POST /reports`, the two auto-hide reasons, «en revisión», with O20 |
| O38 | Shares leave L1: `POST /cases/{code}/shares` with the L2 worker and the events table; its storage and growth |

**FE handoff:** a new `docs/handoffs/<merge date>-backend-lost-l1-fe.md`, structured like
`2026-10-31-backend-thin-slice-fe.md`:

- *Product changes:* «Lo tengo» needs a session (tell the user it is for safety; `@HELP-002` and `@HELP-005`
  need a sign-in step before claiming); the badge is owner-only (render nothing for `null`); a cancelled case
  page (`status: cancelled`, no contact); reopen and claims can answer `active_case_exists`, a claim on a
  purged code `gone`, the owner's own claim `forbidden`; a repeated claim returns the same id; the owner's
  `claims[]` holds the newest 50; answers are revisable; editing photos or signs changes the pet on every
  case; a moved zone shows the generic place label; "mine" now follows session-wins; a deleted pin keeps its
  `client_id`; the profile rules (name chosen on send, bio patterns, `city` ≤ 80).
- *Proposals:* `found_deceased`/`gave_up` (O35); claim evidence in `claims[]` (O36); the «¿Es donde lo
  viste…?» prefill from the caller's own recent pin (the client's call); copy review of the WhatsApp text.
- *E2E:* the `@LINK-001` change and the seed additions of §7.6; the new result table.

## 9. L2 seams

| Seam | What L1 leaves |
|---|---|
| Claim check-ins (+24 h, +72 h) and stale | `recovery_claim.created_at`; stale derived from `STALE_AFTER`. «Aún verificando» needs a stored `stale_at` (a new L2 migration); `ClaimDerivation` then reads it instead of `created_at + 7 d` |
| Owner interactions reset time-based check-ins | Only `answered_at` and `resolved_at` are stored. Edits, hides and highlights leave no timestamp: L2 adds one (a column or an event) if it needs them |
| Notifications (`recovery_claim.opened/confirmed`, `lost_case.reunited`, `sighting.highlighted`) | No outbox rows. Derivable from rows: claims by `created_at`/`answered_at`, helpers of a reunion (visible sightings with a person, claimants). A highlight has no timestamp (above) |
| Expiry and purge | Expiry writes `status = 'expired'`, `resolved_at`, and `resolution = 'no_response'` after widening `lost_case_resolution_fits_status`. The purge must handle `recovery_claim` and `sighting` rows (no `ON DELETE` action) and O4 |
| `answerCheckin` `claim_confirmed` | Calls the same claim answer and then reunite with `platform_claim`; L1's answer never closes |
| In-app thread for a null `whatsapp_url` | Conversations (`eng/comms.md`) |
| Account deletion (#28) | Decides `recovery_claim.claimant_person_id` |
| Other verticals | `PATCH /cases/{code}` and reopen gain their `CaseKind` implementations |

## 10. Risks

| Risk | Note |
|---|---|
| No push for claims | An owner learns of a claim only by opening the case or «Mis casos» (decision #17 makes claims push-only). Must ship (L2) before the first real user |
| Session-required claims | Fewer claims from finders who will not sign in. Accepted for safety; the client explains it |
| A stale claim returned on repeat | A person who claims again after 7 days gets their stale claim back and the badge stays off until the owner answers |
| The edit changes the shared pet | Old cases show the new photos and signs |
| Reopen keeps `published_at` | A reopened case sorts by its old date in the national feed |
| Domain-shaped bio rule | False positives («Hola.Soy») answer `validation_failed {bio}`; the client says why |
| No lock on edit's two statements | The pet row is updated before the case guard; a close in between rolls the pet update back (asserted by the race test) |
| Contract rows beyond the badge (§6) | The client must accept the `claimRecovery` auth and both new error lists |

## 11. Assumptions

Choices this design makes where the product rules are silent, and why.

1. **The contract lists the decided auth and codes.** `claimRecovery` becomes `session` with `forbidden`,
   `active_case_exists`, `gone`; `reopenCase` gets `active_case_exists`. The decided behaviour answers them,
   and the contract validator would refuse it otherwise.
2. **Jackson-level body errors come first.** Malformed JSON, a wrong type or an absent required field answer
   `validation_failed` before the lookups (the body cannot be read); field rules follow the decided order.
3. **Claim error order** is session → `not_found`/`gone` → `forbidden` → body → status, the same shape as the
   owner endpoints; the dedupe runs at the insert, after the status checks.
4. **A claim on a case expired more than 30 days ago but not yet purged** answers `invalid_transition`, as
   reopen does.
5. **A bad `from_sighting_id`** (unknown, another case, not the caller's, not visible, older than 24 h) is
   `validation_failed {from_sighting_id}`: it is a body field and the contract has no better code.
6. **The dedupe needs an integrity index**, `recovery_claim_one_open_per_claimant`: a check-then-insert lets a
   double tap create two rows under `READ COMMITTED`. "Open" is the stored status, so a stale claim counts.
7. **The profile photo check goes through a `platform` interface** implemented in `uploads`, because
   `identity` may not depend on `uploads`.
8. **Correction and delete need a `visible` pin.** A pin the owner hid is `forbidden` to its reporter;
   moderated and deleted pins are `not_found`. With no session, "mine" is the device whatever
   `reporter_person_id` says.
9. **Highlight and hide are independent**: a hidden pin can be highlighted.
10. **The answer endpoint looks up the claim before reading the body**, like the case itself.
11. **Reopen and reactivation also clear `resolved_at` and `resolution_attribution`**, so an active case has
    no resolution data (`lost_case_active_is_unresolved`).
12. **The resolution CHECK accepts only L1's three values**; L2 widens it in its own migration.
13. **The WhatsApp text is Spanish for every locale**: the owner reads it and no owner language is stored.
    Lost pets always have a name (publish requires one).
14. **Window edges:** stale strictly after 7 days; prefill inside 24 h exclusive, like the 15-minute window;
    reopen inclusive at 30 days (decided).
15. **`/me/pets` order:** "case activity" is the latest `published_at` or `resolved_at` of the caller's cases
    of that pet; a nameless pet has `name: ""`.
16. **No `recovery_claim.note`**: the request has no note field, so no column is added until one exists.
17. **`MyCases.open_claim_count` stays a non-null int** (always the owner) and the found vertical's
    `open_claim_count` is untouched.

## Appendix: question index

Each question raised while preparing this design, restated, and where it is answered. "Out" = out of scope.

| Id | Question | Answer |
|---|---|---|
| Q-A1 | Which resolution values can L1 write; the columns are missing | §2.1, §4.3–4.4 |
| Q-A2 | What `Created.id` is for case actions | §4.3–4.6, §4.10 |
| Q-A3 | Error precedence (body versus access) | §3 |
| Q-A4 | Reopen or claim reactivation versus one active case per pet | §4.5, §4.9 |
| Q-A5 | Reopen window: from when, boundary, which statuses | §3, §4.5 |
| Q-A6 | What reopen resets (claims, resolution, `published_at`, broadcast) | §4.5 |
| Q-A7 | Who is the owner: `created_by` or the link | §3 |
| Q-A8 | What each view shows for a cancelled case | §4.4 |
| Q-A9 | Open claims when the case closes; attribution validation | §4.3, §3 badge |
| Q-A10 | Confirm closes or not; several confirmed claims | §4.10; check-in path §9 |
| Q-A11 | Which answer transitions; repeats; case status | §4.10 |
| Q-A12 | Owner interactions and claim schedules reach into check-ins | §1 out of scope, §9 |
| Q-A13 | Do L1 writes emit outbox events | §1 (no), §9 |
| Q-A14 | A reopened case has no check-ins scheduled | Out: L2 (§9) |
| Q-B1 | Phone required for a signed-in claimant | §4.9 (from the body) |
| Q-B2 | Phone validation depth | §4.9 |
| Q-B3 | `from_sighting_id` rules | §4.9, assumption 5 |
| Q-B4 | Where claim photos and point surface | §2.3, §4.9, O36 |
| Q-B5 | Abuse controls, owner claiming, repeats | §4.9, assumption 6 |
| Q-B6 | `whatsapp_url` rule, prefilled text, `mailto:` | §4.9 |
| Q-B7 | A claim on a purged code | §4.9 (`gone`); shares and reports out |
| Q-B8 | Claim concurrency with reactivation and close | §4.9, §7.2 |
| Q-B9 | Stale-to-confirmed forever versus the 30-day purge (O4) | Out: L2 purge (§9); L1 answers any unpurged claim |
| Q-B10 | Claims list size and claimant identity | §4.13 (50), §2.3 (a person) |
| Q-B11 | `open_claim_count` visibility; denormalize or index | §3, §2.4 |
| Q-C1 | Edit photos already on the pet versus the 24 h attach window | §4.1 |
| Q-C2 | Who writes the pet; the change shows on other cases | §4.1, §5 |
| Q-C3 | `editCase` and reopen for verticals with no table | §4.2, §4.5 |
| Q-C4 | "Owner" versus "publisher" wording | §4.2 (`created_by`) |
| Q-C5 | PATCH tri-state; `{}` | §3, §4.1 |
| Q-C6 | Recomputing the snapped center and place name on edit | §4.1 |
| Q-C7 | Time bounds of an edit; revalidating sightings | §4.1 |
| Q-C8 | Does an open claim block an edit | §4.1 (no) |
| Q-C9 | Editing an expired case | §4.1 (`invalid_transition`) |
| Q-D1 | `mine`: session wins versus OR | §4.7 |
| Q-D2 | Delete: hard or status | §2.2, §4.8 |
| Q-D3 | Unhiding a moderated pin; repeats; highlight on hidden | §4.6 |
| Q-D4 | Case-status checks for moderate, correct, delete | §4.6–4.8 |
| Q-D5 | Order of checks on correction | §4.7 |
| Q-D6 | Window boundary; does a correction move it | §3, §4.7 |
| Q-D7 | Correction distance from the snapped center | §4.7 |
| Q-D8 | Highlight notification and idempotence | §4.6; notification out (L2) |
| Q-D9 | The owner's view of a hidden pin's contact | §4.6 |
| Q-D10 | Correction and deletion versus counts and feed | §2.2, §4.7–4.8 |
| Q-E1 | Which pets `/me/pets` lists, and order | §4.11 |
| Q-E2 | `active_case_code`/`reopenable_case_code` derivation | §4.11 |
| Q-E3 | Home of `/me/pets` | §5 |
| Q-E4 | Pet changes from an edit show in the list | §4.1 |
| Q-F1 | Setting `display_name_chosen`; trim; no way back | §4.12 |
| Q-F2 | The bio "no links" rule | §4.12 |
| Q-F3 | `city` length without a DB CHECK | §2.5 |
| Q-F4 | `notification_prefs` all-or-nothing | §4.12 |
| Q-F5 | `photo_url` check and the current photo | §4.12, §5 |
| Q-F6 | Response `phone` | §4.12 (as `GET /me/profile`) |
| Q-F7 | Public name read live | §4.12 |
| Q-F8 | A cache holding the name | §4.12 (none) |
| Q-G1–G4 | Share storage, `format: text`, purged and malformed codes | Out: shares (O38) |
| Q-H1–H6 | Report targets, auto-hide, abuse, dedupe, scope, queue | Out: reports (O37) |
| Q-I1 | Security rules per method | §5 |
| Q-I2 | Stale rate-limit promises in the contract | §4.7 (none copied) |
| Q-I3 | `case_id` versus `case_code` | §2.3 |
| Q-I4 | Race tests and statement ceilings | §4, §7.2–7.3 |
| Q-I5 | Leak tests | §7.1 |
| Q-I6 | One constant per rule | §3 |
| Q-I7 | `published_at` ordering after reopen | §4.5, §10 |
| Q-I8 | Handoff acceptance | §1, §7.6 |
