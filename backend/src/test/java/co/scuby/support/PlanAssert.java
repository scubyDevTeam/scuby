package co.scuby.support;

import org.jooq.DSLContext;
import org.jooq.Query;
import org.jooq.conf.ParamType;

import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Plan checks for growth-sensitive queries only (design · Queries and indexes). Seed thousands of
 * rows and ANALYZE before asserting; paste the printed plan (before and after an index) into the report.
 */
public final class PlanAssert {

    private PlanAssert() {}

    public static String plan(DSLContext db, Query query) {
        return db.fetch("EXPLAIN " + query.getSQL(ParamType.INLINED)).stream()
                 .map(r -> r.get(0, String.class))
                 .collect(Collectors.joining("\n"));
    }

    public static void assertNoSeqScanOn(DSLContext db, Query query, String table) {
        String plan = plan(db, query);
        System.out.println("PLAN for " + table + ":\n" + plan);
        assertThat(plan).as("plan:\n%s", plan).doesNotContain("Seq Scan on " + table + " ");
    }
}
