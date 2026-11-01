package co.scuby.platform.db;

import java.sql.SQLException;

/**
 * Whether an exception is Postgres' unique violation (SQLSTATE 23505) of one named constraint. The constraint name comes
 * from the server message («duplicate key value violates unique constraint "name"»), which stays in the message when the
 * driver's logServerErrorDetail is off (only the row detail is dropped). Domain-free.
 */
public final class UniqueViolation {

    private UniqueViolation() {}

    public static boolean on(Throwable error, String constraint) {
        for (Throwable t = error; t != null; t = t.getCause() == t ? null : t.getCause()) {
            if (t instanceof SQLException sql && "23505".equals(sql.getSQLState())
                    && String.valueOf(sql.getMessage()).contains("\"" + constraint + "\"")) {
                return true;
            }
        }
        return false;
    }
}
