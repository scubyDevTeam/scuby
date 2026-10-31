package archfixtures.roles;

import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;

/** Stands in for the queue-listener annotation, so the rule can be aimed at it without the AWS dependency. */
@Retention(RetentionPolicy.RUNTIME)
public @interface FixtureListener {}
