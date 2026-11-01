package co.scuby.cases;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** GET /me/pets (spec §4.11): a reopenable code only when there is no active case; nameless pets are "". */
class MyPetsDerivationTest {

    static final UUID PET = UUID.fromString("00000000-0000-0000-0000-0000000000e1");

    static MyPetRow row(String name, String active, String reopenable) {
        return new MyPetRow(PET, name, "dog", "small", List.of("black", "tan"), "Collar rojo", List.of("http://x/a.jpg"), active, reopenable);
    }

    @ParameterizedTest(name = "active={0} latestReopenable={1} → active={0} reopenable={2}")
    @CsvSource(nullValues = "null", value = {
            "7K3PQ, EXP22, null",
            "7K3PQ, null,  null",
            "null,  EXP22, EXP22",
            "null,  null,  null",
    })
    void anActiveCaseHidesTheReopenableOne(String active, String latestReopenable, String reopenable) {
        MyPetView v = MyPetsDerivation.derive(List.of(row("Luna", active, latestReopenable))).getFirst();
        assertThat(v.activeCaseCode()).isEqualTo(active);
        assertThat(v.reopenableCaseCode()).isEqualTo(reopenable);
    }

    @Test
    void thePetFieldsPassThroughAndANamelessPetIsAnEmptyString() {
        MyPetView named = MyPetsDerivation.derive(List.of(row("Luna", null, null))).getFirst();
        assertThat(named.id()).isEqualTo(PET.toString());
        assertThat(named.name()).isEqualTo("Luna");
        assertThat(named.species()).isEqualTo("dog");
        assertThat(named.size()).isEqualTo("small");
        assertThat(named.colors()).containsExactly("black", "tan");
        assertThat(named.marks()).isEqualTo("Collar rojo");
        assertThat(named.photoUrls()).containsExactly("http://x/a.jpg");
        assertThat(MyPetsDerivation.derive(List.of(row(null, null, null))).getFirst().name()).isEqualTo("");
    }

    @Test
    void theQueryOrderIsKept() {
        var a = new MyPetRow(UUID.fromString("00000000-0000-0000-0000-00000000000a"), "A", "cat", null, List.of(), null, List.of(), null, null);
        var b = new MyPetRow(UUID.fromString("00000000-0000-0000-0000-00000000000b"), "B", "dog", null, List.of(), null, List.of(), null, null);
        assertThat(MyPetsDerivation.derive(List.of(b, a))).extracting(MyPetView::name).containsExactly("B", "A");
        assertThat(MyPetsDerivation.derive(List.of())).isEmpty();
    }
}
