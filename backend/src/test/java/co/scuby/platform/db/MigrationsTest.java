package co.scuby.platform.db;

import co.scuby.TestcontainersConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@Import(TestcontainersConfiguration.class)
class MigrationsTest {

    @Autowired JdbcTemplate jdbc;

    @Test
    void postgisIsInstalled() {
        String version = jdbc.queryForObject("SELECT postgis_lib_version()", String.class);
        assertThat(version).startsWith("3.");
    }

    @Test
    void outboxTableExistsInTheAppSchema() {
        Integer n = jdbc.queryForObject(
                "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'scuby' AND table_name = 'outbox_events'",
                Integer.class);
        assertThat(n).isEqualTo(1);
    }
}
