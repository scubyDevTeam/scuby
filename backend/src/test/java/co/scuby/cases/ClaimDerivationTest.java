package co.scuby.cases;

import co.scuby.cases.ClaimDerivation.ContactFlags;
import co.scuby.cases.ClaimDerivation.SightingLink;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * «Lo tengo» rules (docs/product/04 · recovery_claim; spec §3, §4.9, §4.10, §4.13). Human review: these tables are the
 * rules — stale 7 days (strictly) after the claimant's last «Lo tengo», the owner-only badge, revisable answers, the 24 h
 * link to the claimant's own pin, the public-contact rule.
 */
class ClaimDerivationTest {

    static final Instant NOW = Instant.parse("2026-10-14T17:00:00Z");
    static final String A_DEVICE = "1".repeat(64);

    @ParameterizedTest(name = "{0} last active {1} ago → {2}")
    @CsvSource({
            "open,      PT1H,           open",
            "open,      P6D,            open",
            "open,      P7D,            open",
            "open,      PT168H0.001S,   stale",
            "open,      P30D,           stale",
            "confirmed, P30D,           confirmed",
            "dismissed, P30D,           dismissed",
    })
    void staleIsDerivedStrictlySevenDaysAfterTheLastActivityAndOnlyForOpenClaims(String stored, Duration idle, String wire) {
        assertThat(ClaimDerivation.wireStatus(stored, NOW.minus(idle), NOW)).isEqualTo(wire);
        assertThat(ClaimDerivation.isStale(stored, NOW.minus(idle), NOW)).isEqualTo("stale".equals(wire));
    }

    @Test
    void theSqlCutoffsMatchTheJavaRules() {
        // non-stale in SQL: last_active_at >= staleCutoff — the instant exactly 7 days ago is not stale in Java either
        assertThat(ClaimDerivation.staleCutoff(NOW)).isEqualTo(NOW.minus(Duration.ofDays(7)));
        assertThat(ClaimDerivation.isStale("open", ClaimDerivation.staleCutoff(NOW), NOW)).isFalse();
        // prefill in SQL: created_at > prefillCutoff — exclusive, like the 15-minute window
        assertThat(ClaimDerivation.prefillCutoff(NOW)).isEqualTo(NOW.minus(Duration.ofHours(24)));
        assertThat(ClaimDerivation.STALE_AFTER).isEqualTo(Duration.ofDays(7));
        assertThat(ClaimDerivation.PREFILL_WINDOW).isEqualTo(Duration.ofHours(24));
    }

    @ParameterizedTest(name = "owner={0} {1} open={2} → {3}")
    @CsvSource(nullValues = "null", value = {
            "true,  active,    2, 2",
            "true,  active,    0, 0",
            "true,  reunited,  3, 0",
            "true,  expired,   1, 0",
            "true,  cancelled, 1, 0",
            "false, active,    2, null",
            "false, active,    0, null",
            "false, reunited,  0, null",
    })
    void theBadgeIsOwnerOnlyAndCountsOnlyOnAnActiveCase(boolean owner, String caseStatus, int openNonStale, Integer expected) {
        assertThat(ClaimDerivation.openClaimCount(owner, caseStatus, openNonStale)).isEqualTo(expected);
    }

    @ParameterizedTest(name = "{0} → {1}: changes={2}")
    @CsvSource({
            "open,      confirmed, true",
            "open,      dismissed, true",
            "confirmed, dismissed, true",
            "dismissed, confirmed, true",
            "confirmed, confirmed, false",
            "dismissed, dismissed, false",
    })
    void answersAreRevisableAndARepeatChangesNothing(String stored, String requested, boolean changes) {
        assertThat(ClaimDerivation.answerChanges(stored, requested)).isEqualTo(changes);
    }

    @ParameterizedTest(name = "answer {0} → {1}")
    @CsvSource(nullValues = "null", value = {"confirmed, true", "dismissed, true", "open, false", "stale, false", "null, false", "'', false"})
    void onlyConfirmedOrDismissedIsAnAnswer(String value, boolean valid) {
        assertThat(ClaimDerivation.isAnswer(value)).isEqualTo(valid);
    }

    /**
     * Whether the claim keeps its from_sighting_id link (and copies the pin's point). Whose pin it is comes from the one
     * "mine" rule (LostCaseDerivation.mine, table-tested in LostCaseDerivationTest); an ineligible pin is ignored, never a
     * refusal of the claim.
     */
    @ParameterizedTest(name = "{0}")
    @CsvSource({
            // label,                     status,                mine,  age,         eligible
            "'mine, 1 h',                 visible,               true,  PT1H,        true",
            "'not mine',                  visible,               false, PT1H,        false",
            "'mine but hidden',           hidden_by_owner,       true,  PT1H,        false",
            "'mine but moderated',        removed_by_moderation, true,  PT1H,        false",
            "'mine but deleted',          deleted_by_reporter,   true,  PT1H,        false",
            "'mine, 23 h 59 min',         visible,               true,  PT23H59M,    true",
            "'mine, exactly 24 h',        visible,               true,  PT24H,       false",
            "'mine, 25 h',                visible,               true,  PT25H,       false",
    })
    void aClaimLinksOnlyTheCallersOwnRecentVisiblePin(String label, String status, boolean mine, Duration age, boolean eligible) {
        var pin = new SightingLink(status, null, A_DEVICE, NOW.minus(age));
        assertThat(ClaimDerivation.prefillEligible(pin, mine, NOW)).as(label).isEqualTo(eligible);
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource(nullValues = "null", value = {
            // label,                expose, hasWa, verified, inAppOnly, caseStatus, phone,          expected
            "'public',               true,   true,  true,     false,     active,     +573114829017,  +573114829017",
            "'not exposed',          false,  true,  true,     false,     active,     +573114829017,  null",
            "'not on WhatsApp',      true,   false, true,     false,     active,     +573114829017,  null",
            "'not verified',         true,   true,  false,    false,     active,     +573114829017,  null",
            "'only in the app',      true,   true,  true,     true,      active,     +573114829017,  null",
            "'case not active',      true,   true,  true,     false,     expired,    +573114829017,  null",
            "'number not loaded',    true,   true,  true,     false,     active,     null,           null",
    })
    void theOwnersNumberIsHandedOverOnlyUnderThePublicContactRule(String label, boolean expose, boolean hasWa, boolean verified,
                                                                   boolean inAppOnly, String caseStatus, String phone, String expected) {
        var flags = new ContactFlags(expose, hasWa, verified, inAppOnly);
        assertThat(ClaimDerivation.whatsappPhone(flags, caseStatus, phone)).as(label).isEqualTo(expected);
    }

    @Test
    void thePrefilledTextIsSpanishAndNamesThePetAndTheCode() {
        assertThat(ClaimDerivation.whatsappText("Luna", "7K3PQ"))
                .isEqualTo("Hola, vi tu aviso de Luna en Scuby (7K3PQ) y creo que lo tengo.");
        assertThat(ClaimDerivation.whatsappText(null, "7K3PQ")).isEqualTo("Hola, vi tu aviso en Scuby (7K3PQ) y creo que lo tengo.");
        assertThat(ClaimDerivation.whatsappText("  ", "7K3PQ")).isEqualTo("Hola, vi tu aviso en Scuby (7K3PQ) y creo que lo tengo.");
    }
}
