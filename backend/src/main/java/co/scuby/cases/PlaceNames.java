package co.scuby.cases;

import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.flags.FeatureFlags;
import co.scuby.platform.flags.Flag;
import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;

import java.util.UUID;

/** Computed once at publish and stored; null renders the generic label (PublicTextDerivation.placeName). */
@Component
class PlaceNames {

    private final PlaceNamer namer;
    private final FeatureFlags flags;

    PlaceNames(PlaceNamer namer, FeatureFlags flags) {
        this.namer = namer;
        this.flags = flags;
    }

    @Nullable String forNewCase(GeoPoint point, UUID publisher) {
        if (!flags.isEnabled(Flag.REVERSE_GEOCODING, publisher)) return null;
        return namer.nameFor(point).orElse(null);
    }
}
