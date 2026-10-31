package co.scuby.identity;

import co.scuby.support.Accounts;
import co.scuby.support.IntegrationTest;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static co.scuby.db.generated.Tables.PERSON;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * People.lock is FOR NO KEY UPDATE: it serialises person writers with each other but does not conflict with the
 * FOR KEY SHARE a foreign key takes on the person row. A signed-in «Lo vi» (its sighting row references the person)
 * must therefore not queue behind that person's publish or code send.
 */
@IntegrationTest
class PersonLockModeTest {

    @Autowired People people;
    @Autowired Accounts accounts;
    @Autowired TestDb testDb;
    @Autowired DSLContext db;
    @Autowired TransactionTemplate tx;

    @BeforeEach
    void setUp() {
        testDb.reset();
    }

    @Test
    void aForeignKeyReferenceToTheLockedPersonIsNotBlocked() throws Exception {
        UUID ana = accounts.person("ana@correo.co");
        var pool = Executors.newFixedThreadPool(2);
        var holds = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        try {
            Future<?> holder = pool.submit(() -> tx.executeWithoutResult(s -> {
                people.lock(ana);
                holds.countDown();
                try {
                    release.await(30, TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }));
            assertThat(holds.await(30, TimeUnit.SECONDS)).isTrue();
            // What the FK check of an INSERT referencing person(id) takes.
            Future<?> reference = pool.submit(() -> tx.executeWithoutResult(s ->
                    db.selectFrom(PERSON).where(PERSON.ID.eq(ana)).forKeyShare().fetch()));
            reference.get(5, TimeUnit.SECONDS);   // a FOR UPDATE lock would make this time out
            release.countDown();
            holder.get(30, TimeUnit.SECONDS);
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
    }

    @Test
    void twoLocksOnTheSamePersonStillSerialise() throws Exception {
        UUID ana = accounts.person("ana@correo.co");
        var pool = Executors.newFixedThreadPool(2);
        var holds = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        try {
            Future<?> holder = pool.submit(() -> tx.executeWithoutResult(s -> {
                people.lock(ana);
                holds.countDown();
                try {
                    release.await(30, TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }));
            assertThat(holds.await(30, TimeUnit.SECONDS)).isTrue();
            Future<?> second = pool.submit(() -> tx.executeWithoutResult(s -> people.lock(ana)));
            try {
                second.get(1, TimeUnit.SECONDS);
                org.junit.jupiter.api.Assertions.fail("the second lock was granted while the first was held");
            } catch (java.util.concurrent.TimeoutException expected) {
                // queued behind the holder
            }
            release.countDown();
            second.get(30, TimeUnit.SECONDS);
            holder.get(30, TimeUnit.SECONDS);
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
    }
}
