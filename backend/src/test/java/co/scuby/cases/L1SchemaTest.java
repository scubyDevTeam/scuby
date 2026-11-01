package co.scuby.cases;

import co.scuby.support.Accounts;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The L1 schema rules hold in the database whatever the code does (spec 2026-11-01-lost-vertical-l1-design §2).
 * Raw SQL on purpose: the rule under test is the constraint, not a query builder. Every refusal names its
 * constraint, so a dropped or renamed CHECK fails here.
 */
@IntegrationTest
class L1SchemaTest {

    @Autowired DSLContext db;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;

    UUID owner;
    UUID claimant;
    UUID sighting;

    @BeforeEach
    void setUp() {
        owner = accounts.person("carolina@correo.co");
        claimant = accounts.person("andres@correo.co");
        cases.luna(owner);
        sighting = cases.sighting("7K3PQ", CaseFixtures.MEDELLIN, MutableClock.START, MutableClock.START, claimant,
                "c".repeat(64), null, "visible");
    }

    private void setCase(String assignments) {
        db.execute("UPDATE scuby.lost_case SET " + assignments + " WHERE code = '7K3PQ'");
    }

    private Object caseColumn(String column) {
        return db.fetchValue("SELECT " + column + " FROM scuby.lost_case WHERE code = '7K3PQ'");
    }

    // --- lost_case (spec §2.1) ---

    @Test
    void aReunitedCaseTakesReunitedHomeAndAnAttribution() {
        setCase("status = 'reunited', resolved_at = now(), resolution = 'reunited_home', resolution_attribution = 'offline'");
        assertThat(caseColumn("resolution")).isEqualTo("reunited_home");
        assertThat(caseColumn("resolution_attribution")).isEqualTo("offline");
    }

    @ParameterizedTest
    @CsvSource({"false_alarm", "duplicate"})
    void aCancelledCaseTakesFalseAlarmOrDuplicate(String resolution) {
        setCase("status = 'cancelled', resolved_at = now(), resolution = '" + resolution + "'");
        assertThat(caseColumn("resolution")).isEqualTo(resolution);
    }

    @ParameterizedTest(name = "{0} + {1}")
    @CsvSource({
            "reunited,  false_alarm",
            "reunited,  duplicate",
            "cancelled, reunited_home",
            "expired,   no_response",
            "expired,   reunited_home",
            "reunited,  found_deceased",
    })
    void aResolutionThatDoesNotFitTheStatusIsRefused(String status, String resolution) {
        assertThatThrownBy(() -> setCase("status = '" + status + "', resolved_at = now(), resolution = '" + resolution + "'"))
                .hasStackTraceContaining("lost_case_resolution_fits_status");
        assertThat(caseColumn("status")).isEqualTo("active");
    }

    @Test
    void anAttributionOnlyGoesWithAReunion() {
        assertThatThrownBy(() -> setCase("status = 'cancelled', resolved_at = now(), resolution = 'duplicate', resolution_attribution = 'offline'"))
                .hasStackTraceContaining("lost_case_attribution_only_reunited");
        assertThatThrownBy(() -> setCase("resolution_attribution = 'unknown'"))
                .hasStackTraceContaining("lost_case_attribution_only_reunited");
    }

    @Test
    void anUnknownAttributionValueIsRefused() {
        assertThatThrownBy(() -> setCase("status = 'reunited', resolved_at = now(), resolution = 'reunited_home', resolution_attribution = 'luck'"))
                .hasStackTraceContaining("lost_case_resolution_attribution_check");
    }

    @Test
    void anActiveCaseCarriesNoResolvedAt() {
        assertThatThrownBy(() -> setCase("resolved_at = now()")).hasStackTraceContaining("lost_case_active_is_unresolved");
    }

    @Test
    void aClosedRowWithoutResolutionStaysValidForRowsWrittenBeforeTheMigration() {
        setCase("status = 'expired', resolved_at = now()");
        assertThat(caseColumn("resolution")).isNull();
    }

    // --- sighting (spec §2.2) ---

    @Test
    void aSightingMayBeDeletedByItsReporterButNotGivenAnUnknownStatus() {
        db.execute("UPDATE scuby.sighting SET status = 'deleted_by_reporter' WHERE id = ?", sighting);
        assertThat(db.fetchValue("SELECT status FROM scuby.sighting WHERE id = ?", sighting)).isEqualTo("deleted_by_reporter");
        assertThatThrownBy(() -> db.execute("UPDATE scuby.sighting SET status = 'erased' WHERE id = ?", sighting))
                .hasStackTraceContaining("sighting_status_check");
    }

    // --- recovery_claim (spec §2.3) ---

    private void claim(UUID person, String status, String answeredAt) {
        db.execute("INSERT INTO scuby.recovery_claim (id, case_code, claimant_person_id, phone, status, created_at, last_active_at, answered_at) "
                + "VALUES (gen_random_uuid(), '7K3PQ', ?, '+573001112233', ?, now(), now(), " + answeredAt + ")", person, status);
    }

    @Test
    void aClaimAlwaysCarriesWhenItWasLastActive() {
        assertThatThrownBy(() -> db.execute("INSERT INTO scuby.recovery_claim (id, case_code, claimant_person_id, phone, status, created_at) "
                + "VALUES (gen_random_uuid(), '7K3PQ', ?, '+573001112233', 'open', now())", claimant))
                .hasStackTraceContaining("null value in column \"last_active_at\"");
        assertThat(db.fetchCount(co.scuby.db.generated.Tables.RECOVERY_CLAIM)).isZero();
    }

    @Test
    void onePersonHasAtMostOneOpenClaimPerCase() {
        claim(claimant, "open", "NULL");
        assertThatThrownBy(() -> claim(claimant, "open", "NULL")).hasStackTraceContaining("recovery_claim_one_open_per_claimant");
        claim(owner, "open", "NULL");                                  // another person: allowed (the owner check is the service's)
        assertThat(db.fetchCount(co.scuby.db.generated.Tables.RECOVERY_CLAIM)).isEqualTo(2);
    }

    @Test
    void anAnsweredClaimFreesTheSlotForANewOpenOne() {
        claim(claimant, "dismissed", "now()");
        claim(claimant, "confirmed", "now()");
        claim(claimant, "open", "NULL");
        assertThat(db.fetchCount(co.scuby.db.generated.Tables.RECOVERY_CLAIM)).isEqualTo(3);
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(delimiter = '|', quoteCharacter = '"', value = {   // '"' so the SQL single quotes stay literal
            "open with answered_at      | status, answered_at | 'open', now()                   | recovery_claim_answered_when_not_open",
            "confirmed without answer   | status, answered_at | 'confirmed', NULL               | recovery_claim_answered_when_not_open",
            "stale is never stored      | status, answered_at | 'stale', now()                  | recovery_claim_status_check",
            "lat without lng            | lat                 | 6.25                            | recovery_claim_point_both_or_none",
            "lat out of range           | lat, lng            | 91, 0                           | recovery_claim_lat_check",
            "six photos                 | photo_urls          | '{a,b,c,d,e,f}'                 | recovery_claim_photo_urls_check",
            "not E.164                  | phone               | '3001112233'                    | recovery_claim_phone_check",
    })
    void aClaimRowThatBreaksARuleIsRefused(String label, String columns, String values, String constraint) {
        String sql = "INSERT INTO scuby.recovery_claim (id, case_code, claimant_person_id, created_at, last_active_at, "
                + (columns.contains("phone") ? "" : "phone, ") + (columns.contains("status") ? "" : "status, ") + columns + ") "
                + "VALUES (gen_random_uuid(), '7K3PQ', ?, now(), now(), "
                + (columns.contains("phone") ? "" : "'+573001112233', ") + (columns.contains("status") ? "" : "'open', ") + values + ")";
        assertThatThrownBy(() -> db.execute(sql, claimant)).as(label).hasStackTraceContaining(constraint);
        assertThat(db.fetchCount(co.scuby.db.generated.Tables.RECOVERY_CLAIM)).isZero();
    }

    @Test
    void aClaimMustBeOnAnExistingCaseAndMayPointAtASighting() {
        assertThatThrownBy(() -> db.execute("INSERT INTO scuby.recovery_claim (id, case_code, claimant_person_id, phone, status, created_at, last_active_at) "
                + "VALUES (gen_random_uuid(), 'ZZZZZ', ?, '+573001112233', 'open', now(), now())", claimant))
                .hasStackTraceContaining("recovery_claim_case_code_fkey");
        db.execute("INSERT INTO scuby.recovery_claim (id, case_code, claimant_person_id, phone, lat, lng, from_sighting_id, status, created_at, last_active_at) "
                + "VALUES (gen_random_uuid(), '7K3PQ', ?, '+573001112233', 6.25, -75.59, ?, 'open', now(), now())", claimant, sighting);
        assertThat(db.fetchValue("SELECT from_sighting_id FROM scuby.recovery_claim")).isEqualTo(sighting);
        assertThat(db.fetchValue("SELECT photo_urls::text FROM scuby.recovery_claim")).isEqualTo("{}");
    }

    // --- person.city (spec §2.5) ---

    @Test
    void aCityIsAtMost80CharactersCountedLikePostgres() {
        db.execute("UPDATE scuby.person SET city = ? WHERE id = ?", "🐶".repeat(80), owner);   // 80 characters, 160 UTF-16 units
        assertThat(db.fetchValue("SELECT length(city) FROM scuby.person WHERE id = ?", owner)).isEqualTo(80);
        assertThatThrownBy(() -> db.execute("UPDATE scuby.person SET city = ? WHERE id = ?", "a".repeat(81), owner))
                .hasStackTraceContaining("person_city_length");
    }
}
