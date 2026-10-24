package co.scuby.platform.web;

import org.springframework.http.HttpStatus;

/** Every failure the API answers with — mirror of web/src/contracts/errors.ts (docs/eng/api.md · Errors). */
public enum ErrorCode {
    VALIDATION_FAILED(HttpStatus.UNPROCESSABLE_ENTITY),
    UNAUTHORIZED(HttpStatus.UNAUTHORIZED),
    FORBIDDEN(HttpStatus.FORBIDDEN),
    NOT_FOUND(HttpStatus.NOT_FOUND),
    GONE(HttpStatus.GONE),
    INVALID_TRANSITION(HttpStatus.CONFLICT),
    ACTIVE_CASE_EXISTS(HttpStatus.CONFLICT),
    INVALID_CODE(HttpStatus.UNPROCESSABLE_ENTITY),
    PHONE_REQUIRED(HttpStatus.UNPROCESSABLE_ENTITY),
    SIGHTING_TOO_FAR(HttpStatus.UNPROCESSABLE_ENTITY),
    SEEN_AT_IN_FUTURE(HttpStatus.UNPROCESSABLE_ENTITY),
    SEEN_AT_BEFORE_CASE(HttpStatus.UNPROCESSABLE_ENTITY),
    RATE_LIMITED(HttpStatus.TOO_MANY_REQUESTS),
    SERVER_ERROR(HttpStatus.INTERNAL_SERVER_ERROR);

    private final HttpStatus status;

    ErrorCode(HttpStatus status) { this.status = status; }

    public HttpStatus status() { return status; }

    public String wire() { return name().toLowerCase(java.util.Locale.ROOT); }

    public static ErrorCode fromWire(String wire) {
        return valueOf(wire.toUpperCase(java.util.Locale.ROOT));
    }
}
