package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.flags.FeatureFlags;
import co.scuby.platform.flags.Flag;
import org.junit.jupiter.api.Test;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PlaceNamesTest {

    static final GeoPoint LAURELES = new GeoPoint(6.2447, -75.5916);

    @Test
    void flagOffStoresNothingSoTheGenericLabelRenders() {
        FeatureFlags flags = mock(FeatureFlags.class);
        when(flags.isEnabled(eq(Flag.REVERSE_GEOCODING), any())).thenReturn(false);
        assertThat(new PlaceNames(p -> Optional.of("Laureles"), flags).forNewCase(LAURELES, UUID.randomUUID())).isNull();
    }

    @Test
    void flagOnStoresWhatTheNamerSays() {
        FeatureFlags flags = mock(FeatureFlags.class);
        when(flags.isEnabled(eq(Flag.REVERSE_GEOCODING), any())).thenReturn(true);
        assertThat(new PlaceNames(p -> Optional.of("Laureles"), flags).forNewCase(LAURELES, UUID.randomUUID())).isEqualTo("Laureles");
        assertThat(new PlaceNames(p -> Optional.empty(), flags).forNewCase(LAURELES, UUID.randomUUID())).isNull();
    }
}
