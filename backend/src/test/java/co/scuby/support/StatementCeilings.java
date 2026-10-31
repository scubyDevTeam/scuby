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
            Map.entry("POST /auth/email/start", 6),   // advisory lock, row select, throttle count, upsert, send-log insert (+ the filter's session lookup when the browser is signed in)
            Map.entry("POST /auth/email/verify", 10),   // worst case, a reclaim from a signed-in browser (measured 9 with a warm session cache): consume select + update, person lookup, unlink, deleteAllOf, discardAllOf, person re-read, old session DELETE, session insert (+ the filter lookup on a cache miss)
            Map.entry("POST /me/phone", 10),   // exactly: session lookup, supported_countries, person row FOR UPDATE (lock order: person first), 3 advisory locks (IP, device, number), throttle count, otp select, otp upsert, send-log insert
            Map.entry("POST /me/phone/verify", 6),   // exactly: session lookup, supported_countries, attempt reservation (UPDATE ... RETURNING), conditional delete, person update, person select
            Map.entry("GET /me/profile", 2),       // session lookup + person
            Map.entry("POST /uploads", 3),   // session lookup, slot count, upsert (the stored-bytes check is a file or S3 call, not SQL)
            Map.entry("POST /lost-cases", 15),   // measured max: pet_id with a new number, code sent (PublishStatementsTest prints every path)
            Map.entry("POST /auth/google", 8)   // sub lookup, email lookup, person insert + select, person SELECT ... FOR UPDATE, session insert (+ filter lookup and old DELETE)
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
