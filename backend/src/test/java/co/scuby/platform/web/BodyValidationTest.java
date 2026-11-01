package co.scuby.platform.web;

import jakarta.validation.Valid;
import jakarta.validation.Validation;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class BodyValidationTest {

    record Point(@NotNull Double lat, @NotNull Double lng) {}

    record Body(@NotNull @Valid Point lastSeenPoint, @Size(max = 2) List<@NotBlank String> photoUrls) {}

    final BodyValidation validation = new BodyValidation(Validation.buildDefaultValidatorFactory().getValidator());

    @Test
    void aValidBodyPasses() {
        validation.require(new Body(new Point(1.0, 2.0), List.of("a")));
    }

    @Test
    void violationsAreValidationFailedNamedByWirePathWithoutListIndexes() {
        assertThatThrownBy(() -> validation.require(new Body(new Point(null, 2.0), List.of("a", " "))))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.code()).isEqualTo(ErrorCode.VALIDATION_FAILED);
                    @SuppressWarnings("unchecked")
                    var fields = (java.util.Map<String, String>) e.getBody().getProperties().get(ContractErrors.FIELDS);
                    assertThat(fields).containsOnlyKeys("last_seen_point.lat", "photo_urls");
                });
        assertThatThrownBy(() -> validation.require(new Body(null, List.of("a", "b", "c")))).isInstanceOf(ApiException.class);
    }
}
