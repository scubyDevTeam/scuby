package co.scuby.platform.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ProdTest {

    @Test
    void refusesAnUnsafeSettingUnderProd() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        assertThatThrownBy(() -> Prod.refuse(env, true, "a test bypass"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("a test bypass");
    }

    @Test
    void allowsItElsewhereOrWhenSafe() {
        MockEnvironment staging = new MockEnvironment();
        staging.setActiveProfiles("staging");
        assertThatCode(() -> Prod.refuse(staging, true, "x")).doesNotThrowAnyException();
        MockEnvironment prod = new MockEnvironment();
        prod.setActiveProfiles("prod");
        assertThatCode(() -> Prod.refuse(prod, false, "x")).doesNotThrowAnyException();
    }

    @Test
    void aDeployedProfileMustProvideTheSetting() {
        for (String profile : new String[] {"staging", "prod"}) {
            MockEnvironment env = new MockEnvironment();
            env.setActiveProfiles(profile);
            assertThatThrownBy(() -> Prod.requireDeployed(env, false, "scuby.web.allowed-origins"))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("scuby.web.allowed-origins");
            assertThatCode(() -> Prod.requireDeployed(env, true, "x")).doesNotThrowAnyException();
        }
    }

    @Test
    void localAndTestMayRelyOnDefaults() {
        for (String profile : new String[] {"local", "test"}) {
            MockEnvironment env = new MockEnvironment();
            env.setActiveProfiles(profile);
            assertThatCode(() -> Prod.requireDeployed(env, false, "x")).doesNotThrowAnyException();
        }
    }

    @Test
    void localOrTestNeverUnlocksTheDefaultsOfADeployedProfile() {
        for (String deployed : new String[] {"staging", "prod"}) {
            for (String lax : new String[] {"local", "test"}) {
                MockEnvironment env = new MockEnvironment();
                env.setActiveProfiles(deployed, lax);
                assertThatThrownBy(() -> Prod.requireDeployed(env, false, "x"))
                        .as("%s,%s", deployed, lax)
                        .isInstanceOf(IllegalStateException.class);
            }
        }
    }
}
