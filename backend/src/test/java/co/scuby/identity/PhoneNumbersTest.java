package co.scuby.identity;

import co.scuby.platform.web.ApiException;
import co.scuby.support.IntegrationTest;
import co.scuby.support.TestDb;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@IntegrationTest
class PhoneNumbersTest {

    @Autowired PhoneNumbers numbers;
    @Autowired TestDb testDb;

    @BeforeEach
    void setUp() { testDb.reset(); }

    @Test
    void aColombianMobileIsAccepted() {
        assertThat(numbers.requireMobile("+573007152284", "phone")).isEqualTo("+573007152284");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "+5716012345",        // Bogotá landline: valid number, not a mobile (pattern ^3\d{9}$)
            "+57300715228",       // one digit short
            "+12025550123",       // a country we do not support
            "3007152284",         // not E.164
            "+57abc"
    })
    void anythingElseIsValidationFailedOnTheField(String phone) {
        assertThatThrownBy(() -> numbers.requireMobile(phone, "pet.phone"))
                .isInstanceOf(ApiException.class)
                .satisfies(e -> assertThat(((ApiException) e).getBody().getProperties().get("fields").toString()).contains("pet.phone"));
    }
}
