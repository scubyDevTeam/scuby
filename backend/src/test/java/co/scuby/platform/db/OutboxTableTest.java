package co.scuby.platform.db;

import co.scuby.TestcontainersConfiguration;
import org.jooq.DSLContext;
import org.jooq.JSONB;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.context.annotation.Import;

import java.util.UUID;

import static co.scuby.db.generated.Tables.OUTBOX_EVENTS;
import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
@Import(TestcontainersConfiguration.class)
class OutboxTableTest {

    @Autowired DSLContext db;

    @Test
    void generatedCodeRoundTripsARow() {
        UUID id = UUID.randomUUID();
        db.insertInto(OUTBOX_EVENTS)
          .set(OUTBOX_EVENTS.ID, id)
          .set(OUTBOX_EVENTS.PAYLOAD_JSON, JSONB.valueOf("{\"type\":\"probe\"}"))
          .execute();

        var row = db.selectFrom(OUTBOX_EVENTS).where(OUTBOX_EVENTS.ID.eq(id)).fetchOne();

        assertThat(row).isNotNull();
        assertThat(row.getAttempts()).isZero();
        assertThat(row.getLockedUntil()).isNull();
        assertThat(row.getCreatedAt()).isNotNull();
    }
}
