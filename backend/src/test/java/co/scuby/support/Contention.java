package co.scuby.support;

import org.jooq.DSLContext;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.concurrent.TimeUnit;

/**
 * Makes a race deterministic: hold a write in a transaction of its own (another connection), start the request, wait
 * until it queues on that row, then commit (docs/eng/backend.md · Concurrency, race tests). Close it in @AfterEach.
 */
public final class Contention implements AutoCloseable {

    /** Backends blocked by the holder's pid only: a waiter left behind by another test never counts. */
    private static final String WAITING = "SELECT count(*) FROM pg_stat_activity WHERE ? = ANY(pg_blocking_pids(pid))";

    private final DataSource dataSource;
    private final DSLContext db;
    private Connection holder;
    private int holderPid;

    public Contention(DataSource dataSource, DSLContext db) {
        this.dataSource = dataSource;
        this.db = db;
    }

    /** Runs {@code sql} in a transaction that stays open until {@link #commit()} or {@link #close()}. */
    public void hold(String sql, Object... binds) throws SQLException {
        if (holder != null) throw new IllegalStateException("already holding a transaction");
        holder = dataSource.getConnection();
        holder.setAutoCommit(false);
        try (PreparedStatement pid = holder.prepareStatement("SELECT pg_backend_pid()");
             ResultSet rs = pid.executeQuery()) {
            rs.next();
            holderPid = rs.getInt(1);
        }
        try (PreparedStatement ps = holder.prepareStatement(sql)) {
            for (int i = 0; i < binds.length; i++) ps.setObject(i + 1, binds[i]);
            ps.execute();
        }
    }

    public void commit() throws SQLException {
        holder.commit();
        holder.close();
        holder = null;
    }

    /** Returns once at least {@code n} backends wait on the held transaction; fails after 10 s. */
    public void awaitWaiters(int n) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
        while (System.nanoTime() < deadline) {
            Integer waiting = db.fetchOne(WAITING, holderPid).get(0, Integer.class);
            if (waiting != null && waiting >= n) return;
            Thread.sleep(20);
        }
        throw new AssertionError("no request queued behind the held row within 10 s (waiting: " + db.fetchOne(WAITING, holderPid).get(0) + ")");
    }

    @Override
    public void close() throws SQLException {
        if (holder != null) {
            holder.rollback();
            holder.close();
            holder = null;
        }
    }
}
