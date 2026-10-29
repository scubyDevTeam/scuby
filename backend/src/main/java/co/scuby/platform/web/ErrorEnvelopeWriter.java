package co.scuby.platform.web;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;

/**
 * The contract's envelope for answers written outside MVC (security entry points, filters). Built by
 * ContractErrors, the same mapper ApiErrorHandler uses, so there is one envelope mapper.
 */
@Component
public class ErrorEnvelopeWriter {

    private final JsonMapper json;

    public ErrorEnvelopeWriter(JsonMapper json) {
        this.json = json;
    }

    public void write(HttpServletResponse response, ErrorCode code) throws IOException {
        ProblemDetail pd = ProblemDetail.forStatus(code.status());
        pd.setProperty(ContractErrors.CODE, code.wire());
        response.setStatus(code.status().value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        json.writeValue(response.getOutputStream(), ContractErrors.toEnvelope(pd));
    }
}
