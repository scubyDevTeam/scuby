package co.scuby.platform.web;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * Bean validation of a request record the controller bound WITHOUT @Valid, run by the service at the point the endpoint's
 * error order says (docs/eng/backend.md · Request validation; e.g. after the owner check). Fields are wire paths, as
 * ApiErrorHandler names them; a list element's violation is named by its list (photo_urls, not photo_urls[2]).
 */
@Component
public class BodyValidation {

    private final Validator validator;

    public BodyValidation(Validator validator) {
        this.validator = validator;
    }

    public void require(Object body) {
        Set<ConstraintViolation<Object>> found = validator.validate(body);
        if (found.isEmpty()) return;
        Map<String, String> fields = new TreeMap<>();
        for (ConstraintViolation<Object> v : found) {
            String path = v.getPropertyPath().toString();
            int index = path.indexOf('[');
            fields.putIfAbsent(ApiErrorHandler.wirePath(index >= 0 ? path.substring(0, index) : path), v.getMessage());
        }
        throw new ApiException(ErrorCode.VALIDATION_FAILED, "request does not match the contract", fields, Map.of());
    }
}
