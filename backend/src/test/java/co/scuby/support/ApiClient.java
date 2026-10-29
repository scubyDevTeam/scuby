package co.scuby.support;

import co.scuby.contract.ContractValidator;
import jakarta.servlet.http.Cookie;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.request;

/**
 * One browser: keeps its cookies (session, device) across calls like the client does. Every call to a
 * contract endpoint is validated against docs/eng/openapi.json and against its statement ceiling.
 */
public final class ApiClient {

    private final MockMvc mvc;
    private final ContractValidator contract;
    private final StatementRecorder recorder;
    private final ConnectionSampler sampler;
    private final Map<String, Cookie> jar = new LinkedHashMap<>();
    private final Map<String, String> headers = new LinkedHashMap<>();
    private String remoteAddr = "203.0.113.10";

    ApiClient(MockMvc mvc, ContractValidator contract, StatementRecorder recorder, ConnectionSampler sampler) {
        this.mvc = mvc;
        this.contract = contract;
        this.recorder = recorder;
        this.sampler = sampler;
    }

    public ApiClient newBrowser() { return new ApiClient(mvc, contract, recorder, sampler); }

    public ApiClient header(String name, String value) { headers.put(name, value); return this; }

    public ApiClient from(String ip) { this.remoteAddr = ip; return this; }

    public void setCookie(String name, String value) { jar.put(name, new Cookie(name, value)); }

    public Optional<String> cookie(String name) { return Optional.ofNullable(jar.get(name)).map(Cookie::getValue); }

    public ApiResponse get(String template, Object... vars) { return call(HttpMethod.GET, template, null, vars); }

    public ApiResponse post(String template, String json, Object... vars) { return call(HttpMethod.POST, template, json, vars); }

    public ApiResponse put(String template, String json, Object... vars) { return call(HttpMethod.PUT, template, json, vars); }

    /** A contract endpoint: checked against the contract and its statement ceiling. */
    public ApiResponse call(HttpMethod method, String template, String json, Object... vars) {
        String path = template.contains("?") ? template.substring(0, template.indexOf('?')) : template;
        return callChecked(method, path, StatementCeilings.of(method.name(), path), template, json, vars);
    }

    /**
     * The checks of {@link #call}, with the contract path and ceiling given: the harness self-tests use it to
     * send a test-only probe route and judge it as a stand-in contract endpoint.
     */
    ApiResponse callChecked(HttpMethod method, String contractPath, int ceiling, String template, String json, Object... vars) {
        ApiResponse r = perform(method, template, json, vars);
        List<String> problems = r.status() == 204
                ? contract.errorsForNoContent(method.name(), contractPath, r.status())
                : contract.errors(method.name(), contractPath, r.status(), r.body());
        assertThat(problems).as("%s %s → %d breaks the contract: %s", method, contractPath, r.status(), r.body()).isEmpty();
        if (r.status() == 204) {
            assertThat(r.body()).as("%s %s → 204 breaks the contract: the body must be empty", method, contractPath).isEmpty();
        }
        assertThat(r.statements().size())
                .as("%s %s executed %d statements (ceiling %d): %s", method, contractPath, r.statements().size(), ceiling, r.statements())
                .isLessThanOrEqualTo(ceiling);
        return r;
    }

    /**
     * Not a contract endpoint (test probes, dev-only routes): no contract or ceiling checks. Refuses a path the
     * contract documents, so a contract route cannot be tested without its checks by accident; the deliberate
     * exceptions go through {@link #unchecked}.
     */
    public ApiResponse raw(HttpMethod method, String template, String json, Object... vars) {
        String path = org.springframework.web.util.UriComponentsBuilder.fromUriString(template).buildAndExpand(vars).getPath();
        assertThat(contract.documents(path))
                .as("%s %s is a contract route: use call/get/post/put (checked), or unchecked(...) with a reason", method, template)
                .isFalse();
        return perform(method, template, json, vars);
    }

    /**
     * A contract route WITHOUT the contract and ceiling checks, for the answers the contract cannot describe
     * (e.g. the Origin check's 403 on an endpoint that does not list it). {@code reason} is mandatory and read
     * by whoever reviews the call.
     */
    public ApiResponse unchecked(HttpMethod method, String template, String json, String reason, Object... vars) {
        assertThat(reason).as("why this contract route is called unchecked").isNotBlank();
        return perform(method, template, json, vars);
    }

    /** Raw bytes (the dev-only media PUT of plan A2). */
    public ApiResponse rawBytes(HttpMethod method, String template, byte[] bytes, String contentType, Object... vars) {
        MockHttpServletRequestBuilder req = request(method, template, vars).content(bytes).contentType(contentType);
        return execute(req);
    }

    private ApiResponse perform(HttpMethod method, String template, String json, Object... vars) {
        MockHttpServletRequestBuilder req = request(method, template, vars);
        if (json != null) req.contentType(MediaType.APPLICATION_JSON).content(json);
        return execute(req);
    }

    private ApiResponse execute(MockHttpServletRequestBuilder req) {
        req.accept(MediaType.APPLICATION_JSON);
        headers.forEach(req::header);
        if (!jar.isEmpty()) req.cookie(jar.values().toArray(Cookie[]::new));
        String addr = remoteAddr;
        req.with(r -> { r.setRemoteAddr(addr); return r; });
        recorder.reset();
        sampler.reset();
        try {
            MvcResult result = mvc.perform(req).andReturn();
            MockHttpServletResponse res = result.getResponse();
            List<String> sql = recorder.statementsOnCurrentThread();
            for (Cookie c : res.getCookies()) {
                if (c.getMaxAge() == 0) jar.remove(c.getName());
                else jar.put(c.getName(), new Cookie(c.getName(), c.getValue()));
            }
            return new ApiResponse(res.getStatus(), res.getContentAsString(StandardCharsets.UTF_8), res, sql,
                    result.getRequest().getSession(false) != null);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
