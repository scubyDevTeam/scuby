package co.scuby.identity;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;

class DisplayNamesTest {

    @ParameterizedTest
    @CsvSource({
            "juan.perez@correo.co, Juan Perez",
            "ana_gomez-ruiz@x.co, Ana Gomez Ruiz",
            "carolina@correo.co, Carolina",
            "...@x.co, ...",
    })
    void nameFromTheAddress(String email, String expected) {
        assertThat(DisplayNames.fromEmail(email)).isEqualTo(expected);
    }
}
