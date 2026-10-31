package co.scuby.platform.web;

import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import tools.jackson.core.JacksonException;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

import java.sql.SQLException;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Spring's ResponseEntityExceptionHandler classifies every MVC exception and ApiException (an
 * ErrorResponseException) into a ProblemDetail; this class only adds what Spring lacks and hands
 * the result to ContractErrors. The client writes its own copy per code.
 */
@RestControllerAdvice
public class ApiErrorHandler extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiErrorHandler.class);

    /** Anything Spring does not know: a 500. */
    @ExceptionHandler(Exception.class)
    ResponseEntity<Object> unexpected(Exception e) {
        logUnexpected(e);
        return contract(ProblemDetail.forStatus(HttpStatus.INTERNAL_SERVER_ERROR));
    }

    /**
     * A database error is logged by SQLSTATE and constraint name only: the driver's message can carry
     * «Detail: Failing row contains (...)», that is, the personal data of the request (decision #46). The driver is
     * also configured not to include it (spring.datasource.hikari.data-source-properties.logServerErrorDetail).
     */
    private static final java.util.regex.Pattern CONSTRAINT = java.util.regex.Pattern.compile("constraint \"([A-Za-z0-9_]+)\"");

    private static void logUnexpected(Exception e) {
        for (Throwable t = e; t != null; t = t.getCause() == t ? null : t.getCause()) {
            if (t instanceof SQLException sql) {
                var named = CONSTRAINT.matcher(String.valueOf(sql.getMessage()));   // only the name is taken; the message itself is never logged
                String constraint = named.find() ? named.group(1) : null;
                log.error("unhandled database error: {} sqlstate={} constraint={}", e.getClass().getSimpleName(), sql.getSQLState(), constraint);
                return;
            }
        }
        log.error("unhandled exception", e);
    }

    /** Spring's ProblemDetail for bean validation has no per-field map; the contract wants one. */
    @Override
    protected @Nullable ResponseEntity<Object> handleMethodArgumentNotValid(MethodArgumentNotValidException ex,
            HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        Map<String, String> fields = new LinkedHashMap<>();
        ex.getBindingResult().getFieldErrors()
          .forEach(f -> fields.putIfAbsent(wirePath(f.getField()), f.getDefaultMessage()));
        ProblemDetail pd = ex.getBody();
        pd.setDetail("request does not match the contract");
        pd.setProperty(ContractErrors.CODE, ErrorCode.VALIDATION_FAILED.wire());
        pd.setProperty(ContractErrors.FIELDS, fields);
        return handleExceptionInternal(ex, pd, headers, status, request);
    }

    /**
     * A body Jackson could not bind: an absent required field (Jackson's {@code required = true}), a wrong type, a value
     * not in an enum. The contract wants the field named, so the wire path comes from Jackson's path and, for an absent
     * creator property, from its message; the message itself is never sent or logged.
     */
    @Override
    protected @Nullable ResponseEntity<Object> handleHttpMessageNotReadable(HttpMessageNotReadableException ex,
            HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        ProblemDetail pd = ProblemDetail.forStatus(status);
        pd.setDetail("request does not match the contract");
        pd.setProperty(ContractErrors.CODE, ErrorCode.VALIDATION_FAILED.wire());
        for (Throwable t = ex; t != null; t = t.getCause() == t ? null : t.getCause()) {
            if (t instanceof JacksonException je) {
                String field = fieldOf(je);
                if (field != null) pd.setProperty(ContractErrors.FIELDS, Map.of(field, "missing or not valid"));
                break;
            }
        }
        return handleExceptionInternal(ex, pd, headers, status, request);
    }

    private static final java.util.regex.Pattern MISSING = java.util.regex.Pattern.compile("Missing required creator property '([^']+)'");

    /** «pet.marks»: Jackson's path (it already ends with the absent creator property), else the property named by the message. */
    private static @Nullable String fieldOf(JacksonException je) {
        java.util.List<String> parts = new java.util.ArrayList<>();
        for (JacksonException.Reference ref : je.getPath()) {
            if (ref.getPropertyName() != null) parts.add(ref.getPropertyName());
        }
        var missing = MISSING.matcher(String.valueOf(je.getOriginalMessage()));
        if (missing.find() && (parts.isEmpty() || !parts.getLast().equals(missing.group(1)))) parts.add(missing.group(1));
        return parts.isEmpty() ? null : String.join(".", parts);
    }

    /** Mirrors `spring.jackson.property-naming-strategy: SNAKE_CASE`: fields are named by wire path (docs/eng/api.md · Errors). */
    private static String wirePath(String javaPath) {
        return javaPath.replaceAll("([a-z0-9])([A-Z])", "$1_$2").toLowerCase(Locale.ROOT);
    }

    /** Every Spring-handled error, ApiException included, ends here with its ProblemDetail. */
    @Override
    protected @Nullable ResponseEntity<Object> handleExceptionInternal(Exception ex, @Nullable Object body,
            HttpHeaders headers, HttpStatusCode statusCode, WebRequest request) {
        if (statusCode.is5xxServerError()) logUnexpected(ex);
        // Spring passes a null body for ErrorResponse exceptions; their ProblemDetail is on the exception.
        ProblemDetail pd = body instanceof ProblemDetail p ? p
                : ex instanceof ErrorResponse er ? er.getBody()
                : ProblemDetail.forStatus(statusCode);
        return contract(pd);
    }

    /** The wire status is the code's status (docs/eng/api.md · Errors), e.g. a 400 or 405 answers 422. */
    private static ResponseEntity<Object> contract(ProblemDetail pd) {
        ApiErrorBody envelope = ContractErrors.toEnvelope(pd);
        return ResponseEntity.status(ErrorCode.fromWire(envelope.error().code()).status())
                             .contentType(MediaType.APPLICATION_JSON)
                             .body(envelope);
    }
}
