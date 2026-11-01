package co.scuby.platform.db;

import org.junit.jupiter.api.Test;

import java.sql.SQLException;

import static org.assertj.core.api.Assertions.assertThat;

class UniqueViolationTest {

    static final SQLException DUPLICATE = new SQLException(
            "ERROR: duplicate key value violates unique constraint \"lost_case_one_active_per_pet\"", "23505");

    @Test
    void recognisesTheNamedConstraintAnywhereInTheCauseChain() {
        assertThat(UniqueViolation.on(DUPLICATE, "lost_case_one_active_per_pet")).isTrue();
        assertThat(UniqueViolation.on(new RuntimeException("wrapped", new IllegalStateException(DUPLICATE)), "lost_case_one_active_per_pet")).isTrue();
    }

    @Test
    void anotherConstraintAnotherStateOrNoSqlErrorIsNot() {
        assertThat(UniqueViolation.on(DUPLICATE, "sighting_replay_key")).isFalse();
        assertThat(UniqueViolation.on(DUPLICATE, "lost_case_one_active")).as("a prefix of the name").isFalse();
        assertThat(UniqueViolation.on(new SQLException("violates check constraint \"lost_case_one_active_per_pet\"", "23514"),
                "lost_case_one_active_per_pet")).isFalse();
        assertThat(UniqueViolation.on(new RuntimeException("boom"), "lost_case_one_active_per_pet")).isFalse();
    }
}
