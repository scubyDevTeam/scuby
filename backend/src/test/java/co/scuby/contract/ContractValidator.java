package co.scuby.contract;

import com.networknt.schema.Error;
import com.networknt.schema.InputFormat;
import com.networknt.schema.SchemaLocation;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SpecificationVersion;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Validates response bodies against docs/eng/openapi.json (docs/eng/backend.md · The API contract). */
public final class ContractValidator {

    static final Path DOCUMENT = Path.of("..", "docs", "eng", "openapi.json");
    static final String BASE = "https://scuby.local/openapi.json";

    private final JsonNode document;
    private final SchemaRegistry registry;

    private ContractValidator(JsonNode document, SchemaRegistry registry) {
        this.document = document;
        this.registry = registry;
    }

    public static ContractValidator load() {
        try {
            String json = Files.readString(DOCUMENT);
            JsonNode document = JsonMapper.builder().build().readTree(json);
            SchemaRegistry registry = SchemaRegistry.withDefaultDialect(
                    SpecificationVersion.DRAFT_2020_12, builder -> builder.schemas(Map.of(BASE, json)));
            return new ContractValidator(document, registry);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** One operation of the contract; {@code sessionRequired} when it declares {@code security: [{session: []}]}. */
    public record Operation(String method, String path, boolean sessionRequired) {}

    private static final List<String> METHODS = List.of("get", "post", "put", "patch", "delete");

    public List<Operation> operations() {
        List<Operation> found = new ArrayList<>();
        document.get("paths").properties().forEach(path -> {
            for (String method : METHODS) {
                JsonNode op = path.getValue().get(method);
                if (op == null) continue;
                boolean session = op.has("security") && op.get("security").toString().contains("\"session\"");
                found.add(new Operation(method.toUpperCase(Locale.ROOT), path.getKey(), session));
            }
        });
        return found;
    }

    /** True when a concrete request path (query string allowed) is an instance of a documented path template. */
    public boolean documents(String concretePath) {
        String path = concretePath.contains("?") ? concretePath.substring(0, concretePath.indexOf('?')) : concretePath;
        for (var it = document.get("paths").propertyNames().iterator(); it.hasNext(); ) {
            String template = it.next();
            if (path.matches(template.replaceAll("\\{[^/}]+}", "[^/]+"))) return true;
        }
        return false;
    }

    public List<String> errors(String method, String pathTemplate, int status, String jsonBody) {
        String pointer = "/paths/" + escape(pathTemplate) + "/" + method.toLowerCase(Locale.ROOT)
                + "/responses/" + status + "/content/application~1json/schema";
        if (document.at(pointer).isMissingNode()) {
            return List.of("contract has no " + method + " " + pathTemplate + " → " + status);
        }
        List<Error> found = registry.getSchema(SchemaLocation.of(BASE + "#" + pointer)).validate(jsonBody, InputFormat.JSON);
        return found.stream().map(Error::getMessage).toList();
    }

    /** For answers without a body (204): the status must be documented and have no content. */
    public List<String> errorsForNoContent(String method, String pathTemplate, int status) {
        String pointer = "/paths/" + escape(pathTemplate) + "/" + method.toLowerCase(Locale.ROOT) + "/responses/" + status;
        JsonNode response = document.at(pointer);
        if (response.isMissingNode()) return List.of("contract has no " + method + " " + pathTemplate + " → " + status);
        if (response.has("content")) return List.of("contract expects a body for " + method + " " + pathTemplate + " → " + status);
        return List.of();
    }

    static String escape(String path) {
        return path.replace("~", "~0").replace("/", "~1");
    }
}
