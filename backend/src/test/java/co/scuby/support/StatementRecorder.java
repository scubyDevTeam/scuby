package co.scuby.support;

import org.jooq.ExecuteContext;
import org.jooq.ExecuteListener;

import java.sql.SQLException;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Records every SQL statement jOOQ executes, and whether it ran in autocommit (outside a transaction).
 * ApiClient checks the count against StatementCeilings; the session tests check the autocommit flag.
 */
public final class StatementRecorder implements ExecuteListener {

    private record Executed(String sql, boolean autoCommit) {}

    private final List<Executed> executed = new CopyOnWriteArrayList<>();

    @Override
    public void executeStart(ExecuteContext ctx) {
        boolean autoCommit = autoCommit(ctx);
        String[] batch = ctx.batchSQL();
        if (batch != null && batch.length > 1) {
            for (String sql : batch) executed.add(new Executed(sql, autoCommit));
        } else {
            executed.add(new Executed(String.valueOf(ctx.sql()), autoCommit));
        }
    }

    public void reset() { executed.clear(); }

    public List<String> statements() { return executed.stream().map(Executed::sql).toList(); }

    public List<Boolean> autoCommits() { return executed.stream().map(Executed::autoCommit).toList(); }

    private static boolean autoCommit(ExecuteContext ctx) {
        try {
            return ctx.connection().getAutoCommit();
        } catch (SQLException e) {
            throw new IllegalStateException(e);
        }
    }
}
