package co.scuby.platform.db;

import org.jooq.exception.DataAccessException;
import org.junit.jupiter.api.Test;
import org.postgresql.util.PSQLException;
import org.postgresql.util.ServerErrorMessage;

import java.sql.SQLException;

import static org.assertj.core.api.Assertions.assertThat;

class UniqueViolationTest {

    private static final String CONSTRAINT = "lost_case_one_active_per_pet";

    /** A server error as the driver parses it: severity S, SQLState C, message M and constraint n, each NUL-terminated. */
    private static PSQLException server(String sqlState, String message, String constraint) {
        String wire = "SERROR\0C" + sqlState + "\0M" + message + "\0n" + constraint + "\0";
        ServerErrorMessage parsed = new ServerErrorMessage(wire);
        return new PSQLException(parsed);
    }

    /** A Spanish-locale server: the message shares no word, and no quote character, with the English one. */
    private static PSQLException spanish(String constraint) {
        return server("23505", "el valor de clave duplicado viola la restricción de unicidad «" + constraint + "»", constraint);
    }

    @Test
    void recognisesTheViolationByStateAndConstraintWhateverTheMessageLanguage() {
        assertThat(UniqueViolation.on(spanish(CONSTRAINT), CONSTRAINT)).isTrue();
        assertThat(UniqueViolation.on(server("23505", "mensagem sem o nome", CONSTRAINT), CONSTRAINT)).isTrue();
    }

    @Test
    void findsItThroughTheJooqAndSpringWrappers() {
        Throwable wrapped = new IllegalStateException("outer", new DataAccessException("SQL [insert ...]; el valor", spanish(CONSTRAINT)));
        assertThat(UniqueViolation.on(wrapped, CONSTRAINT)).isTrue();
    }

    @Test
    void theMessageTextAloneNeverMatches() {
        SQLException looksRight = new SQLException("ERROR: duplicate key value violates unique constraint \"" + CONSTRAINT + "\"", "23505");
        assertThat(UniqueViolation.on(looksRight, CONSTRAINT)).isFalse();
        assertThat(UniqueViolation.on(server("23505", "duplicate key value violates unique constraint \"" + CONSTRAINT + "\"",
                "another_constraint"), CONSTRAINT)).as("the name is in the message, not in the constraint field").isFalse();
    }

    @Test
    void anotherConstraintAnotherStateOrNoSqlErrorIsNot() {
        assertThat(UniqueViolation.on(spanish(CONSTRAINT), "sighting_replay_key")).isFalse();
        assertThat(UniqueViolation.on(spanish(CONSTRAINT), "lost_case_one_active")).as("a prefix of the name").isFalse();
        assertThat(UniqueViolation.on(server("23514", "viola la restricción de verificación", CONSTRAINT), CONSTRAINT)).isFalse();
        assertThat(UniqueViolation.on(new RuntimeException("boom"), CONSTRAINT)).isFalse();
    }
}
