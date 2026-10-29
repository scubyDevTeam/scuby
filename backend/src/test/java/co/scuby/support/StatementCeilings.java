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
            Map.entry("GET /actuator/health", 0)
            // Each endpoint task adds its line here: Map.entry("GET /config", 1), ...
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
