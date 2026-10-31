package co.scuby.platform.web;

import jakarta.validation.Constraint;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import jakarta.validation.Payload;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Length in code points, as Postgres {@code length()}/{@code char_length()} counts characters. Use it (not
 * {@code @Size}, which counts UTF-16 units) on every request string that has a database length CHECK: an emoji is one
 * character there and two units in Java, so {@code @Size} either lets through a value the CHECK refuses (a 500) or
 * refuses one the CHECK accepts. {@code null} is valid (combine with {@code @NotNull} where required).
 */
@Documented
@Constraint(validatedBy = CodePoints.Validator.class)
@Target({ElementType.FIELD, ElementType.PARAMETER, ElementType.RECORD_COMPONENT, ElementType.TYPE_USE})
@Retention(RetentionPolicy.RUNTIME)
public @interface CodePoints {

    int min() default 0;

    int max() default Integer.MAX_VALUE;

    String message() default "length must be between {min} and {max} characters";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};

    final class Validator implements ConstraintValidator<CodePoints, CharSequence> {

        private int min;
        private int max;

        @Override
        public void initialize(CodePoints annotation) {
            this.min = annotation.min();
            this.max = annotation.max();
        }

        @Override
        public boolean isValid(CharSequence value, ConstraintValidatorContext context) {
            if (value == null) return true;
            int length = Character.codePointCount(value, 0, value.length());
            return length >= min && length <= max;
        }
    }
}
