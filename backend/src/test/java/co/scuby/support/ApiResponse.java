package co.scuby.support;

import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.List;

/** @param httpSessionCreated true when the request created a servlet HttpSession (it never should: the API is stateless). */
public record ApiResponse(int status, String body, MockHttpServletResponse raw, List<String> statements,
                          boolean httpSessionCreated) {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    public JsonNode json() {
        return JSON.readTree(body);
    }

    /** The string at a JSON pointer (e.g. "/error/code"), or null when absent or null. */
    public String str(String pointer) {
        JsonNode n = json().at(pointer);
        return n.isMissingNode() || n.isNull() ? null : n.asString();
    }

    /** True only when the field is present and JSON null (the contract wants null, not absent). */
    public boolean isNull(String pointer) {
        return json().at(pointer).isNull();
    }

    public String errorCode() {
        return str("/error/code");
    }

    public List<String> setCookies() {
        return raw.getHeaders(HttpHeaders.SET_COOKIE);
    }
}
