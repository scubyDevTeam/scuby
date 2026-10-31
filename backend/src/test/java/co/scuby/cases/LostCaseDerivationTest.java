package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Who sees what on a lost case (docs/product/04-lost-workflow.md · Location precision; docs/eng/api.md).
 * Human review: these tables are the rules.
 */
class LostCaseDerivationTest {

    static final Instant NOW = Instant.parse("2026-10-14T17:00:00Z");
    static final UUID OWNER = UUID.fromString("00000000-0000-0000-0000-00000000000a");
    static final UUID HELPER = UUID.fromString("00000000-0000-0000-0000-00000000000b");
    static final String MY_DEVICE = "1".repeat(64);
    static final String OTHER_DEVICE = "2".repeat(64);
    static final Locale ES = Locale.forLanguageTag("es");

    static LostCaseFacts.SightingFacts sighting(String id, Instant seenAt, Instant createdAt, UUID reporter, String device,
                                                String phone, boolean hidden) {
        return new LostCaseFacts.SightingFacts(UUID.fromString("00000000-0000-0000-0000-0000000000" + id),
                new GeoPoint(6.25, -75.59), seenAt, createdAt, null, List.of(), reporter, device, phone, hidden, false);
    }

    static final String WA = "+573114829017";

    /** whatsappPhone = what the query loads: the number only when it is public (LostCaseQueries.WHATSAPP_PHONE). */
    static LostCaseFacts facts(String status, double radius, String placeName, String name, String whatsappPhone,
                               List<LostCaseFacts.SightingFacts> sightings) {
        return new LostCaseFacts("7K3PQ", status, "active".equals(status) ? null : NOW, OWNER,
                new LostCaseFacts.PetFacts(name, "dog", "small", List.of("black"), null, List.of()),
                new GeoPoint(6.2442, -75.5812), radius, NOW.minus(Duration.ofDays(2)), placeName,
                "Carolina Mejía", whatsappPhone, sightings);
    }

    static LostCaseFacts luna(List<LostCaseFacts.SightingFacts> sightings) {
        return facts("active", 100, null, "Luna", WA, sightings);
    }

    static final Viewer OWNER_VIEW = new Viewer(Access.OWNER, OWNER, OTHER_DEVICE);
    static final Viewer STRANGER = new Viewer(Access.PUBLIC, null, MY_DEVICE);

    @ParameterizedTest(name = "radius {0}, {1} → {2}")
    @CsvSource({
            "100,  OWNER,  100",
            "100,  PUBLIC, 200",
            "200,  PUBLIC, 200",
            "350,  PUBLIC, 350",
            "5000, PUBLIC, 5000",
            "50,   OWNER,  50",
    })
    void thePublicRadiusIsFlooredAt200AndTheCenterNeverMoves(double stored, Access access, double expected) {
        Viewer v = access == Access.OWNER ? OWNER_VIEW : STRANGER;
        LostCaseView view = LostCaseDerivation.derive(facts("active", stored, null, "Luna", WA, List.of()), v, NOW, ES);
        assertThat(view.lastSeen().radiusM()).isEqualTo(expected);
        assertThat(view.lastSeen().center()).isEqualTo(new GeoPoint(6.2442, -75.5812));
        assertThat(view.viewer()).isEqualTo(access == Access.OWNER ? "owner" : "public");
    }

    @Test
    void aStrangerGetsNoHiddenPinsAndNoReportersNumbersEvenIfTheFactsHadThem() {
        var facts = luna(List.of(
                sighting("01", NOW.minusSeconds(7200), NOW.minusSeconds(7200), HELPER, OTHER_DEVICE, "+573001112233", false),
                sighting("02", NOW.minusSeconds(3600), NOW.minusSeconds(3600), null, OTHER_DEVICE, "+573004445566", true)));
        LostCaseView view = LostCaseDerivation.derive(facts, STRANGER, NOW, ES);
        assertThat(view.sightings()).hasSize(1);
        assertThat(view.sightings()).allSatisfy(s -> {
            assertThat(s.contactPhone()).isNull();
            assertThat(s.hidden()).isFalse();
        });
        assertThat(view.claims()).isEmpty();
        assertThat(view.pendingCheckin()).isNull();
        assertThat(view.openClaimCount()).isZero();
    }

    @Test
    void theOwnerGetsHiddenPinsFlaggedAndReportersNumbers() {
        var facts = luna(List.of(
                sighting("01", NOW.minusSeconds(7200), NOW.minusSeconds(7200), HELPER, OTHER_DEVICE, "+573001112233", false),
                sighting("02", NOW.minusSeconds(3600), NOW.minusSeconds(3600), null, OTHER_DEVICE, null, true)));
        LostCaseView view = LostCaseDerivation.derive(facts, OWNER_VIEW, NOW, ES);
        assertThat(view.sightings()).extracting(LostCaseView.SightingView::hidden).containsExactly(false, true);
        assertThat(view.sightings().getFirst().contactPhone()).isEqualTo("+573001112233");
        assertThat(view.sightings()).extracting(LostCaseView.SightingView::source).containsExactly("registered", "anonymous");
    }

    @Test
    void sightingsComeOldestFirst() {
        var facts = luna(List.of(
                sighting("03", NOW.minusSeconds(60), NOW.minusSeconds(60), null, OTHER_DEVICE, null, false),
                sighting("01", NOW.minusSeconds(9000), NOW.minusSeconds(9000), null, OTHER_DEVICE, null, false),
                sighting("02", NOW.minusSeconds(3000), NOW.minusSeconds(3000), null, OTHER_DEVICE, null, false)));
        assertThat(LostCaseDerivation.derive(facts, STRANGER, NOW, ES).sightings())
                .extracting(s -> s.id().substring(34)).containsExactly("01", "02", "03");
    }

    @ParameterizedTest(name = "{0}")
    @CsvSource({
            // case,                               reporterIsMe, sameDevice, createdMinutesAgo, hidden, mine,  editable
            "'my device, 5 min ago',               false,        true,       5,                 false,  true,  true",
            "'my account, other device',           true,         false,      5,                 false,  true,  true",
            "'mine, exactly 15 min ago',           false,        true,       15,                false,  true,  false",
            "'mine, 16 min ago',                   false,        true,       16,                false,  true,  false",
            "'mine but hidden by the owner',       false,        true,       5,                 true,   true,  false",
            "'someone else',                       false,        false,      5,                 false,  false, false",
    })
    void mineAndTheCorrectionWindow(String label, boolean reporterIsMe, boolean sameDevice, int minutesAgo,
                                    boolean hidden, boolean mine, boolean editable) {
        Instant created = NOW.minus(Duration.ofMinutes(minutesAgo));
        var s = sighting("01", created, created, reporterIsMe ? HELPER : null, sameDevice ? MY_DEVICE : OTHER_DEVICE, null, hidden);
        // A hidden pin reaches only the owner: in that row the viewer is the owner (but not the reporter).
        Viewer me = new Viewer(hidden ? Access.OWNER : Access.PUBLIC, HELPER, MY_DEVICE);
        var view = LostCaseDerivation.derive(luna(List.of(s)), me, NOW, ES).sightings().getFirst();
        assertThat(view.mine()).isEqualTo(mine);
        assertThat(view.editableUntil()).isEqualTo(editable ? created.plus(Duration.ofMinutes(15)) : null);
    }

    @ParameterizedTest(name = "status={0} whatsappPhone={1}")
    @CsvSource(nullValues = "null", value = {
            "active,    +573114829017, https://wa.me/573114829017",
            "active,    null,          null",
    })
    void contactWhileActive(String status, String whatsappPhone, String url) {
        var view = LostCaseDerivation.derive(facts(status, 100, null, "Luna", whatsappPhone, List.of()), STRANGER, NOW, ES);
        assertThat(view.contact().displayName()).isEqualTo("Carolina M.");
        assertThat(view.contact().whatsappUrl()).isEqualTo(url);
    }

    @Test
    void anUnnamedPublisherShowsTheGenericNameNotAnythingFromTheirEmail() {
        var unnamed = new LostCaseFacts("7K3PQ", "active", null, OWNER,
                new LostCaseFacts.PetFacts("Luna", "dog", "small", List.of("black"), null, List.of()),
                new GeoPoint(6.2442, -75.5812), 100, NOW, null, null, WA, List.of());
        assertThat(LostCaseDerivation.derive(unnamed, STRANGER, NOW, ES).contact().displayName()).isEqualTo("Alguien");
        assertThat(LostCaseDerivation.derive(unnamed, STRANGER, NOW, java.util.Locale.ENGLISH).contact().displayName()).isEqualTo("Someone");
    }

    @Test
    void noContactOnceTheCaseIsClosedAndTheResolutionTimeShows() {
        var view = LostCaseDerivation.derive(facts("reunited", 100, null, "Toby", null, List.of()), STRANGER, NOW, ES);
        assertThat(view.contact()).isNull();
        assertThat(view.status()).isEqualTo("reunited");
        assertThat(view.resolvedAt()).isEqualTo(NOW);
    }

    @Test
    void textFieldsAndDefaults() {
        var view = LostCaseDerivation.derive(facts("active", 100, null, null, WA, List.of()), STRANGER, NOW, ES);
        assertThat(view.pet().name()).isEqualTo("");
        assertThat(view.lastSeen().placeName()).isEqualTo("Zona marcada en el mapa");
        assertThat(view.vertical()).isEqualTo("lost");
        assertThat(view.code()).isEqualTo("7K3PQ");
        var named = LostCaseDerivation.derive(facts("active", 100, "Laureles", "Luna", WA, List.of()), STRANGER, NOW, ES);
        assertThat(named.lastSeen().placeName()).isEqualTo("Laureles");
    }

    @Test
    void theDerivationDoesNotChangeItsInput() {
        var list = new ArrayList<>(List.of(sighting("02", NOW, NOW, null, OTHER_DEVICE, null, false),
                sighting("01", NOW.minusSeconds(5), NOW.minusSeconds(5), null, OTHER_DEVICE, null, false)));
        LostCaseDerivation.derive(luna(list), STRANGER, NOW, ES);
        assertThat(list.getFirst().id().toString()).endsWith("02");
    }
}
