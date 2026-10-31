package co.scuby.pets;

import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import co.scuby.support.Accounts;
import co.scuby.support.IntegrationTest;
import co.scuby.support.MutableClock;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.UUID;

import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.RESPONSIBILITY_LINK;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@IntegrationTest
class PetsTest {

    @Autowired Pets pets;
    @Autowired Accounts accounts;
    @Autowired TestDb testDb;
    @Autowired DSLContext db;
    @Autowired TransactionTemplate tx;
    @Autowired MutableClock clock;

    static final Pets.NewPet KIRA = new Pets.NewPet("Kira", Pets.Species.dog, Pets.Size.medium,
            List.of(Pets.Color.brown), null, null, List.of());

    @BeforeEach
    void setUp() { testDb.reset(); }

    @Test
    void createsThePetAndTheOwnerLinkTogether() {
        UUID ana = accounts.person("ana@correo.co");
        UUID pet = tx.execute(s -> pets.createOwned(ana, KIRA));
        var row = db.selectFrom(PET).where(PET.ID.eq(pet)).fetchOne();
        assertThat(row.getName()).isEqualTo("Kira");
        assertThat(row.getSpecies()).isEqualTo("dog");
        assertThat(row.getSize()).isEqualTo("medium");
        assertThat(row.getPhotoUrls()).isEmpty();
        assertThat(row.getCreatedAt().toInstant()).isEqualTo(clock.instant());
        assertThat(row.getCustodyState()).isEqualTo("claimed");
        assertThat(row.getColors()).containsExactly("brown");
        var link = db.selectFrom(RESPONSIBILITY_LINK).where(RESPONSIBILITY_LINK.PET_ID.eq(pet)).fetchOne();
        assertThat(link.getPersonId()).isEqualTo(ana);
        assertThat(link.getRole()).isEqualTo("owner");
        assertThat(link.getActiveTo()).isNull();
        assertThat(link.getActiveFrom().toInstant()).isEqualTo(clock.instant());
    }

    @Test
    void createOwnedOutsideATransactionIsRefused() {
        UUID ana = accounts.person("ana@correo.co");
        assertThatThrownBy(() -> pets.createOwned(ana, KIRA)).isInstanceOf(IllegalTransactionStateException.class);
        assertThat(db.fetchCount(PET)).isZero();
    }

    @Test
    void aFormerOwnerGetsNotFoundAndANewOwnerCanBeLinked() {
        UUID ana = accounts.person("ana@correo.co");
        UUID bob = accounts.person("bob@correo.co");
        UUID pet = tx.execute(s -> pets.createOwned(ana, KIRA));
        db.execute("UPDATE scuby.responsibility_link SET active_to = now() WHERE pet_id = ?", pet);
        assertNotFound(() -> pets.requireOwnedBy(pet.toString(), ana));
        db.execute("INSERT INTO scuby.responsibility_link (id, person_id, pet_id, role, active_from) VALUES (gen_random_uuid(), ?, ?, 'owner', now())",
                bob, pet);
        assertThatCode(() -> pets.requireOwnedBy(pet.toString(), bob)).doesNotThrowAnyException();
    }

    private static void assertNotFound(org.assertj.core.api.ThrowableAssert.ThrowingCallable call) {
        assertThatThrownBy(call).isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).code()).isEqualTo(ErrorCode.NOT_FOUND));
    }

    @Test
    void ownershipIsCheckedAndAnythingElseIsNotFound() {
        UUID ana = accounts.person("ana@correo.co");
        UUID bob = accounts.person("bob@correo.co");
        UUID pet = tx.execute(s -> pets.createOwned(ana, KIRA));
        assertThatCode(() -> pets.requireOwnedBy(pet.toString(), ana)).doesNotThrowAnyException();
        assertNotFound(() -> pets.requireOwnedBy(pet.toString(), bob));
        assertNotFound(() -> pets.requireOwnedBy(UUID.randomUUID().toString(), ana));
        assertNotFound(() -> pets.requireOwnedBy("pet-1", ana));
    }

    @Test
    void aPetHasAtMostOneActiveOwner() {
        UUID ana = accounts.person("ana@correo.co");
        UUID bob = accounts.person("bob@correo.co");
        UUID pet = tx.execute(s -> pets.createOwned(ana, KIRA));
        assertThatThrownBy(() -> db.execute(
                "INSERT INTO scuby.responsibility_link (id, person_id, pet_id, role, active_from) VALUES (gen_random_uuid(), ?, ?, 'owner', now())",
                bob, pet)).hasMessageContaining("responsibility_link_one_active_owner");
    }

    @Test
    void repeatedColoursAreStoredOnce() {
        UUID ana = accounts.person("ana@correo.co");
        var repeated = new Pets.NewPet("Kira", Pets.Species.dog, Pets.Size.medium,
                List.of(Pets.Color.black, Pets.Color.tan, Pets.Color.black, Pets.Color.tan, Pets.Color.black), null, null, List.of());
        UUID pet = tx.execute(s -> pets.createOwned(ana, repeated));
        assertThat(db.selectFrom(PET).where(PET.ID.eq(pet)).fetchOne().getColors()).containsExactly("black", "tan");
    }

    @Test
    void theDatabaseRefusesMoreThanSevenColours() {
        UUID ana = accounts.person("ana@correo.co");
        String[] eight = {"black", "white", "brown", "tan", "gray", "yellow", "orange", "black"};
        assertThatThrownBy(() -> db.insertInto(PET)
                .set(PET.ID, UUID.randomUUID()).set(PET.NAME, "Kira").set(PET.SPECIES, "dog")
                .set(PET.COLORS, eight).set(PET.CUSTODY_STATE, "claimed")
                .set(PET.CREATED_AT, clock.instant().atOffset(java.time.ZoneOffset.UTC)).execute())
                .hasMessageContaining("pet_colors_check");
        String[] seven = {"black", "white", "brown", "tan", "gray", "yellow", "orange"};
        assertThatCode(() -> db.insertInto(PET)
                .set(PET.ID, UUID.randomUUID()).set(PET.NAME, "Kira").set(PET.SPECIES, "dog")
                .set(PET.COLORS, seven).set(PET.CUSTODY_STATE, "claimed")
                .set(PET.CREATED_AT, clock.instant().atOffset(java.time.ZoneOffset.UTC)).execute())
                .doesNotThrowAnyException();
    }
}
