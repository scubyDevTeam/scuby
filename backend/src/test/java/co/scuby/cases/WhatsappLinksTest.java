package co.scuby.cases;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class WhatsappLinksTest {

    @Test
    void theNumberWithoutItsPlusAndTheTextPercentEncodedWithSpacesAsPercent20() {
        assertThat(WhatsappLinks.withText("+573114829017", ClaimDerivation.whatsappText("Luna", "7K3PQ")))
                .isEqualTo("https://wa.me/573114829017?text=Hola%2C%20vi%20tu%20aviso%20de%20Luna%20en%20Scuby%20%287K3PQ%29%20y%20creo%20que%20lo%20tengo.");
    }

    @Test
    void aLiteralPlusAndAccentsSurviveTheEncoding() {
        assertThat(WhatsappLinks.withText("+573114829017", "Ñoño + 1")).isEqualTo("https://wa.me/573114829017?text=%C3%91o%C3%B1o%20%2B%201");
    }
}
