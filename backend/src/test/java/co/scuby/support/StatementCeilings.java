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
            Map.entry("POST /uploads", 2),   // session lookup, upsert (the stored-bytes check is a file or S3 call, not SQL)
            Map.entry("POST /lost-cases", 13),   // worst path: a correct code with a new pet and photos, on a session-cache miss (13, measured by PublishStatementsTest, which pins every path; 10 for a new number on an existing pet). Excludes the process-wide flag snapshot load (+2, once per 30 s)
            Map.entry("GET /cases/{code}", 3),   // exactly 3 on a session-cache miss (owner or signed-in stranger; CaseStatementsTest pins it, anonymous is 2): session lookup, case (+ pet, publisher), sightings. Excludes the flag snapshot load
            Map.entry("GET /me/cases", 2),   // exactly 2 on a session-cache miss, 1 or 20 cases (MyCasesEndpointTest): session lookup, the cases query. Excludes the flag snapshot load
            Map.entry("GET /feed", 3),   // session lookup when signed in, local query, national fallback. Excludes the flag snapshot load
            Map.entry("POST /cases/{code}/sightings", 7),   // the longest path, measured by SightingRaceTest: a retry that loses the ON CONFLICT race, with a phone and a photo, on a session-cache miss: session, case + distance, replay, supported_countries, upload lookup, conditional insert (waits, conflicts), re-select. SightingPrecedenceTest pins the single-request paths (5 plain, 6 with phone and photo). Excludes the flag snapshot load
            Map.entry("POST /auth/google", 7)   // worst case on a session-cache miss with a carried session: filter lookup, sub lookup, email lookup, person insert + select (or conditional link + re-read), old session DELETE, session insert
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
