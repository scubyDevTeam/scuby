package co.scuby.platform.flags;

import co.scuby.support.IntegrationTest;
import co.scuby.support.StatementRecorder;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.Arrays;
import java.util.UUID;

import static co.scuby.db.generated.Tables.FEATURE_FLAGS;
import static co.scuby.db.generated.Tables.FEATURE_FLAG_CHANGES;
import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class FeatureFlagsTest {

    @Autowired FeatureFlags flags;
    @Autowired DSLContext db;
    @Autowired TestDb testDb;
    @Autowired StatementRecorder recorder;

    @BeforeEach
    void setUp() { testDb.reset(); }

    @Test
    void theRegistryAndTheTableAgree() {
        // reset() restored the migration's seeds, so this compares the enum with what Flyway created
        var keys = db.select(FEATURE_FLAGS.KEY).from(FEATURE_FLAGS).fetchSet(FEATURE_FLAGS.KEY);
        assertThat(keys).containsExactlyInAnyOrderElementsOf(Arrays.stream(Flag.values()).map(Flag::key).toList());
    }

    @Test
    void seedsAreAsDecided() {
        var seeded = db.select(FEATURE_FLAGS.KEY, FEATURE_FLAGS.ENABLED).from(FEATURE_FLAGS)
                       .fetchMap(FEATURE_FLAGS.KEY, FEATURE_FLAGS.ENABLED);
        assertThat(seeded).containsEntry("publisher_phone_otp", true).containsEntry("reverse_geocoding", false);
    }

    @Test
    void aWarmSnapshotExecutesNoSql() {
        flags.isEnabled(Flag.PUBLISHER_PHONE_OTP, null); // warm
        recorder.reset();
        for (int i = 0; i < 50; i++) {
            UUID person = UUID.randomUUID();
            flags.isEnabled(Flag.PUBLISHER_PHONE_OTP, person);
            flags.isEnabled(Flag.REVERSE_GEOCODING, person);
        }
        flags.isEnabled(Flag.REVERSE_GEOCODING, null);
        assertThat(recorder.statements()).isEmpty();
    }

    @Test
    void anonymousActorsGetTheGlobalValue() {
        assertThat(flags.isEnabled(Flag.PUBLISHER_PHONE_OTP, null)).isTrue();
        assertThat(flags.isEnabled(Flag.REVERSE_GEOCODING, null)).isFalse();
    }

    @org.junit.jupiter.api.Disabled("needs the person table — enabled in Task 7")
    @Test
    void anOverrideWinsInEitherDirection() {
        UUID ana = UUID.randomUUID();
        UUID other = UUID.randomUUID();
        insertPerson(ana);
        insertPerson(other);
        db.execute("INSERT INTO scuby.feature_flag_overrides (flag_key, person_id, enabled, reason) VALUES ('publisher_phone_otp', ?, false, 'test account')", ana);
        db.execute("INSERT INTO scuby.feature_flag_overrides (flag_key, person_id, enabled, reason) VALUES ('reverse_geocoding', ?, true, 'beta')", ana);
        assertThat(flags.isEnabled(Flag.PUBLISHER_PHONE_OTP, ana)).isFalse();
        assertThat(flags.isEnabled(Flag.REVERSE_GEOCODING, ana)).isTrue();
        assertThat(flags.isEnabled(Flag.PUBLISHER_PHONE_OTP, other)).isTrue();
    }

    @Test
    void aFlagMissingFromTheTableIsOff() {
        db.execute("DELETE FROM scuby.feature_flags WHERE key = 'publisher_phone_otp'");
        assertThat(flags.isEnabled(Flag.PUBLISHER_PHONE_OTP, null)).isFalse();
    }

    @Test
    void valuesAreCachedUntilCleared() {
        assertThat(flags.isEnabled(Flag.REVERSE_GEOCODING, null)).isFalse();
        db.execute("UPDATE scuby.feature_flags SET enabled = true WHERE key = 'reverse_geocoding'");
        assertThat(flags.isEnabled(Flag.REVERSE_GEOCODING, null)).isFalse();
        flags.clear();
        assertThat(flags.isEnabled(Flag.REVERSE_GEOCODING, null)).isTrue();
    }

    @Test
    void everyFlipIsRecordedWithWhoDidIt() {
        db.transaction(c -> {
            c.dsl().execute("SET LOCAL scuby.changed_by = 'alejo'");
            c.dsl().execute("UPDATE scuby.feature_flags SET enabled = false WHERE key = 'publisher_phone_otp'");
        });
        var change = db.selectFrom(FEATURE_FLAG_CHANGES).orderBy(FEATURE_FLAG_CHANGES.ID.desc()).limit(1).fetchOne();
        assertThat(change.getFlagKey()).isEqualTo("publisher_phone_otp");
        assertThat(change.getOld()).isTrue();
        assertThat(change.getNew()).isFalse();
        assertThat(change.getChangedBy()).isEqualTo("alejo");
    }

    private void insertPerson(UUID id) {
        db.execute("INSERT INTO scuby.person (id, display_name, email, created_at) VALUES (?, 'Test', ?, now())",
                id, id + "@flags.test");
    }
}
