package co.scuby.identity;

import co.scuby.platform.db.GeoPoint;

import java.util.List;

/** GET /config (web/src/contracts/config.ts). */
record ConfigView(List<CountryView> supportedCountries) {

    record CountryView(String code, String phonePrefix, String mobilePattern, GeoPoint defaultCenter) {}

    static ConfigView of(List<SupportedCountries.Country> countries) {
        return new ConfigView(countries.stream()
                .map(c -> new CountryView(c.code(), c.phonePrefix(), c.mobilePattern(), c.defaultCenter()))
                .toList());
    }
}
