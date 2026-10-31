package co.scuby.support;

import org.jooq.DSLContext;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Clock;
import java.time.Duration;

import static co.scuby.db.generated.Tables.OUTBOX_EVENTS;
import static org.assertj.core.api.Assertions.assertThat;

/** A test class that never calls TestDb.reset() still starts each test clean: @IntegrationTest does it. */
@IntegrationTest
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ResetByConstructionSelfTest {

    @Autowired DSLContext db;
    @Autowired MutableClock mutableClock;
    @Autowired Clock clock;

    @Test
    @Order(1)
    void firstTestLeavesStateBehind() {
        db.execute("INSERT INTO scuby.outbox_events (id, payload_json) VALUES (gen_random_uuid(), '{}')");
        mutableClock.advance(Duration.ofDays(1));
        assertThat(db.fetchCount(OUTBOX_EVENTS)).isEqualTo(1);
    }

    @Test
    @Order(2)
    void nextTestStartsClean() {
        assertThat(db.fetchCount(OUTBOX_EVENTS)).isZero();
        assertThat(clock.instant()).isEqualTo(MutableClock.START);
    }
}
