package co.scuby.identity;

import co.scuby.support.ApiClients;
import co.scuby.support.ApiResponse;
import co.scuby.support.IntegrationTest;
import co.scuby.support.TestDb;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;

@IntegrationTest
class ConfigEndpointTest {

    @Autowired ApiClients clients;
    @Autowired TestDb testDb;
    @Autowired DSLContext db;
    @Autowired SupportedCountries countries;

    @BeforeEach
    void setUp() { testDb.reset(); }

    @Test
    void colombiaComesFromTheTable() {
        ApiResponse r = clients.newBrowser().get("/config");
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.str("/supported_countries/0/code")).isEqualTo("CO");
        assertThat(r.str("/supported_countries/0/phone_prefix")).isEqualTo("+57");
        assertThat(r.str("/supported_countries/0/mobile_pattern")).isEqualTo("^3\\d{9}$");
        assertThat(r.json().at("/supported_countries/0/default_center/lat").asDouble()).isEqualTo(6.2442);
    }

    @Test
    void aCountryIsOneRowAndZeroCode() {
        db.execute("""
                INSERT INTO scuby.supported_countries (code, phone_prefix, mobile_pattern, currency, locale, default_center_lat, default_center_lng, sort_order)
                VALUES ('EC', '+593', '^9\\d{8}$', 'USD', 'es-EC', -0.1807, -78.4678, 1)""");
        try {
            ApiResponse r = clients.newBrowser().get("/config");
            assertThat(r.json().get("supported_countries")).hasSize(2);
            assertThat(r.str("/supported_countries/1/code")).isEqualTo("EC");
            assertThat(countries.forE164("+593991234567")).get().extracting(SupportedCountries.Country::code).isEqualTo("EC");
            assertThat(countries.forE164("+573001234567")).get().extracting(SupportedCountries.Country::code).isEqualTo("CO");
            assertThat(countries.forE164("+12025550123")).isEmpty();
        } finally {
            db.execute("DELETE FROM scuby.supported_countries WHERE code = 'EC'");
        }
    }
}
