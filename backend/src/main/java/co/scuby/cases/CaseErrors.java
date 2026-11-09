package co.scuby.cases;

import co.scuby.platform.web.ApiException;
import co.scuby.platform.web.ErrorCode;

import java.util.Map;

/** The contract errors the case endpoints answer, built in one place so their messages stay consistent. */
final class CaseErrors {

    private CaseErrors() {}

    static ApiException notFound() {
        return new ApiException(ErrorCode.NOT_FOUND, "no such case");
    }

    static ApiException notFound(String what) {
        return new ApiException(ErrorCode.NOT_FOUND, "no such " + what);
    }

    static ApiException gone() {
        return new ApiException(ErrorCode.GONE, "this case was purged");
    }

    static ApiException forbidden() {
        return forbidden("only the case's owner can do this");
    }

    static ApiException forbidden(String message) {
        return new ApiException(ErrorCode.FORBIDDEN, message);
    }

    static ApiException invalidTransition() {
        return new ApiException(ErrorCode.INVALID_TRANSITION, "the case's status does not allow this");
    }

    static ApiException activeCaseExists(String code) {
        return new ApiException(ErrorCode.ACTIVE_CASE_EXISTS, "the pet already has an active lost case", Map.of(), Map.of("case_code", code));
    }

    static ApiException invalidField(String field, String reason) {
        return invalidFields(Map.of(field, reason));
    }

    static ApiException invalidFields(Map<String, String> fields) {
        return new ApiException(ErrorCode.VALIDATION_FAILED, "request does not match the contract", fields, Map.of());
    }
}
