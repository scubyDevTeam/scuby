package co.scuby.contract;

import co.scuby.platform.web.ApiErrorBody;
import co.scuby.platform.web.ErrorCode;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.PropertyNamingStrategies;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ContractValidatorTest {

    static final ContractValidator contract = ContractValidator.load();

    static final String GOOD_CONFIG = """
            {"supported_countries":[{"code":"CO","phone_prefix":"+57","mobile_pattern":"^3\\\\d{9}$",
              "default_center":{"lat":4.6,"lng":-74.08}}]}""";

    @Test
    void aConformingBodyHasNoErrors() {
        assertThat(contract.errors("GET", "/config", 200, GOOD_CONFIG)).isEmpty();
    }

    @Test
    void aMissingRequiredFieldIsReported() {
        String bad = """
                {"supported_countries":[{"code":"CO","phone_prefix":"+57","mobile_pattern":"x"}]}""";
        assertThat(contract.errors("GET", "/config", 200, bad)).isNotEmpty();
    }

    @Test
    void anExtraFieldIsReported() {
        String bad = GOOD_CONFIG.replace("\"code\":\"CO\"", "\"code\":\"CO\",\"surprise\":1");
        assertThat(contract.errors("GET", "/config", 200, bad)).isNotEmpty();
    }

    @Test
    void anUndocumentedStatusIsReported() {
        assertThat(contract.errors("GET", "/config", 418, "{}")).singleElement().asString().contains("418");
    }

    @Test
    void ourErrorEnvelopeMatchesTheContractsErrorSchema() throws Exception {
        var mapper = JsonMapper.builder().propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE).build();
        String body = mapper.writeValueAsString(
                ApiErrorBody.of(ErrorCode.RATE_LIMITED, "slow down", Map.of(), Map.of()));
        assertThat(contract.errors("GET", "/config", 429, body)).isEmpty();
    }

    @Test
    void aDocumentedNoContentStatusHasNoErrors() {
        assertThat(contract.errorsForNoContent("POST", "/auth/sign-out", 204)).isEmpty();
        assertThat(contract.errorsForNoContent("POST", "/auth/sign-out", 201)).isNotEmpty();
    }
}
