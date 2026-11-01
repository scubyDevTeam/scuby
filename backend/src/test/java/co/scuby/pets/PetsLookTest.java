package co.scuby.pets;

import co.scuby.platform.web.Patch;
import co.scuby.support.Accounts;
import co.scuby.support.CaseFixtures;
import co.scuby.support.IntegrationTest;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.UUID;

import static co.scuby.db.generated.Tables.PET;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Pets stays the only writer of pet: an edit of a lost case changes the shared pet through updateLook (spec §5). */
@IntegrationTest
class PetsLookTest {

    @Autowired Pets pets;
    @Autowired DSLContext db;
    @Autowired TransactionTemplate tx;
    @Autowired Accounts accounts;
    @Autowired CaseFixtures cases;

    UUID pet;

    @BeforeEach
    void setUp() {
        cases.luna(accounts.person("carolina@correo.co"));
        pet = cases.petOf("7K3PQ");
        db.update(PET).set(PET.MARKS, "Collar rojo").where(PET.ID.eq(pet)).execute();
    }

    private String marks() {
        return db.select(PET.MARKS).from(PET).where(PET.ID.eq(pet)).fetchOne(PET.MARKS);
    }

    private List<String> photos() {
        return List.of(db.select(PET.PHOTO_URLS).from(PET).where(PET.ID.eq(pet)).fetchOne(PET.PHOTO_URLS));
    }

    @Test
    void writesOnlyTheSentFields() {
        List<String> before = photos();
        tx.executeWithoutResult(s -> pets.updateLook(pet, new Pets.LookChange(null, Patch.of("Collar azul"))));
        assertThat(marks()).isEqualTo("Collar azul");
        assertThat(photos()).isEqualTo(before);
        tx.executeWithoutResult(s -> pets.updateLook(pet, new Pets.LookChange(List.of("http://x/1.jpg", "http://x/2.jpg"), Patch.absent())));
        assertThat(photos()).containsExactly("http://x/1.jpg", "http://x/2.jpg");
        assertThat(marks()).isEqualTo("Collar azul");
    }

    @Test
    void anExplicitNullClearsTheMarks() {
        tx.executeWithoutResult(s -> pets.updateLook(pet, new Pets.LookChange(null, Patch.of(null))));
        assertThat(marks()).isNull();
    }

    @Test
    void nothingSentIsNoStatement() {
        tx.executeWithoutResult(s -> pets.updateLook(pet, new Pets.LookChange(null, Patch.absent())));
        assertThat(marks()).isEqualTo("Collar rojo");
    }

    @Test
    void itNeedsTheCallersTransaction() {
        assertThatThrownBy(() -> pets.updateLook(pet, new Pets.LookChange(null, Patch.of("x"))))
                .isInstanceOf(IllegalTransactionStateException.class);
        assertThat(marks()).isEqualTo("Collar rojo");
    }
}
