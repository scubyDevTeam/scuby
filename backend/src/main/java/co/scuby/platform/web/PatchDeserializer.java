package co.scuby.platform.web;

import org.jspecify.annotations.Nullable;
import tools.jackson.core.JsonParser;
import tools.jackson.databind.BeanProperty;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.JavaType;
import tools.jackson.databind.ValueDeserializer;

/**
 * Reads Patch&lt;T&gt;: a JSON value through T's own deserializer (found for the property's type parameter), an explicit
 * null as Patch.of(null) (getNullValue), and a missing property as Patch.absent() (getAbsentValue, which Jackson calls
 * for a missing creator property such as a record component).
 */
public final class PatchDeserializer extends ValueDeserializer<Patch<?>> {

    private final @Nullable ValueDeserializer<Object> content;

    public PatchDeserializer() {
        this(null);
    }

    private PatchDeserializer(@Nullable ValueDeserializer<Object> content) {
        this.content = content;
    }

    @Override
    public ValueDeserializer<?> createContextual(DeserializationContext ctxt, @Nullable BeanProperty property) {
        JavaType patch = property != null ? property.getType() : ctxt.getContextualType();
        JavaType contentType = patch.containedTypeOrUnknown(0);
        return new PatchDeserializer(ctxt.findContextualValueDeserializer(contentType, property));
    }

    @Override
    public Patch<?> deserialize(JsonParser p, DeserializationContext ctxt) {
        if (content == null) throw new IllegalStateException("PatchDeserializer was not contextualized with its content type");
        return Patch.of(content.deserialize(p, ctxt));
    }

    @Override
    public Object getNullValue(DeserializationContext ctxt) {
        return Patch.of(null);
    }

    @Override
    public Object getAbsentValue(DeserializationContext ctxt) {
        return Patch.absent();
    }
}
