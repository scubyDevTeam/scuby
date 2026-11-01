package co.scuby.cases;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThat;

/** «Mis casos» items (contract MyCases; web/src/mocks/serialize.ts · myCasesView). Human review: the defaults. */
class MyCasesDerivationTest {

    static final Instant T = Instant.parse("2026-10-14T13:00:00Z");
    static final Locale ES = Locale.forLanguageTag("es");
    static final Locale EN = Locale.forLanguageTag("en");

    @Test
    void aNamedPetWithAPhotoAndAStoredPlace() {
        var row = new MyCaseRow("7K3PQ", "active", T, "Laureles", "Luna", "cat", "small", List.of("black"), "http://x/a.jpg", 0);
        MyCaseView v = MyCasesDerivation.derive(List.of(row), ES).getFirst();
        assertThat(v.code()).isEqualTo("7K3PQ");
        assertThat(v.vertical()).isEqualTo("lost");
        assertThat(v.status()).isEqualTo("active");
        assertThat(v.title()).isEqualTo("Luna");
        assertThat(v.placeName()).isEqualTo("Laureles");
        assertThat(v.photoUrl()).isEqualTo("http://x/a.jpg");
        assertThat(v.publishedAt()).isEqualTo(T);
        assertThat(v.openClaimCount()).isZero();
        assertThat(v.pendingCheckinAt()).isNull();
    }

    @Test
    void anUnnamedPetGetsTheLookTitleAndNoPlaceTheGenericLabel() {
        var row = new MyCaseRow("H4PPY", "reunited", T, null, null, "dog", "small", List.of("black", "tan"), null, 0);
        MyCaseView v = MyCasesDerivation.derive(List.of(row), ES).getFirst();
        assertThat(v.title()).isEqualTo("Perro negro, pequeño");
        assertThat(v.placeName()).isEqualTo("Zona marcada en el mapa");
        assertThat(v.photoUrl()).isNull();
        assertThat(v.status()).isEqualTo("reunited");
    }

    @Test
    void theLanguageOfTheRequestDecidesTheGeneratedText() {
        var row = new MyCaseRow("H4PPY", "active", T, null, null, "dog", "small", List.of("black"), null, 0);
        MyCaseView v = MyCasesDerivation.derive(List.of(row), EN).getFirst();
        assertThat(v.title()).isEqualTo("Dog black, small");
        assertThat(v.placeName()).isEqualTo("Area marked on the map");
    }

    @Test
    void theQueryOrderIsKept() {
        var a = new MyCaseRow("AAAAA", "active", T, null, "A", "dog", null, List.of(), null, 0);
        var b = new MyCaseRow("BBBBB", "expired", T.minusSeconds(60), null, "B", "dog", null, List.of(), null, 0);
        assertThat(MyCasesDerivation.derive(List.of(a, b), ES)).extracting(MyCaseView::code).containsExactly("AAAAA", "BBBBB");
        assertThat(MyCasesDerivation.derive(List.of(b, a), ES)).extracting(MyCaseView::code).containsExactly("BBBBB", "AAAAA");
        assertThat(MyCasesDerivation.derive(List.of(), ES)).isEmpty();
    }

    @Test
    void theOpenClaimCountComesFromTheRow() {
        var row = new MyCaseRow("7K3PQ", "active", T, null, "Luna", "cat", "small", List.of(), null, 2);
        assertThat(MyCasesDerivation.derive(List.of(row), ES).getFirst().openClaimCount()).isEqualTo(2);
    }
}
