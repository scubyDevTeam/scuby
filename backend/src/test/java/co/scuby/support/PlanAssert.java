package co.scuby.support;

import org.jooq.DSLContext;
import org.jooq.Query;
import org.jooq.conf.ParamType;

import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Plan checks for growth-sensitive queries only (design · Queries and indexes). Seed thousands of
 * rows and ANALYZE before asserting; paste the printed plan (before and after an index) into the report.
 * The query is rendered with INLINED values, so EXPLAIN shows the custom plan for those literals; a
 * prepared statement the application runs may use a generic plan.
 */
public final class PlanAssert {

    private PlanAssert() {}

    public static String plan(DSLContext db, Query query) {
        return db.fetch("EXPLAIN " + query.getSQL(ParamType.INLINED)).stream()
                 .map(r -> r.get(0, String.class))
                 .collect(Collectors.joining("\n"));
    }

    /**
     * The plan reads {@code table} (any scan form: "... on table ...") and not with a sequential scan.
     * Fails when the plan never mentions the table, so a misspelled name cannot pass vacuously.
     */
    public static void assertNoSeqScan(DSLContext db, Query query, String table) {
        String plan = plan(db, query);
        System.out.println("PLAN for " + table + ":\n" + plan);
        assertThat(plan).as("plan does not mention table %s (misspelled?):\n%s", table, plan).contains(" on " + table + " ");
        assertThat(plan).as("plan:\n%s", plan).doesNotContain("Seq Scan on " + table + " ");
    }

    /** The plan scans {@code indexName} ("Index Scan using idx", "Index Only Scan using idx" or "Bitmap Index Scan on idx"). */
    public static void assertUsesIndex(DSLContext db, Query query, String indexName) {
        String plan = plan(db, query);
        System.out.println("PLAN using " + indexName + ":\n" + plan);
        assertThat(plan).as("plan does not use index %s:\n%s", indexName, plan)
                .satisfiesAnyOf(
                        p -> assertThat(p).contains(" using " + indexName + " "),
                        p -> assertThat(p).contains("Bitmap Index Scan on " + indexName + " "));
    }
}
