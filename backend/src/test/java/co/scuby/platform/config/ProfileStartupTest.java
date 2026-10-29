package co.scuby.platform.config;

import co.scuby.ScubyApplication;
import co.scuby.TestcontainersConfiguration;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

/**
 * Each deployed profile starts with exactly the properties infra provides (dummy values here) and refuses
 * to start without any one of them — so a profile can neither become unstartable unnoticed nor run on a
 * local default. Values are passed as command-line arguments: they must beat application*.yml.
 */
class ProfileStartupTest {

    /** Every property a deployed profile requires. A task that adds a required property adds it here. */
    static final Map<String, Map<String, String>> REQUIRED = Map.of(
            "staging", Map.of(
                    "scuby.web.allowed-origins", "https://staging.scuby.test",
                    "scuby.web.ip-hash-key", "dummy-ip-hash-key-0123456789abcdef",
                    "scuby.auth.code-hash-key", "dummy-code-hash-key-0123456789abcdef"),
            "prod", Map.of(
                    "scuby.web.allowed-origins", "https://scuby.test",
                    "scuby.web.origin-secret", "dummy-origin-secret",
                    "scuby.web.ip-hash-key", "dummy-ip-hash-key-0123456789abcdef",
                    "scuby.auth.code-hash-key", "dummy-code-hash-key-0123456789abcdef"));

    @ParameterizedTest
    @ValueSource(strings = {"staging", "prod"})
    void startsWithEveryRequiredProperty(String profile) {
        try (ConfigurableApplicationContext context = start(profile, REQUIRED.get(profile))) {
            assertThat(context.isActive()).isTrue();
        }
    }

    static Stream<Arguments> eachRequiredProperty() {
        return REQUIRED.entrySet().stream()
                .flatMap(e -> e.getValue().keySet().stream().map(key -> Arguments.of(e.getKey(), key)));
    }

    /** Some exception in the chain names the key: a guard's message, or Boot's "Failed to bind properties under '<key>'". */
    @ParameterizedTest(name = "{0} without {1}")
    @MethodSource("eachRequiredProperty")
    void refusesToStartWithoutIt(String profile, String key) {
        Map<String, String> props = new LinkedHashMap<>(REQUIRED.get(profile));
        props.remove(key);
        Throwable failure = catchThrowable(() -> start(profile, props).close());
        assertThat(failure).as("%s started without %s", profile, key).isNotNull();
        StringBuilder chain = new StringBuilder();
        for (Throwable t = failure; t != null; t = t.getCause()) chain.append(t.getMessage()).append('\n');
        assertThat(chain.toString()).contains(key);
    }

    static Stream<Arguments> unusableIpHashKeys() {
        return Stream.of("staging", "prod").flatMap(profile -> Stream.of(
                Arguments.of(profile, ""),
                Arguments.of(profile, "   "),
                Arguments.of(profile, "too-short-key-31-characters-xx"),
                Arguments.of(profile, "local-only-ip-hash-key")));
    }

    @ParameterizedTest(name = "{0} with ip-hash-key \"{1}\"")
    @MethodSource("unusableIpHashKeys")
    void refusesABlankShortOrDefaultIpHashKey(String profile, String key) {
        Map<String, String> props = new LinkedHashMap<>(REQUIRED.get(profile));
        props.put("scuby.web.ip-hash-key", key);
        Throwable failure = catchThrowable(() -> start(profile, props).close());
        assertThat(failure).as("%s started with ip-hash-key '%s'", profile, key).isNotNull();
        StringBuilder chain = new StringBuilder();
        for (Throwable t = failure; t != null; t = t.getCause()) chain.append(t.getMessage()).append('\n');
        assertThat(chain.toString()).contains("scuby.web.ip-hash-key");
    }

    private static ConfigurableApplicationContext start(String profile, Map<String, String> props) {
        Map<String, String> all = new LinkedHashMap<>(TestcontainersConfiguration.jdbcProperties());
        all.putAll(props);
        all.put("server.port", "0");
        String[] args = all.entrySet().stream().map(e -> "--" + e.getKey() + "=" + e.getValue()).toArray(String[]::new);
        return new SpringApplicationBuilder(ScubyApplication.class).profiles(profile).run(args);
    }
}
