package co.scuby.platform.web;

import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

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
        log.error("unhandled exception", e);
        return contract(ProblemDetail.forStatus(HttpStatus.INTERNAL_SERVER_ERROR));
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

    /** Mirrors `spring.jackson.property-naming-strategy: SNAKE_CASE`: fields are named by wire path (docs/eng/api.md · Errors). */
    private static String wirePath(String javaPath) {
        return javaPath.replaceAll("([a-z0-9])([A-Z])", "$1_$2").toLowerCase(Locale.ROOT);
    }

    /** Every Spring-handled error, ApiException included, ends here with its ProblemDetail. */
    @Override
    protected @Nullable ResponseEntity<Object> handleExceptionInternal(Exception ex, @Nullable Object body,
            HttpHeaders headers, HttpStatusCode statusCode, WebRequest request) {
        if (statusCode.is5xxServerError()) log.error("server-side failure", ex);
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
