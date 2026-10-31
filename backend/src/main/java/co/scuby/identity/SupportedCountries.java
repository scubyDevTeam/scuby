package co.scuby.identity;

import co.scuby.platform.db.GeoPoint;
import co.scuby.platform.modules.ModuleApi;
import org.jooq.DSLContext;
import org.springframework.stereotype.Component;

import java.util.Comparator;
import java.util.List;
import java.util.Optional;

import static co.scuby.db.generated.Tables.SUPPORTED_COUNTRIES;

/** The supported_countries table (docs/eng/auth.md · Country is configuration). Small and static: read per call. */
@ModuleApi
@Component
public class SupportedCountries {

    @ModuleApi
    public record Country(String code, String phonePrefix, String mobilePattern, GeoPoint defaultCenter) {}

    private final DSLContext db;

    SupportedCountries(DSLContext db) {
        this.db = db;
    }

    public List<Country> all() {
        return db.selectFrom(SUPPORTED_COUNTRIES)
                 .orderBy(SUPPORTED_COUNTRIES.SORT_ORDER, SUPPORTED_COUNTRIES.CODE)
                 .fetch(r -> new Country(r.getCode(), r.getPhonePrefix(), r.getMobilePattern(),
                         new GeoPoint(r.getDefaultCenterLat(), r.getDefaultCenterLng())));
    }

    /**
     * The country whose prefix starts this E.164 number. phone_prefix is not unique (+1, +7 are shared), so the
     * choice is explicit: the longest matching prefix, then the lowest sort_order, then the code. The list is
     * already ordered by sort_order and code, and the sort below is stable.
     */
    public Optional<Country> forE164(String e164) {
        return all().stream()
                    .filter(c -> e164.startsWith(c.phonePrefix()))
                    .sorted(Comparator.comparingInt((Country c) -> c.phonePrefix().length()).reversed())
                    .findFirst();
    }
}
