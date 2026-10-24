package co.scuby.platform.web;

import org.springframework.http.ProblemDetail;

import java.util.LinkedHashMap;
import java.util.Map;

/** The one mapper from Spring's ProblemDetail to the contract's envelope (docs/eng/api.md · Errors). */
public final class ContractErrors {

    public static final String CODE = "code";
    public static final String FIELDS = "fields";
    public static final String DETAILS = "details";

    private ContractErrors() {}

    public static ApiErrorBody toEnvelope(ProblemDetail pd) {
        Map<String, Object> props = pd.getProperties() == null ? Map.of() : pd.getProperties();
        ErrorCode code = codeOf(props.get(CODE), pd.getStatus());
        // Never leak internals: a server error always says only "server_error".
        String message = code == ErrorCode.SERVER_ERROR || pd.getDetail() == null ? code.wire() : pd.getDetail();
        return ApiErrorBody.of(code, message, strings(props.get(FIELDS)), strings(props.get(DETAILS)));
    }

    /** Spring's standard MVC errors carry no code: derive it from the status. */
    static ErrorCode fromStatus(int status) {
        return switch (status) {
            case 401 -> ErrorCode.UNAUTHORIZED;
            case 403 -> ErrorCode.FORBIDDEN;
            case 404 -> ErrorCode.NOT_FOUND;
            case 410 -> ErrorCode.GONE;
            case 429 -> ErrorCode.RATE_LIMITED;
            default -> status >= 400 && status < 500 ? ErrorCode.VALIDATION_FAILED : ErrorCode.SERVER_ERROR;
        };
    }

    /** An explicit wire code wins; an unknown one falls back to the status instead of failing the handler. */
    private static ErrorCode codeOf(Object wire, int status) {
        if (wire instanceof String w) {
            try {
                return ErrorCode.fromWire(w);
            } catch (IllegalArgumentException unknown) {
                // fall through to the status
            }
        }
        return fromStatus(status);
    }

    private static Map<String, String> strings(Object value) {
        Map<String, String> out = new LinkedHashMap<>();
        if (value instanceof Map<?, ?> m) m.forEach((k, v) -> out.put(String.valueOf(k), String.valueOf(v)));
        return out;
    }
}
