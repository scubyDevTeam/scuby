package co.scuby.cases;

import co.scuby.pets.Pets;
import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.web.CodePoints;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.jspecify.annotations.Nullable;

import java.time.OffsetDateTime;
import java.util.List;

/** PublishLostRequest (web/src/contracts/owner.ts). */
record PublishLostRequest(
        @Nullable String petId,
        @NotNull @Valid PetInput pet,
        @NotNull @Valid PointInput lastSeenPoint,
        @NotNull @Positive @DecimalMax("5000") Double lastSeenRadiusM,
        @NotNull OffsetDateTime lastSeenAt,
        @Nullable @Pattern(regexp = "^\\+[1-9]\\d{6,14}$") String phone,
        @NotNull Boolean phoneHasWhatsapp,
        @NotNull @Valid ContactPrefs contactPrefs,
        @Nullable @Pattern(regexp = "^\\d{6}$") String otpCode) {

    record PetInput(@NotBlank @CodePoints(max = 60) String name,
                    @NotNull Pets.Species species,
                    @NotNull Pets.Size size,
                    @NotNull List<Pets.@NotNull Color> colors,
                    @Nullable @CodePoints(max = 500) String marks,
                    @Nullable @CodePoints(max = 40) String chipNumber,
                    @NotNull @Size(max = 6) List<@NotBlank String> photoUrls) {

        Pets.NewPet toNewPet() {
            return new Pets.NewPet(name, species, size, colors, marks, chipNumber, photoUrls);
        }
    }

    record ContactPrefs(@NotNull Boolean exposeWhatsapp, @NotNull Boolean exposeEmail, @NotNull Boolean inAppOnly) {}
}
