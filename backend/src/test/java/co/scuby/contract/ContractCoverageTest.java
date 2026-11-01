package co.scuby.contract;

import co.scuby.support.ApiClient;
import co.scuby.support.ApiClients;
import co.scuby.support.IntegrationTest;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpMethod;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The contract (docs/eng/openapi.json) and the code agree on which routes exist, and on which need a session:
 * <ul>
 *   <li>every controller route is documented (an undocumented route has no response check anywhere);</li>
 *   <li>every documented route that needs a session and is implemented answers an anonymous caller 401 — so a
 *       new controller that forgets its SecurityRules line (or takes Caller where it needs Account) fails here.</li>
 * </ul>
 */
@IntegrationTest
class ContractCoverageTest {

    /** Routes that exist on purpose without being in the contract. Anything else must be documented. */
    static final Set<String> ALLOWED_UNDOCUMENTED_PREFIXES = Set.of("/actuator", "/error");

    /** Exact "METHOD /template" routes. Development bucket (profiles local and test only): stands in for the presigned S3 PUT and the image CDN, so it has no contract. */
    static final Set<String> ALLOWED_UNDOCUMENTED_ROUTES = Set.of(
            "PUT /dev-media/{sha256:[0-9a-f]{64}}.jpg",
            "GET /dev-media/{sha256:[0-9a-f]{64}}.jpg");

    /** Test-only controllers (src/test) and Boot's own error controller. */
    private static boolean isInfrastructure(HandlerMethod handler) {
        String type = handler.getBeanType().getName();
        return type.startsWith("co.scuby.support.") || type.startsWith("co.scuby.platform.security.SecurityBaselineTest")
                || type.startsWith("org.springframework.boot.");
    }

    @Autowired @Qualifier("requestMappingHandlerMapping") RequestMappingHandlerMapping routes;
    @Autowired ApiClients clients;

    private static final ContractValidator CONTRACT = ContractValidator.load();

    /** "METHOD /template" of every route of a production controller. */
    private List<String> implementedRoutes() {
        List<String> found = new ArrayList<>();
        for (var entry : routes.getHandlerMethods().entrySet()) {
            if (isInfrastructure(entry.getValue())) continue;
            RequestMappingInfo info = entry.getKey();
            Set<String> patterns = info.getPathPatternsCondition() == null ? Set.of() : info.getPathPatternsCondition().getPatternValues();
            Set<RequestMethod> methods = info.getMethodsCondition().getMethods();
            assertThat(methods).as("%s must name its HTTP method (a bare @RequestMapping answers all)", entry.getValue()).isNotEmpty();
            for (String pattern : patterns) {
                for (RequestMethod m : methods) found.add(m.name() + " " + pattern);
            }
        }
        return found;
    }

    @Test
    void everyControllerRouteIsInTheContract() {
        Set<String> documented = new TreeSet<>();
        CONTRACT.operations().forEach(o -> documented.add(o.method() + " " + o.path()));
        List<String> undocumented = implementedRoutes().stream()
                .filter(r -> !documented.contains(r))
                .filter(r -> !ALLOWED_UNDOCUMENTED_ROUTES.contains(r))
                .filter(r -> ALLOWED_UNDOCUMENTED_PREFIXES.stream().noneMatch(p -> r.substring(r.indexOf(' ') + 1).startsWith(p)))
                .toList();
        assertThat(undocumented).as("routes implemented but missing from docs/eng/openapi.json").isEmpty();
        assertThat(implementedRoutes()).as("the route table was read").isNotEmpty();
    }

    @TestFactory
    Stream<DynamicTest> everyImplementedSessionRouteRefusesAnAnonymousCaller() {
        List<String> implemented = implementedRoutes();
        List<ContractValidator.Operation> sessionRoutes = CONTRACT.operations().stream()
                .filter(ContractValidator.Operation::sessionRequired)
                .filter(o -> implemented.contains(o.method() + " " + o.path()))
                .toList();
        assertThat(sessionRoutes).as("session routes implemented so far").hasSizeGreaterThanOrEqualTo(4);
        return sessionRoutes.stream().map(o -> DynamicTest.dynamicTest(o.method() + " " + o.path(), () -> {
            ApiClient anonymous = clients.newBrowser();
            // Through the checked client: the answer must also be a contract-shaped 401 within its ceiling.
            // The template itself (its ceiling and contract entry are keyed by it), with "x" for every path variable.
            Object[] vars = java.util.regex.Pattern.compile("\\{[^/}]+}").matcher(o.path()).results().map(m -> (Object) "x").toArray();
            var r = anonymous.call(HttpMethod.valueOf(o.method()), o.path(),
                    o.method().equals("GET") || o.method().equals("DELETE") ? null : "{}", vars);
            assertThat(r.status()).as("%s %s without a session", o.method(), o.path()).isEqualTo(401);
            assertThat(r.errorCode()).isEqualTo("unauthorized");
        }));
    }
}
