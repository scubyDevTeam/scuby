package co.scuby.platform.web;

import org.springframework.http.ProblemDetail;
import org.springframework.web.ErrorResponseException;

import java.util.Map;

/**
 * Thrown by any layer to answer with a contract error. A Spring ErrorResponseException, so Spring
 * handles it like its own; the code, fields and details ride as ProblemDetail properties.
 */
public class ApiException extends ErrorResponseException {

    public ApiException(ErrorCode code, String message) {
        this(code, message, Map.of(), Map.of());
    }

    public ApiException(ErrorCode code, String message, Map<String, String> fields, Map<String, String> details) {
        super(code.status(), problem(code, message, fields, details), null);
    }

    public ErrorCode code() {
        return ErrorCode.fromWire((String) getBody().getProperties().get(ContractErrors.CODE));
    }

    private static ProblemDetail problem(ErrorCode code, String message,
                                         Map<String, String> fields, Map<String, String> details) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(code.status(), message);
        pd.setProperty(ContractErrors.CODE, code.wire());
        if (!fields.isEmpty()) pd.setProperty(ContractErrors.FIELDS, Map.copyOf(fields));
        if (!details.isEmpty()) pd.setProperty(ContractErrors.DETAILS, Map.copyOf(details));
        return pd;
    }
}
