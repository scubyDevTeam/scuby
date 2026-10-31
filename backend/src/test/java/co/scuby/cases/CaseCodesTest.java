package co.scuby.cases;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class CaseCodesTest {

    @Test
    void lookupsUpperCaseAndAcceptAnyFiveAlphanumerics() {
        assertThat(CaseCodes.normalize("7k3pq")).contains("7K3PQ");
        // The mock's purged fixture GONE5 has an O, which new codes never use: lookups must still
        // accept it so it can answer `gone`. Only generation is restricted to the alphabet.
        assertThat(CaseCodes.normalize("gone5")).contains("GONE5");
        assertThat(CaseCodes.normalize("7K3P")).isEmpty();
        assertThat(CaseCodes.normalize("7K3PQ1")).isEmpty();
        assertThat(CaseCodes.normalize("../x")).isEmpty();
    }

    @Test
    void theAlphabetHasNoAmbiguousCharacters() {
        assertThat(CaseCodes.ALPHABET).doesNotContain("0", "1", "I", "L", "O").hasSize(31);
    }
}
