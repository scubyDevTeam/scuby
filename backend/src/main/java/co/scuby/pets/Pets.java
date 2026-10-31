package co.scuby.pets;

import co.scuby.platform.modules.ModuleApi;
import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import static co.scuby.db.generated.Tables.PET;
import static co.scuby.db.generated.Tables.RESPONSIBILITY_LINK;

/** The only writer of `pet` and `responsibility_link`. Enum constants are the wire values. */
@ModuleApi
@Component
public class Pets {

    public enum Species { dog, cat, other }

    public enum Size { small, medium, large }

    public enum Color { black, white, brown, tan, gray, yellow, orange }

    public record NewPet(String name, Species species, @Nullable Size size, List<Color> colors,
                         @Nullable String marks, @Nullable String chipNumber, List<String> photoUrls) {}

    private final DSLContext db;
    private final Clock clock;

    Pets(DSLContext db, Clock clock) {
        this.db = db;
        this.clock = clock;
    }

    /** The pet and its active owner link, in the caller's transaction (04 · Publishing: one transaction). */
    @Transactional(propagation = Propagation.MANDATORY)
    public UUID createOwned(UUID ownerPersonId, NewPet pet) {
        UUID id = UUID.randomUUID();
        OffsetDateTime now = clock.instant().atOffset(ZoneOffset.UTC);
        db.insertInto(PET)
          .set(PET.ID, id)
          .set(PET.NAME, pet.name())
          .set(PET.SPECIES, pet.species().name())
          .set(PET.SIZE, pet.size() == null ? null : pet.size().name())
          .set(PET.COLORS, pet.colors().stream().distinct().map(Enum::name).toArray(String[]::new))
          .set(PET.MARKS, pet.marks())
          .set(PET.CHIP_NUMBER, pet.chipNumber())
          .set(PET.PHOTO_URLS, pet.photoUrls().toArray(String[]::new))
          .set(PET.CUSTODY_STATE, "claimed")
          .set(PET.CREATED_AT, now)
          .execute();
        db.insertInto(RESPONSIBILITY_LINK)
          .set(RESPONSIBILITY_LINK.ID, UUID.randomUUID())
          .set(RESPONSIBILITY_LINK.PERSON_ID, ownerPersonId)
          .set(RESPONSIBILITY_LINK.PET_ID, id)
          .set(RESPONSIBILITY_LINK.ROLE, "owner")
          .set(RESPONSIBILITY_LINK.ACTIVE_FROM, now)
          .execute();
        return id;
    }

    /** not_found unless the person is the pet's active owner (the contract's publishLost not_found). */
    public void requireOwnedBy(String petId, UUID personId) {
        UUID id;
        try {
            id = UUID.fromString(petId);
        } catch (IllegalArgumentException e) {
            throw new ApiException(ErrorCode.NOT_FOUND, "no such pet");
        }
        boolean owned = db.fetchExists(RESPONSIBILITY_LINK,
                RESPONSIBILITY_LINK.PET_ID.eq(id),
                RESPONSIBILITY_LINK.PERSON_ID.eq(personId),
                RESPONSIBILITY_LINK.ROLE.eq(DSL.inline("owner")),
                RESPONSIBILITY_LINK.ACTIVE_TO.isNull());
        if (!owned) throw new ApiException(ErrorCode.NOT_FOUND, "no such pet");
    }
}
