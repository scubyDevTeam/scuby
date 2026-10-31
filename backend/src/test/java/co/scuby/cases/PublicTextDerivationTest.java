package co.scuby.cases;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.util.List;
import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThat;

/** Display text the server composes (docs/eng/api.md · Language). Human review: the copy. */
class PublicTextDerivationTest {

    static final Locale ES = Locale.forLanguageTag("es");
    static final Locale EN = Locale.forLanguageTag("en");

    @ParameterizedTest
    @CsvSource({
            "Carolina Mejía, Carolina M.",
            "ana gomez ruiz, ana G.",
            "Carolina, Carolina",
            "'  Juan   Perez ', Juan P.",
    })
    void publicName(String displayName, String expected) {
        assertThat(PublicTextDerivation.publicName(displayName)).isEqualTo(expected);
    }

    @Test
    void placeNameIsTheStoredOneOrTheGenericLabelInTheRequestLanguage() {
        assertThat(PublicTextDerivation.placeName("Laureles", EN)).isEqualTo("Laureles");
        assertThat(PublicTextDerivation.placeName(null, ES)).isEqualTo("Zona marcada en el mapa");
        assertThat(PublicTextDerivation.placeName(null, EN)).isEqualTo("Area marked on the map");
        assertThat(PublicTextDerivation.placeName(null, Locale.FRENCH)).isEqualTo("Zona marcada en el mapa");
    }

    @Test
    void summaryAsTheMockComposesItAndInEnglish() {
        assertThat(PublicTextDerivation.summary("dog", "medium", List.of("brown"), ES)).isEqualTo("Perro · Mediano · Café");
        assertThat(PublicTextDerivation.summary("cat", "small", List.of("black", "tan"), ES)).isEqualTo("Gato · Pequeño · Negro y canela");
        assertThat(PublicTextDerivation.summary("other", null, List.of("white", "gray", "orange"), ES)).isEqualTo("Animal · Blanco, gris y naranja");
        assertThat(PublicTextDerivation.summary("dog", null, List.of(), ES)).isEqualTo("Perro");
        assertThat(PublicTextDerivation.summary("dog", "large", List.of("black", "tan"), EN)).isEqualTo("Dog · Large · Black and tan");
    }

    @Test
    void whatsappUrlDropsThePlus() {
        assertThat(PublicTextDerivation.whatsappUrl("+573007152284")).isEqualTo("https://wa.me/573007152284");
    }
}
