package co.scuby.pets;

import co.scuby.platform.web.ApiException;
import co.scuby.support.Accounts;
import co.scuby.support.IntegrationTest;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
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
        assertThat(row.getCustodyState()).isEqualTo("claimed");
        assertThat(row.getColors()).containsExactly("brown");
        var link = db.selectFrom(RESPONSIBILITY_LINK).where(RESPONSIBILITY_LINK.PET_ID.eq(pet)).fetchOne();
        assertThat(link.getPersonId()).isEqualTo(ana);
        assertThat(link.getRole()).isEqualTo("owner");
        assertThat(link.getActiveTo()).isNull();
    }

    @Test
    void ownershipIsCheckedAndAnythingElseIsNotFound() {
        UUID ana = accounts.person("ana@correo.co");
        UUID bob = accounts.person("bob@correo.co");
        UUID pet = tx.execute(s -> pets.createOwned(ana, KIRA));
        assertThatCode(() -> pets.requireOwnedBy(pet.toString(), ana)).doesNotThrowAnyException();
        assertThatThrownBy(() -> pets.requireOwnedBy(pet.toString(), bob)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> pets.requireOwnedBy(UUID.randomUUID().toString(), ana)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> pets.requireOwnedBy("pet-1", ana)).isInstanceOf(ApiException.class);
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
}
