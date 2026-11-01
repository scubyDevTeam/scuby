package co.scuby.cases;

import co.scuby.support.Accounts;
import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.CaseFixtures;
import co.scuby.support.Contention;
import co.scuby.support.IntegrationTest;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import javax.sql.DataSource;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static co.scuby.db.generated.Tables.LOST_CASE;
import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.SIGHTING;
import static org.assertj.core.api.Assertions.assertThat;

/** The edit holds the case row only for its last statement; a close in between rolls the pet change back (spec §4.1, §10). */
@IntegrationTest
class EditLostRaceTest {

    @Autowired ApiClients clients;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;
    @Autowired DSLContext db;
    @Autowired DataSource dataSource;

    ApiClient owner;
    UUID pet;
    Contention contention;
    ExecutorService pool = Executors.newFixedThreadPool(2);

    @BeforeEach
    void setUp() {
        contention = new Contention(dataSource, db);
        owner = clients.newBrowser();
        cases.luna(accounts.signIn(owner, "carolina@correo.co"));
        pet = cases.petOf("7K3PQ");
        db.update(PET).set(PET.MARKS, "Collar rojo").where(PET.ID.eq(pet)).execute();
    }

    @AfterEach
    void tearDown() throws Exception {
        contention.close();
        pool.shutdownNow();
    }

    private String marks() {
        return db.select(PET.MARKS).from(PET).where(PET.ID.eq(pet)).fetchOne(PET.MARKS);
    }

    @Test
    void anEditAndAnUncommittedSightingBothCommit() throws Exception {
        // A signed-in «Lo vi» (spec §7.2): the uncommitted insert also holds its reporter's person row.
        contention.hold("INSERT INTO scuby.sighting (id, case_code, lat, lng, seen_at, created_at, reporter_device_hash, reporter_person_id) "
                + "VALUES (gen_random_uuid(), '7K3PQ', 6.2455, -75.5905, now(), now(), repeat('a', 64), ?)", accounts.person("held@correo.co"));
        Future<ApiResponse> f = pool.submit(() -> owner.patch("/lost-cases/{code}", "{\"marks\":\"Collar azul\",\"last_seen_radius_m\":250}", "7K3PQ"));
        assertThat(f.get(10, TimeUnit.SECONDS).status()).as("the edit does not wait for the sighting").isEqualTo(204);
        contention.commit();
        assertThat(marks()).isEqualTo("Collar azul");
        assertThat(db.fetchCount(SIGHTING)).isEqualTo(1);
        assertThat(db.select(LOST_CASE.LAST_SEEN_RADIUS_M).from(LOST_CASE).fetchOne(LOST_CASE.LAST_SEEN_RADIUS_M)).isEqualTo(250.0);
    }

    @Test
    void aCloseCommittedBetweenThePetUpdateAndTheCaseGuardRollsThePetBack() throws Exception {
        contention.hold("UPDATE scuby.lost_case SET status = 'reunited', resolved_at = now(), resolution = 'reunited_home' WHERE code = '7K3PQ'");
        Future<ApiResponse> f = pool.submit(() -> owner.patch("/lost-cases/{code}", "{\"marks\":\"Collar azul\"}", "7K3PQ"));
        contention.awaitWaiters(1);                // the pet is updated; the case guard waits on the held row
        contention.commit();
        ApiResponse r = f.get(30, TimeUnit.SECONDS);
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.errorCode()).isEqualTo("invalid_transition");
        assertThat(marks()).as("the pet change rolled back with the refused guard").isEqualTo("Collar rojo");
    }
}
