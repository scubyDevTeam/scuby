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
                    "scuby.auth.code-hash-key", "dummy-code-hash-key-0123456789abcdef",
                    "scuby.auth.google.client-id", "dummy-client.apps.googleusercontent.com"),
            "prod", Map.of(
                    "scuby.web.allowed-origins", "https://scuby.test",
                    "scuby.web.origin-secret", "dummy-origin-secret",
                    "scuby.web.ip-hash-key", "dummy-ip-hash-key-0123456789abcdef",
                    "scuby.auth.code-hash-key", "dummy-code-hash-key-0123456789abcdef",
                    "scuby.auth.google.client-id", "dummy-client.apps.googleusercontent.com"));

    @ParameterizedTest
    @ValueSource(strings = {"staging", "prod"})
    void startsWithEveryRequiredProperty(String profile) {
        try (ConfigurableApplicationContext context = start(profile, REQUIRED.get(profile))) {
            assertThat(context.isActive()).isTrue();
        }
    }

    /**
     * /dev-media is an unauthenticated write to disk: it exists under local/test only, and never in a process
     * that also has a deployed profile (the mixed profiles start when their properties are supplied).
     */
    @ParameterizedTest
    @ValueSource(strings = {"staging", "prod", "staging,local", "prod,local", "staging,test", "prod,test"})
    void aDeployedProfileNeverRegistersDevMedia(String profiles) {
        String deployed = profiles.startsWith("prod") ? "prod" : "staging";
        ConfigurableApplicationContext context;
        try {
            context = start(profiles, REQUIRED.get(deployed));
        } catch (RuntimeException refusedToStart) {
            return; // prod,local/prod,test trip the prod test-bypass guard on the local/test yml: no process, no route
        }
        try (context) {
            assertThat(devMediaPatterns(context)).as("/dev-media routes under %s", profiles).isEmpty();
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"local", "test"})
    void localAndTestRegisterDevMedia(String profile) {
        try (ConfigurableApplicationContext context = start(profile, Map.of())) {
            assertThat(devMediaPatterns(context)).isNotEmpty();
        }
    }

    private static java.util.List<String> devMediaPatterns(ConfigurableApplicationContext context) {
        var mapping = context.getBean("requestMappingHandlerMapping", org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping.class);
        return mapping.getHandlerMethods().keySet().stream()
                .flatMap(info -> info.getPathPatternsCondition().getPatternValues().stream())
                .filter(p -> p.startsWith("/dev-media"))
                .toList();
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

    static Stream<Arguments> unusableCodeHashKeys() {
        return Stream.of("staging", "prod").flatMap(profile -> Stream.of(
                Arguments.of(profile, ""),
                Arguments.of(profile, "   "),
                Arguments.of(profile, "changeme"),
                Arguments.of(profile, "too-short-key-31-characters-xx"),
                Arguments.of(profile, "local-only-code-hash-key")));
    }

    /** A blank key makes every code operation a 500 at run time; a short one makes stored codes guessable. */
    @ParameterizedTest(name = "{0} with code-hash-key \"{1}\"")
    @MethodSource("unusableCodeHashKeys")
    void refusesABlankShortOrDefaultCodeHashKey(String profile, String key) {
        assertRefusedWith(profile, "scuby.auth.code-hash-key", key);
    }

    static Stream<Arguments> unusableClientIds() {
        return Stream.of("staging", "prod").flatMap(profile -> Stream.of(
                Arguments.of(profile, ""),
                Arguments.of(profile, "   "),
                Arguments.of(profile, "local-google-client-id")));
    }

    @ParameterizedTest(name = "{0} with google client-id \"{1}\"")
    @MethodSource("unusableClientIds")
    void refusesABlankOrDefaultGoogleClientId(String profile, String id) {
        assertRefusedWith(profile, "scuby.auth.google.client-id", id);
    }

    /** `staging,local` must not unlock the local defaults (the public HMAC keys). */
    @ParameterizedTest
    @ValueSource(strings = {"staging,local", "prod,local", "staging,test", "prod,test"})
    void aDeployedProfileMixedWithLocalOrTestStillNeedsItsProperties(String profiles) {
        Throwable failure = catchThrowable(() -> start(profiles, Map.of()).close());
        assertThat(failure).as("%s started on local defaults", profiles).isNotNull();
    }

    /**
     * The real application context, so deleting @Component from TestBypassGuard (or moving it out of the
     * scanned packages) makes this fail: prod must refuse a configured test bypass.
     */
    @ParameterizedTest
    @ValueSource(strings = {"scuby.auth.test-bypass.email-domains=e2e.scuby.test", "scuby.auth.test-bypass.sms-prefixes=+5730000000"})
    void prodRefusesATestBypassInTheRealContext(String bypass) {
        String[] kv = bypass.split("=", 2);
        Map<String, String> props = new LinkedHashMap<>(REQUIRED.get("prod"));
        props.put(kv[0], kv[1]);
        Throwable failure = catchThrowable(() -> start("prod", props).close());
        assertThat(failure).as("prod started with %s", bypass).isNotNull();
        assertThat(chainOf(failure)).contains("test bypass");
    }

    private static void assertRefusedWith(String profile, String key, String value) {
        Map<String, String> props = new LinkedHashMap<>(REQUIRED.get(profile));
        props.put(key, value);
        Throwable failure = catchThrowable(() -> start(profile, props).close());
        assertThat(failure).as("%s started with %s '%s'", profile, key, value).isNotNull();
        assertThat(chainOf(failure)).contains(key);
    }

    private static String chainOf(Throwable failure) {
        StringBuilder chain = new StringBuilder();
        for (Throwable t = failure; t != null; t = t.getCause()) chain.append(t.getMessage()).append('\n');
        return chain.toString();
    }

    private static ConfigurableApplicationContext start(String profile, Map<String, String> props) {
        Map<String, String> all = new LinkedHashMap<>(TestcontainersConfiguration.jdbcProperties());
        all.putAll(props);
        all.put("server.port", "0");
        String[] args = all.entrySet().stream().map(e -> "--" + e.getKey() + "=" + e.getValue()).toArray(String[]::new);
        return new SpringApplicationBuilder(ScubyApplication.class).profiles(profile.split(",")).run(args);
    }
}
