package co.scuby.identity;

import co.scuby.support.IntegrationTest;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * phone_prefix is not unique (several countries share +1 and +7), so the lookup must stay deterministic:
 * the longest matching prefix wins, then sort_order, then code. The extra rows live in a rolled-back transaction.
 */
@IntegrationTest
class SupportedCountriesTest {

    @Autowired SupportedCountries countries;
    @Autowired DSLContext db;
    @Autowired TransactionTemplate tx;

    private void country(String code, String prefix, int sortOrder) {
        db.execute("INSERT INTO scuby.supported_countries (code, phone_prefix, mobile_pattern, currency, locale, "
                + "default_center_lat, default_center_lng, sort_order) VALUES (?, ?, '^3\\d{9}$', 'USD', 'en', 0, 0, ?)",
                code, prefix, sortOrder);
    }

    private <T> T withCountries(Supplier<T> check) {
        return tx.execute(status -> {
            try {
                return check.get();
            } finally {
                status.setRollbackOnly();
            }
        });
    }

    @Test
    void colombiaMatchesItsPrefix() {
        assertThat(countries.forE164("+573007152284")).get().extracting(SupportedCountries.Country::code).isEqualTo("CO");
        assertThat(countries.forE164("+12025550123")).isEmpty();
    }

    @Test
    void severalCountriesOnOnePrefixPickTheLowestSortOrderThenTheCode() {
        String winner = withCountries(() -> {
            country("US", "+1", 5);
            country("CA", "+1", 7);
            country("BB", "+1", 7);
            return countries.forE164("+12025550123").orElseThrow().code();
        });
        assertThat(winner).isEqualTo("US");
        String tie = withCountries(() -> {
            country("CA", "+1", 7);
            country("BB", "+1", 7);
            return countries.forE164("+12025550123").orElseThrow().code();
        });
        assertThat(tie).isEqualTo("BB");
    }

    @Test
    void theLongestPrefixWinsWhateverTheSortOrder() {
        String winner = withCountries(() -> {
            country("US", "+1", 0);
            country("BS", "+1242", 9);
            return countries.forE164("+12425550100").orElseThrow().code();
        });
        assertThat(winner).isEqualTo("BS");
        String other = withCountries(() -> {
            country("US", "+1", 0);
            country("BS", "+1242", 9);
            return countries.forE164("+12025550100").orElseThrow().code();
        });
        assertThat(other).isEqualTo("US");
    }
}
