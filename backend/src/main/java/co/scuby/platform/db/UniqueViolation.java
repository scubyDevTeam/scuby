package co.scuby.platform.db;

import org.postgresql.util.PSQLException;
import org.postgresql.util.ServerErrorMessage;

/**
 * Whether an exception is Postgres' unique violation (SQLSTATE 23505) of one named constraint. Both facts are the
 * structured fields of the server's error (the SQLState and the constraint name the driver parses out of it), never the
 * message text, which follows the server's lc_messages. The exception is found by walking the cause chain, through the
 * jOOQ and Spring wrappers, down to the driver's PSQLException. Domain-free.
 */
public final class UniqueViolation {

    private static final String UNIQUE_VIOLATION = "23505";

    private UniqueViolation() {}

    public static boolean on(Throwable error, String constraint) {
        for (Throwable t = error; t != null; t = t.getCause() == t ? null : t.getCause()) {
            if (t instanceof PSQLException psql && UNIQUE_VIOLATION.equals(psql.getSQLState())) {
                ServerErrorMessage server = psql.getServerErrorMessage();
                if (server != null && constraint.equals(server.getConstraint())) return true;
            }
        }
        return false;
    }
}
