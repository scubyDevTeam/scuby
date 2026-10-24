package co.scuby.platform.roles;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** A bean of the `worker` role: on unless `scuby.roles.worker=false` (docs/eng/backend.md · One deployable, two roles). */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Component
@ConditionalOnProperty(name = "scuby.roles.worker", havingValue = "true", matchIfMissing = true)
public @interface WorkerComponent {}
