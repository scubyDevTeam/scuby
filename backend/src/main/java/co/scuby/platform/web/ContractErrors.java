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
        ErrorCode code = props.get(CODE) instanceof String wire ? ErrorCode.fromWire(wire) : fromStatus(pd.getStatus());
        // Never leak internals: a server error always says only "server_error".
        String message = code == ErrorCode.SERVER_ERROR || pd.getDetail() == null ? code.wire() : pd.getDetail();
        return ApiErrorBody.of(code, message, strings(props.get(FIELDS)), strings(props.get(DETAILS)));
    }

    /** Spring's standard MVC errors carry no code: derive it from the status. */
    static ErrorCode fromStatus(int status) {
        if (status == 404) return ErrorCode.NOT_FOUND;
        if (status >= 400 && status < 500) return ErrorCode.VALIDATION_FAILED;
        return ErrorCode.SERVER_ERROR;
    }

    private static Map<String, String> strings(Object value) {
        Map<String, String> out = new LinkedHashMap<>();
        if (value instanceof Map<?, ?> m) m.forEach((k, v) -> out.put(String.valueOf(k), String.valueOf(v)));
        return out;
    }
}
