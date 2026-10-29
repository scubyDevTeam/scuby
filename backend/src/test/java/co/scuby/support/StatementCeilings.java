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
            Map.entry("POST /auth/email/verify", 8),   // consume select + update, person lookup, person insert + select, session insert (+ filter lookup and old DELETE)
            Map.entry("POST /me/phone", 8),   // session lookup, supported_countries, advisory lock, throttle count, otp select, otp upsert, send-log insert
            Map.entry("POST /me/phone/verify", 7),   // session lookup, supported_countries, otp select, conditional delete (or the miss's update), person update, person select
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
