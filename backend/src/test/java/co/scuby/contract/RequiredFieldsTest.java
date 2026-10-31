package co.scuby.contract;

import co.scuby.support.IntegrationTest;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.MethodParameter;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.lang.reflect.Field;
import java.lang.reflect.RecordComponent;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Every request field the contract lists as required rejects an absent field (validation_failed naming it). Jackson
 * binds an absent field to null, so a record component that allows null (a required-but-nullable field such as
 * {@code otp_code}) must say {@code @JsonProperty(required = true)}; one that does not allow null says {@code @NotNull}
 * (or {@code @NotBlank}). Walks every {@code @RequestBody} record of a production controller against its schema in
 * docs/eng/openapi.json, nested objects included.
 */
@IntegrationTest
class RequiredFieldsTest {

    @Autowired @Qualifier("requestMappingHandlerMapping") RequestMappingHandlerMapping routes;

    private static final JsonNode DOCUMENT = new JsonMapper().readTree(
            readFile(ContractValidator.DOCUMENT));

    private static String readFile(java.nio.file.Path path) {
        try {
            return java.nio.file.Files.readString(path);
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
    }

    @Test
    void everyRequiredRequestFieldIsEnforcedWhenAbsent() {
        List<String> lenient = new ArrayList<>();
        int checked = 0;
        for (var entry : routes.getHandlerMethods().entrySet()) {
            HandlerMethod handler = entry.getValue();
            if (!handler.getBeanType().getName().startsWith("co.scuby.") || handler.getBeanType().getName().startsWith("co.scuby.support.")) continue;
            Class<?> body = requestBodyType(handler);
            if (body == null || !body.isRecord()) continue;
            RequestMappingInfo info = entry.getKey();
            String path = info.getPathPatternsCondition().getFirstPattern().getPatternString();
            String method = info.getMethodsCondition().getMethods().iterator().next().name().toLowerCase(Locale.ROOT);
            JsonNode schema = resolve(DOCUMENT.at("/paths").path(path).path(method).at("/requestBody/content/application~1json/schema"));
            if (schema.isMissingNode()) continue;     // undocumented route: ContractCoverageTest owns that
            checked++;
            check(body, schema, body.getSimpleName(), lenient);
        }
        assertThat(checked).as("request records compared with their schemas").isGreaterThanOrEqualTo(7);
        assertThat(lenient).as("required in the contract, but an absent field is accepted").isEmpty();
    }

    private static Class<?> requestBodyType(HandlerMethod handler) {
        for (MethodParameter p : handler.getMethodParameters()) {
            if (p.hasParameterAnnotation(RequestBody.class)) return p.getParameterType();
        }
        return null;
    }

    private static JsonNode resolve(JsonNode schema) {
        if (schema.has("$ref")) return resolve(DOCUMENT.at(schema.get("$ref").asString().substring(1)));
        return schema;
    }

    private static void check(Class<?> record, JsonNode schema, String where, List<String> lenient) {
        JsonNode required = schema.path("required");
        for (RecordComponent c : record.getRecordComponents()) {
            String wire = wireName(c.getName());
            JsonNode property = schema.path("properties").path(wire);
            if (property.isMissingNode()) continue;
            boolean isRequired = false;
            for (JsonNode r : required) if (r.asString().equals(wire)) isRequired = true;
            if (isRequired && !rejectsAbsence(record, c)) lenient.add(where + "." + wire);
            JsonNode nested = resolve(property);
            if (c.getType().isRecord() && "object".equals(nested.path("type").asString(""))) {
                check(c.getType(), nested, where + "." + wire, lenient);
            }
        }
    }

    private static boolean rejectsAbsence(Class<?> record, RecordComponent c) {
        try {
            Field f = record.getDeclaredField(c.getName());
            JsonProperty json = f.getAnnotation(JsonProperty.class);
            return f.isAnnotationPresent(NotNull.class) || f.isAnnotationPresent(NotBlank.class) || (json != null && json.required());
        } catch (NoSuchFieldException e) {
            throw new AssertionError(e);
        }
    }

    private static String wireName(String javaName) {
        return javaName.replaceAll("([a-z0-9])([A-Z])", "$1_$2").toLowerCase(Locale.ROOT);
    }
}
