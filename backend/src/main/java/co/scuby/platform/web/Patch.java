package co.scuby.platform.web;

import org.jspecify.annotations.Nullable;
import tools.jackson.databind.annotation.JsonDeserialize;

import java.util.Objects;

/**
 * One field of a PATCH body (docs/eng/api.md · Conventions): absent (leave it as it is), present with null (clear it,
 * where the contract allows), or present with a value. Jackson binds an absent record component and an explicit null
 * the same way, so a PATCH request record declares each field as Patch&lt;T&gt;; {@link PatchDeserializer} fills it through
 * Jackson's absent-value and null-value hooks. Whether null is allowed is the field rule's business, not this class's.
 */
@JsonDeserialize(using = PatchDeserializer.class)
public final class Patch<T> {

    private static final Patch<?> ABSENT = new Patch<>(false, null);

    private final boolean present;
    private final @Nullable T value;

    private Patch(boolean present, @Nullable T value) {
        this.present = present;
        this.value = value;
    }

    @SuppressWarnings("unchecked")
    public static <T> Patch<T> absent() {
        return (Patch<T>) ABSENT;
    }

    public static <T> Patch<T> of(@Nullable T value) {
        return new Patch<>(true, value);
    }

    public boolean isPresent() {
        return present;
    }

    /** The sent value; null when absent or sent as null (tell them apart with {@link #isPresent()}). */
    public @Nullable T value() {
        return value;
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof Patch<?> p && p.present == present && Objects.equals(p.value, value);
    }

    @Override
    public int hashCode() {
        return Objects.hash(present, value);
    }

    @Override
    public String toString() {
        return present ? "Patch[" + value + "]" : "Patch.absent";
    }
}
