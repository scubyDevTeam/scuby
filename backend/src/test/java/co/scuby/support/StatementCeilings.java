package co.scuby.support;

import java.util.Map;

/**
 * The most SQL statements one request may execute (design · Queries and indexes: N+1 guard).
 * A ceiling never depends on how many rows exist: endpoint tests seed several rows to prove it.
 * Measured on the uncached path (the session lookup counts). Lower a ceiling when the measured
 * count is lower; raising one needs a reason in the task report.
 */
final class StatementCeilings {

    private static final Map<String, Integer> CEILINGS = Map.ofEntries(
            Map.entry("GET /actuator/health", 0),
            Map.entry("GET /config", 1),
            Map.entry("GET /session", 2),          // lookup + person
            Map.entry("POST /auth/sign-out", 2),   // lookup + DELETE
            Map.entry("POST /auth/email/start", 4),   // send count, guarded upsert, send-log insert (+ the filter's session lookup when the browser is signed in): 3, or 4 on a session-cache miss. No locks
            Map.entry("POST /auth/email/verify", 7),   // worst case, a new account from a signed-in browser on a session-cache miss: filter lookup, atomic consume (UPDATE ... RETURNING), email lookup, person insert + select, old session DELETE, session insert
            Map.entry("POST /me/phone", 5),   // exactly: session lookup, supported_countries, send count, guarded otp upsert, send-log insert. No locks
            Map.entry("POST /me/phone/verify", 6),   // exactly: session lookup, supported_countries, attempt reservation (UPDATE ... RETURNING), conditional delete, person update, person select
            Map.entry("GET /me/profile", 2),       // session lookup + person
            Map.entry("PATCH /me/profile", 4),   // worst path, ProfileUpdateTest: session, person read (only for a non-null photo_url), upload lookup (a new photo), UPDATE … RETURNING; {} is 2 (session, person read)
            Map.entry("POST /uploads", 2),   // session lookup, upsert (the stored-bytes check is a file or S3 call, not SQL)
            Map.entry("POST /lost-cases", 13),   // worst path: a correct code with a new pet and photos, on a session-cache miss (13, measured by PublishStatementsTest, which pins every path; 10 for a new number on an existing pet). Excludes the process-wide flag snapshot load (+2, once per 30 s)
            Map.entry("GET /cases/{code}", 4),   // the owner, exactly 4 on a session-cache miss (CaseStatementsTest, ClaimLeakTest with 56 claims): session lookup, case (+ pet, publisher), sightings, the owner's claims (L1 design §4.13: up from 3); a signed-in stranger 3, anonymous 2. Excludes the flag snapshot load
            Map.entry("POST /cases/{code}/claims/{claimId}", 3),   // exactly 3 on a session-cache miss (ClaimAnswerTest): session, pre-read (case + claim), update; a repeated answer 2
            Map.entry("GET /me/cases", 2),   // exactly 2 on a session-cache miss, 1 or 20 cases (MyCasesEndpointTest): session lookup, the cases query. Excludes the flag snapshot load
            Map.entry("GET /feed", 3),   // session lookup when signed in, local query, national fallback. Excludes the flag snapshot load
            Map.entry("POST /cases/{code}/sightings", 8),   // the longest path, measured by SightingRaceTest: a retry (client_id, phone, photo) on a case that closes mid-request, on a session-cache miss: session, case + distance, replay, supported_countries, upload lookup, conditional insert (empty), replay re-select, status (then 409). The ON CONFLICT race path is 7. SightingPrecedenceTest pins the single-request paths (5 plain, 6 with phone and photo). Excludes the flag snapshot load
            Map.entry("POST /cases/{code}/reunite", 4),   // longest path, CaseLifecycleRaceTest (the race loser): session, pre-read (case + other active code), conditional UPDATE (zero rows), re-read; 3 on success (CaseLifecycleTest), 2 for a repeat
            Map.entry("POST /cases/{code}/cancel", 4),    // as reunite
            Map.entry("POST /cases/{code}/reopen", 4),    // longest path, measured by CaseLifecycleRaceTest: session, pre-read, UPDATE (zero rows or the unique violation), re-read or active-code read; 3 on success, 2 on an already active case
            Map.entry("PATCH /lost-cases/{code}", 5),   // worst path, EditLostTest: session, pre-read (case + pet photos), upload lookup, pet update, case update (the guard); {} is 2, photos already on the pet 4
            Map.entry("PATCH /cases/{code}/sightings/{sightingId}", 3),   // exactly 3 on a session-cache miss (SightingModerationTest): session, pre-read (case + pin), update; {} is 2
            Map.entry("POST /cases/{code}/sightings/{sightingId}/correction", 4),   // longest path, SightingCorrectionTest: session, pre-read (pin + case + distance), update (zero rows), re-read; 3 signed in, 2 anonymous
            Map.entry("DELETE /cases/{code}/sightings/{sightingId}", 4),            // as correction (SightingDeleteTest: the hide race and the double-tap race); a repeat of a done delete is the pre-read only
            Map.entry("POST /cases/{code}/recovery-claims", 8),   // worst path, RecoveryClaimTest: session, pre-read (case + pet name + contact), supported_countries, from-sighting read, upload lookup, reactivation, upsert (insert or refresh), status re-read; the plain claim and a plain repeat are 4
            Map.entry("GET /me/pets", 2),   // exactly 2 on a session-cache miss, 1 or 20 pets (MyPetsEndpointTest): session lookup, the pets query
            Map.entry("PATCH /cases/{code}", 1),        // the session lookup only: every code is not_found without a query (no table for the other verticals yet)
            Map.entry("POST /auth/google", 7)   // worst case on a session-cache miss with a carried session (the rare races with a simultaneous email-code sign-up of the same address, or an insert that conflicts on google_sub, run 8 to 9 statements and are not pinned): filter lookup, sub lookup, email lookup, person insert + select (or conditional link + re-read), old session DELETE, session insert; a non-authoritative new account (Google creates it, no session) is 5 with no cookie (7 with a stale session cookie) and cannot exceed this
    );

    private StatementCeilings() {}

    static int of(String method, String pathTemplate) {
        Integer ceiling = CEILINGS.get(method + " " + pathTemplate);
        if (ceiling == null) {
            throw new AssertionError("no statement ceiling for " + method + " " + pathTemplate
                    + " — add it to co.scuby.support.StatementCeilings");
        }
        return ceiling;
    }
}
