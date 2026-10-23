package co.scuby.platform.web;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.Map;

/** `{ "error": { code, message, fields?, details? } }` — the one failure body (docs/eng/api.md · Errors). */
public record ApiErrorBody(Error error) {

    @JsonInclude(JsonInclude.Include.NON_EMPTY)
    public record Error(String code, String message, Map<String, String> fields, Map<String, String> details) {}

    public static ApiErrorBody of(ErrorCode code, String message, Map<String, String> fields, Map<String, String> details) {
        return new ApiErrorBody(new Error(code.wire(), message, fields, details));
    }
}
